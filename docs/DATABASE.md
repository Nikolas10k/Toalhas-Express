# Banco de dados

PostgreSQL (Supabase). Todas as mudanças de schema são migrations versionadas em `supabase/migrations/` (ordem lexicográfica por timestamp). Nunca altere o schema pelo painel.

## Convenções

- IDs `uuid` (`gen_random_uuid()`); `organization_id` em toda entidade de negócio.
- `created_at`/`updated_at` (`timestamptz`, UTC) em toda tabela; trigger `app.set_updated_at()`.
- Vencimentos em `date`. Exibição em `America/Sao_Paulo`.
- **Dinheiro sempre em centavos `bigint`.** Nunca `numeric`/`float` para valores monetários.
- CPF/CNPJ só dígitos; telefone E.164 (`+55...`). Máscara apenas na interface.
- Índices em `organization_id`, FKs, status, datas e IDs externos.
- FKs compostas `(organization_id, id)` garantem que relacionamentos nunca cruzem tenants.
- Ledgers, auditoria e eventos são append-only: trigger `app.prevent_mutation()` bloqueia `UPDATE`/`DELETE`/`TRUNCATE` (inclusive para o dono das tabelas). Correção = novo registro.

## Schemas e roles

| Objeto | Descrição |
|---|---|
| `public` | Tabelas do app. RLS habilitado em todas. |
| `app` | Funções privadas (helpers de RLS, claim de jobs, rate limit, bootstrap). Sem `USAGE` para `public`/`anon`/`authenticated`. |
| role `app_user` | `NOLOGIN`. Assumido pelo backend via `SET LOCAL ROLE` em transações com contexto de ator. Recebe GRANTs mínimos; RLS decide as linhas. |
| `anon`, `authenticated` | Roles do Data API do Supabase. **Nenhum privilégio** em tabelas/funções do app (revogado explicitamente + default privileges revogados). |
| role de login (`postgres`) | Dono das tabelas; usado pelo backend em `withSystemTransaction` e pelas migrations. |

## Contexto do ator (GUCs locais da transação)

| GUC | Função | Uso |
|---|---|---|
| `app.actor_type` | `app.current_actor_type()` | `USER`, `INTEGRATION`, `SYSTEM` |
| `app.user_id` | `app.current_user_id()` | `auth.users.id` do JWT verificado |
| `app.integration_token_id` | `app.current_integration_token_id()` | token INTEGRATION validado |
| `app.org_id` | `app.current_org_id()` | organização ativa (validada contra vínculos) |

Helpers de política (`SECURITY DEFINER`, `search_path=''`): `app.is_active_member(org)`, `app.actor_in_current_org()`, `app.current_permissions()`, `app.has_permission(code)`.

## Tabelas da Fase 1

| Tabela | Notas |
|---|---|
| `organizations` | Tenant. `status` ativo/suspenso/inativo; org suspensa perde todo acesso via RLS. |
| `permissions` | Catálogo global de permissões granulares (`requires_step_up`). Espelhado em `src/server/authz/permissions.ts` (teste garante igualdade). |
| `roles` | Por organização. `is_system`, `mfa_required`. Roles de sistema: ADMIN, MANAGER, DRIVER, CUSTOMER, INTEGRATION (criados por `app.bootstrap_organization`). |
| `role_permissions` | Permissões de cada role. |
| `profiles` | 1:1 com `auth.users` (nome, telefone). `anonymized_at` para LGPD. |
| `organization_members` | Vínculo usuário ↔ org (`invited/active/suspended/removed`, `mfa_required`). |
| `member_roles` | N:N membro ↔ role. Atribuir role exige `permissions.manage`. |
| `integration_tokens` | Tokens `txi_<prefixo>_<segredo>`; só o SHA-256 é gravado. Revogação e expiração. |
| `audit_logs` | Append-only. Ator, ação, entidade, before/after (mascarados), IP, user agent, request/correlation id. |
| `jobs` | Fila com retry/backoff/dead letter. Não pode ser apagada. |
| `outbox_events` | Eventos de domínio; conteúdo imutável; `idempotency_key` única. |
| `idempotency_keys` | Resposta armazenada por `(org, scope, key)`; expira em 7 dias (limpeza diária). |
| `rate_limit_buckets` | Janela fixa; chave = hash com pepper (sem IP/e-mail em claro). |

