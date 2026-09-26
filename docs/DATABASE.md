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

## Políticas RLS (resumo)

- Toda política é `TO app_user` e exige `organization_id = app.current_org_id()` + vínculo ativo do ator.
- Leitura de terceiros depende de permissão (`users.read`, `audit.read`, `integrations.manage`).
- Escrita sensível depende de permissão (`permissions.manage`, `users.manage`, `integrations.manage`).
- `audit_logs` INSERT exige que `actor_type/actor_id` sejam os do próprio ator (não dá para auditar em nome de outro).
- `jobs`/`outbox_events`: app_user só insere na própria org e só enxerga a coluna `idempotency_key` (necessária para `ON CONFLICT`).
- `customers`: equipe com `customer.read`/`customer.update`; usuário do portal (`portal.access`) só enxerga e altera os clientes vinculados a ele em `customer_users`. O service restringe as colunas que o cliente pode alterar (contato e preferências).
- App do motorista ganha políticas específicas (vínculo com rotas atribuídas) na Fase 5.

## Testes de banco

`npm run test:integration` recria um banco `*_test` com `supabase/tests/supabase_shim.sql` (roles `anon`/`authenticated` com o mesmo default perigoso do Supabase, `auth.users`) e aplica todas as migrations. Os testes verificam: RLS em todas as tabelas, ausência de GRANTs para o Data API, isolamento entre organizações, append-only, idempotência e concorrência.