## Tabelas da Fase 2

| Tabela | Notas |
|---|---|
| `customers` | PF/PJ, `document` único por org (CPF 11 dígitos ou CNPJ 14 caracteres, alfanumérico desde 2026). Telefones em E.164. `geocode_status`: PENDING, OK, PARTIAL, NOT_FOUND, FAILED, MANUAL, SKIPPED. Status: pending → active/inactive; active ↔ suspended; → inactive → active. Sem DELETE (trigger); anonimização zera dados pessoais e mantém o id. |
| `customer_users` | Vínculo usuário (perfil CUSTOMER) ↔ cliente. Base do RLS do portal (`app.current_customer_ids()`). |
| `customer_imports` | Uma importação CSV: arquivo (hash), cabeçalhos, mapeamento, estratégia, resumo e status (UPLOADED → VALIDATED → COMMITTED / CANCELLED). |
| `customer_import_rows` | Linha crua, normalizada, erros, duplicado (no banco/no arquivo), ação decidida e resultado. |

`organizations.settings.customers` guarda `selfSignupEnabled` e `requireApproval` (padrões seguros: desligado / exige aprovação).

## Tabelas da Fase 3

| Tabela | Notas |
|---|---|
| `products` | SKU único por org; `cost_cents` e `replacement_price_cents` em BIGINT; `min_stock`; sem DELETE. |
| `towel_movements` | Ledger append-only. Cada linha move `quantity` de `from_state` para `to_state` (`EXTERNAL` = fora do sistema). `customer_id` obrigatório quando envolve `WITH_CUSTOMER`. Campos de vínculo para pedido, rota, parada, motorista e lote. `idempotency_key` única. `reverses_movement_id` para estornos. `allow_negative` só com `order.override_stock`. |
| `stock_balances` | Cache derivado por (produto, estado, cliente). Atualizado **somente** pelo trigger `app.apply_towel_movement` (SECURITY DEFINER), que trava a linha e rejeita saldo negativo (SQLSTATE `P0010`). `app_user` só lê. |
| `system_alerts` | Alertas com `dedupe_key` (um aberto por condição): `INVENTORY_INCONSISTENT`, `NEGATIVE_BALANCE`, `LOW_STOCK`. |

`app.inventory_consistency(org)` recalcula todos os saldos a partir do ledger e devolve divergências com o cache. O job diário `inventory.consistency_check` abre/resolve alertas e nunca altera saldos.

## Tabelas da Fase 4

| Tabela | Notas |
|---|---|
| `order_counters` | Próximo número por org; `app.next_order_number(org)` (SECURITY DEFINER) incrementa com lock de linha. |
| `orders` | `number` único por org; `order_type` DELIVERY/COLLECTION/DELIVERY_AND_COLLECTION; 12 status da SPEC §6; `scheduled_date` (DATE, agenda em America/Sao_Paulo) + janela `TIME`; `address` (JSONB, cópia do cadastro na criação) e lat/lng; `source` ADMIN/PORTAL/INTEGRATION/RECURRENCE; `recurring_rule_id` + `occurrence_date` com índice único (sem duplicar recorrência); `stock_override`; `route_id`/`driver_id` para a Fase 5. Sem DELETE. |
| `order_items` | Quantidades de entrega e coleta por produto (único por pedido). |
| `order_status_history` | Append-only: de → para, motivo, metadados (nova data, reservado/liberado, override), ator. |
| `recurring_order_rules` | Dias ISO (1 = seg … 7 = dom), janela, itens (JSONB), vigência e ativo. |

A reserva de um pedido é derivada do ledger: `Σ RESERVATION − Σ RESERVATION_RELEASE` com `order_id`. Chaves de idempotência dos movimentos: `order:{id}:reserve|release:{tag}:{produto}`.

## Tabelas da Fase 5

| Tabela | Notas |
|---|---|
| `vehicles` | Placa normalizada (antiga ou Mercosul) única por org, modelo, capacidade em toalhas, status ACTIVE/INACTIVE/MAINTENANCE. Sem DELETE. |
| `drivers` | Nome, CPF (único por org), telefone +55, `user_id` (único por org — acesso ao app), veículo padrão, status ACTIVE/INACTIVE/ON_LEAVE. Sem DELETE. |
| `routes` | Data, motorista, veículo, status PLANNED → IN_PROGRESS → COMPLETED/CANCELLED, ordenação MANUAL/OPTIMIZED com distância e duração estimadas. Índice único parcial: um motorista não tem duas rotas abertas no mesmo dia. Sem DELETE. |
| `route_stops` | Uma por pedido na rota (`unique(route_id, order_id)`), `sequence` com unique **DEFERRABLE** (reordenação na mesma transação), status das paradas da SPEC §7, lat/lng e horários (a caminho, chegada, conclusão). Só é apagada em rota PLANNED. |
| `route_events` | Linha do tempo append-only da rota e das paradas, com geolocalização quando disponível (`metadata.geolocation = 'unavailable'` quando o aparelho não informou). |

`orders.route_id`/`driver_id` e `towel_movements.route_id`/`route_stop_id`/`driver_id` ganharam FKs. `organizations.settings.routes.depot` guarda a base de saída; `app.set_route_depot()` permite a quem tem `route.manage` alterar só esse campo.

## Tabelas da Fase 6

| Tabela | Notas |
|---|---|
| `stop_operations` | Atendimento da parada (append-only, **um por parada**): recebedor, observações, geolocalização (`CAPTURED`/`UNAVAILABLE`), ator. |
| `stop_operation_items` | Por produto: previsto, carregado, entregue, coleta esperada, saldo do cliente antes, coletado, danificado. CHECKs: entregue ≤ carregado; coletado ≤ saldo; danificado ≤ coletado. Append-only. |
| `incidents` | Número `OC-00001` por org; tipos da SPEC §7; status OPEN → UNDER_REVIEW → RESOLVED/CANCELLED; vínculos com cliente, pedido, rota, parada, operação, produto; `details` (etapa da divergência, esperado, realizado); classificação de dano; decisão; valor cobrado. Sem DELETE. |
| `incident_events` | Histórico append-only da ocorrência. |
| `billable_events` | Fato cobrável (perda/dano): `unique(org, source_type, source_id)`, `amount_cents = quantity × unit_price_cents`, valores imutáveis por trigger (só o status muda). |
| `attachments` | Fotos em bucket privado (`operation-proofs`): tipo real, tamanho, SHA-256, quem enviou; vínculo com operação/ocorrência definitivo (trigger). |

`app.customer_product_balance(cliente, produto)` devolve o saldo com o cliente para quem tem `inventory.read` ou é o motorista de uma rota aberta daquele cliente.

## Tabelas da Fase 7

| Tabela | Notas |
|---|---|
| `laundry_receipts` / `laundry_receipt_items` | Conferência na base, **uma por rota** (`unique(route_id)`): esperado (coletado nas paradas) × contado por produto. Append-only. |
| `laundry_batches` | Lote `LV-00001` por org; WAITING → WASHING → DRYING → FOLDING → INSPECTION → COMPLETED ou CANCELLED (só de WAITING); lavanderia, observações, datas. Sem DELETE. |
| `laundry_batch_items` | Quantidade por produto no lote (append-only). |
| `laundry_inspections` | Resultado por produto: aprovadas, com dano, descarte (append-only; a soma fecha com o lote no service). |
| `laundry_batch_events` | Histórico append-only das etapas. |

`towel_movements.laundry_batch_id` ganhou FK. `app.laundry_queue()` e `app.pending_laundry_receipts()` (SECURITY DEFINER) exigem `laundry.read` e dão à lavanderia só o que ela precisa, sem abrir estoque e rotas inteiros.

## Tabelas da Fase 8

| Tabela | Notas |
|---|---|
| `contracts` | Contrato `CT-00001` por org; tipo de cobrança, vigência, renovação, vencimento, mensalidade, valor por entrega, desconto (pontos-base), revisão. **Um vigente por cliente** (`contracts_customer_current_uidx`). Sem DELETE. |
| `contract_items` | Por produto: contratada, franquia, preço por peça, excedente, perda e dano (nulos = preço de reposição). Substituídos a cada revisão. |
| `contract_revisions` | Fotografia completa após cada alteração (criação, edição, status, renovação). Append-only. |

`orders.contract_id` ganhou FK. `app.contract_loss_damage_price(customer, product)` (SECURITY DEFINER) devolve o preço de perda/dano do contrato vigente para quem resolve ocorrências. RLS: equipe com `contract.read`; cliente vê só os próprios contratos não rascunho/cancelados; escrita exige `contract.manage`.

## Tabelas da Fase 8B

| Tabela | Notas |
|---|---|
| `products.kind` | `RENTAL` (toalha de aluguel, estoque) ou `LINEN` (enxoval do cliente). Trigger `towel_movements_rental_only` recusa movimento de enxoval; `products_kind_guard` impede mudar o tipo depois de haver histórico. |
| `linen_service_orders` | OS `OS-00001`: COLLECTED → READY → DELIVERED (ou CANCELLED antes de lavar). Coleta vinculada ao atendimento da parada; `delivery_order_id` aponta o pedido de entrega. Sem DELETE. |
| `linen_service_order_items` | Por peça: coletadas (rol, base da cobrança), já com dano na coleta, saíram prontas, entregues. Sem DELETE. |
| `linen_service_order_events` | Histórico append-only da OS. |
| `stop_operation_items.is_linen` | Coleta de enxoval não depende de saldo do cliente (check `stop_operation_items_collect_within_balance`). |

Perfil **OPERATOR** criado em todas as organizações (e no `app.bootstrap_organization`): `admin.access`, `product.read`, `laundry.read`, `laundry.manage`, `incident.report`, `route.read`.

## Políticas RLS (resumo)

- Toda política é `TO app_user` e exige `organization_id = app.current_org_id()` + vínculo ativo do ator.
- Leitura de terceiros depende de permissão (`users.read`, `audit.read`, `integrations.manage`).
- Escrita sensível depende de permissão (`permissions.manage`, `users.manage`, `integrations.manage`).
- `audit_logs` INSERT exige que `actor_type/actor_id` sejam os do próprio ator (não dá para auditar em nome de outro).
- `jobs`/`outbox_events`: app_user só insere na própria org e só enxerga a coluna `idempotency_key` (necessária para `ON CONFLICT`).
- `customers`: equipe com `customer.read`/`customer.update`; usuário do portal (`portal.access`) só enxerga e altera os clientes vinculados a ele em `customer_users`. O service restringe as colunas que o cliente pode alterar (contato e preferências).
- `orders` e derivados: equipe com `order.read` (escrita com `order.create`/`order.update`/`order.cancel`; `order.create_draft` só cria DRAFT); portal só os pedidos dos clientes vinculados; token de integração só enxerga os rascunhos que ele mesmo criou.
- Fase 6: atendimentos visíveis à equipe (`route.read`), ao motorista da rota e ao próprio cliente; ocorrências com `incident.read` (quem reportou vê as suas); cobráveis só com `finance.read` ou `incident.manage` — motorista e cliente nunca veem; criar cobrável exige `incident.manage` **e** `finance.create_charge`.
- Motorista (`driver_app.access`): `app.current_driver_id()`, `app.driver_can_see_order()` e `app.driver_can_see_customer()` (SECURITY DEFINER) limitam rotas, paradas, pedidos, movimentos e clientes às rotas do próprio motorista — clientes só enquanto a rota está aberta.

## Testes de banco

`npm run test:integration` recria um banco `*_test` com `supabase/tests/supabase_shim.sql` (roles `anon`/`authenticated` com o mesmo default perigoso do Supabase, `auth.users`) e aplica todas as migrations. Os testes verificam: RLS em todas as tabelas, ausência de GRANTs para o Data API, isolamento entre organizações, append-only, idempotência e concorrência.
