# Plano de implementação

Fonte da verdade: [`docs/SPEC.md`](docs/SPEC.md). Cada fase termina com lint, typecheck, testes e build verdes e um relatório em `docs/reports/`.

| Fase | Escopo | Status |
|---|---|---|
| 1 | Fundação: projeto, schema base, organização, auth com MFA, RBAC, RLS, auditoria, layout, jobs e outbox | ✅ Concluída — [relatório](docs/reports/FASE-01.md) |
| 2 | Clientes: cadastro (auto cadastro com aprovação, admin, CSV), geocoding, visão 360° | ✅ Concluída — [relatório](docs/reports/FASE-02.md) |
| 3 | Produtos, ledger de estoque (`towel_movements`) e saldo por cliente | ✅ Concluída — [relatório](docs/reports/FASE-03.md) |
| 4 | Pedidos, máquina de estados, reserva com lock e recorrência | ✅ Concluída — [relatório](docs/reports/FASE-04.md) |
| 5 | Motoristas, veículos, rotas e app do motorista (PWA) | ⏳ Próxima |
| 6 | Entrega, coleta, prova, ocorrências, dano e perda | Pendente |
| 7 | Lavanderia (`laundry_batches`) | Pendente |
| 8 | Contratos e regras de cobrança | Pendente |
| 9 | Financeiro interno (billable events, receivables, charges, payments, ledger) | Pendente |
| 10 | Asaas (PaymentProvider, webhook, conciliação) | Pendente |
| 11 | WhatsApp (Business Platform) e n8n | Pendente |
| 12 | Dashboards, relatórios, diagnóstico de consistência e alertas | Pendente |
| 13 | Hardening: revisão de segurança como atacante, performance, backup/restore, CI/CD | Pendente |

## Fase 1 — checklist

- [x] Projeto Next.js 16 + TS strict + Tailwind 4 + ESLint + Vitest + Playwright
- [x] Migrations: helpers, organizações, RBAC granular, perfis, vínculos, tokens de integração
- [x] RLS em todas as tabelas; Data API (anon/authenticated) sem privilégio algum
- [x] Backend com `SET LOCAL ROLE app_user` + contexto do ator (RLS também no backend)
- [x] Auth: login, logout, recuperação de senha, MFA TOTP (cadastro, verificação, step-up)
- [x] Autorização por permissão, MFA obrigatório por role, step-up para permissões sensíveis
- [x] `audit_logs` append-only com ator, before/after mascarado, IP, user agent, request/correlation id
- [x] Fila `jobs` (retry, backoff exponencial com jitter, dead letter, lock expirado) e worker protegido
- [x] `outbox_events` transacional + publisher n8n com HMAC
- [x] Idempotência de comandos (chave na mesma transação) e rate limit compartilhado no Postgres
- [x] Erros tipados, logs estruturados com redação de segredos, CSP com nonce e headers de segurança
- [x] Layout admin (menu completo da SPEC §13), Auditoria, Usuários, Permissões; portal e app do motorista (casca)
- [x] Interfaces `PaymentProvider`, `MapsProvider`, `MessagingProvider`, `StorageProvider`
- [x] CI (lint, typecheck, unit, integração com Postgres, build, check de segredos no bundle, E2E, gitleaks, npm audit)
- [x] Documentação: README, ARCHITECTURE, SECURITY, DATABASE, INTEGRATIONS, DEPLOYMENT, RUNBOOK, `.env.example`

## Fase 2 — checklist

- [x] `customers` (PF/PJ, CPF/CNPJ único por org — inclusive CNPJ alfanumérico 2026 —, contatos em +55, endereço, lat/lng, `place_id`, consentimento, status)
- [x] `customer_users` (vínculo usuário ↔ cliente) e RLS do portal: cliente só vê/altera o próprio cadastro
- [x] Cadastro pela equipe (idempotente), edição com diff auditado, máquina de estados de status com motivo
- [x] Auto cadastro público (`/cadastro`) com aprovação configurável e respostas anti-enumeração
- [x] Importação CSV: upload → prévia → mapeamento → validação → duplicados → estratégia → commit → relatório de rejeitados
- [x] Geocoding (Google) por job com retry, geocoding em massa, correção manual no mapa (Leaflet/OSM) que nunca é sobrescrita
- [x] Visão 360° com abas (Resumo, Pedidos, Entregas/Coletas, Toalhas, Contrato, Financeiro, Ocorrências, Comunicação, Auditoria)
- [x] LGPD: exportação de dados do titular e anonimização irreversível (ambas com step-up)
- [x] Gestão de usuários: convite, suspensão, perfis (com step-up e proteção contra ficar sem ADMIN)
- [x] Configurações da organização (auto cadastro e aprovação)
- [x] Portal: início e "Meus dados" (contato e preferências de comunicação)

## Fase 3 — checklist

- [x] `products` (SKU único por org, custo e preço de reposição em centavos BIGINT, estoque mínimo, ativo)
- [x] `towel_movements` append-only com os 13 tipos da SPEC, origem → destino, cliente/pedido/rota/parada/motorista/lote, motivo, ator e idempotência
- [x] Tabela única de transições por tipo (domínio) + validação no banco (estados válidos, cliente obrigatório)
- [x] `stock_balances` derivado por trigger (nunca editado pelo app), sem saldo negativo (exceto override autorizado), lock de linha contra concorrência
- [x] Estados por produto fechando com o total; saldo por cliente com última entrega e coleta
- [x] Verificação de consistência diária (ledger × cache, saldos negativos, estoque mínimo) gerando alertas sem corrigir nada
- [x] Ajuste manual com permissão, motivo e auditoria; ajuste grande (> 50) exige step-up
- [x] Prévia de impacto antes de confirmar (saldos antes/depois e valor de reposição) e estorno por movimento inverso
- [x] Telas: Estoque, Produtos, Movimentações, aba Toalhas do cliente, "Minhas toalhas" no portal

## Fase 4 — checklist

- [x] `orders` (número sequencial por org sem buraco sob concorrência, tipo, data/janela, endereço copiado do cadastro, responsável, origem, override), `order_items`, `order_status_history` append-only
- [x] Máquina de estados da SPEC §6 como única fonte de transições; transições de rota/entrega reservadas às Fases 5 e 6
- [x] Reserva de estoque com lock ao confirmar (e ao atribuir rota), liberação ao cancelar, reagendar ou desatribuir — na mesma transação
- [x] Sem estoque: bloqueia; override só com `order.override_stock` + step-up + motivo, auditado e com alerta `STOCK_OVERRIDE`
- [x] Criação idempotente (Idempotency-Key) pela equipe, pelo portal e pelo n8n (DRAFT, cliente por ID ou telefone)
- [x] Recorrência por dias da semana, gerada diariamente para 7 dias, sem duplicar (única por regra+data, advisory lock)
- [x] Outbox: `OrderCreated`, `OrderConfirmed`, `OrderCancelled`, `OrderStatusChanged`
- [x] Telas: Pedidos (filtros e contadores), Novo pedido, Detalhe (ações, reserva por item, histórico, override), Recorrências, aba Pedidos do cliente
- [x] Portal: Novo pedido, Meus pedidos, detalhe com acompanhamento e cancelamento enquanto NEW; cartões "Pedido atual" e "Próxima entrega"

## Decisões registradas

| # | Decisão | Motivo |
|---|---|---|
| D1 | Dados de negócio via PostgreSQL direto (`postgres.js`), não PostgREST | Transações compostas e `SELECT ... FOR UPDATE` são obrigatórios (SPEC §1.6) |
| D2 | Backend assume `app_user` com GUCs `app.*` por transação | RLS vale também para o backend; esquecer um filtro não vaza dados de outro tenant |
| D3 | anon/authenticated sem nenhum GRANT | O navegador nunca lê tabelas; a chave publicável vazada não dá acesso a dados |
| D4 | MFA obrigatório definido por `roles.mfa_required` (ADMIN = true) | Mantém a regra "autorização por permissão", sem `if role === 'ADMIN'` |
| D5 | Rate limit em tabela Postgres | Serverless não compartilha memória; evita dependência extra (Redis) nesta fase |
| D6 | Worker acionado por Vercel Cron (`*/5`) e/ou n8n via `POST /api/internal/jobs/run` | SPEC §2 |
| D7 | Outbox sem publisher configurado permanece `PENDING` | SPEC §11: "se o n8n cair, os eventos continuam no outbox" |
| D8 | Chave de idempotência gravada na mesma transação do comando | Duplo clique/retry concorrente nunca duplica efeito; falha não consome a chave |
| D9 | Cadastro público desligado no Supabase até a Fase 2 | Auto cadastro exige fluxo de aprovação (SPEC §4) |
| D10 | Mapa de correção manual com Leaflet + OpenStreetMap; geocoding com Google (servidor) | Correção manual funciona sem chave de browser; Google fica só onde a SPEC exige (geocoding/rotas) |
| D11 | Importação nunca marca consentimento de WhatsApp/e-mail | LGPD: consentimento precisa ser registrado com o titular |
| D12 | Importação em uma transação (tudo ou nada), idempotente pelo status | Nenhum registro importado pela metade; retry não duplica |
| D13 | Anonimização mantém o registro (id) e apaga dados pessoais | Preserva integridade de pedidos e registros financeiros com retenção legal |
| D14 | Idempotência com `pg_advisory_xact_lock` por chave | Requisições simultâneas com a mesma chave serializam antes de tocar índices do comando (ex.: CPF/CNPJ) |
| D16 | Estoque como transferências entre estados (EXTERNAL = fora do sistema) | Cada movimento debita um estado e credita outro: a soma dos estados fecha com o total por construção |
| D17 | Saldos em cache (`stock_balances`) mantidos só por trigger `SECURITY DEFINER` | Leitura rápida e lock de linha para reservas concorrentes; o app não escreve; consistência verificada contra o ledger |
| D18 | Savepoints pelo driver (`tx.savepoint`) em vez de SQL manual | Bug encontrado nos testes: erro tratado dentro de savepoint manual abortava o commit |
| D15 | Clientes cadastrados pela equipe ou importação entram ativos; auto cadastro segue a configuração | Aprovação só faz sentido para quem se cadastra sozinho |
| D19 | Pedido reserva o estoque ao entrar em CONFIRMED (não ao ser criado) | SPEC §6: reserva ao confirmar; pedidos NEW/DRAFT ainda podem mudar e não prendem estoque |
| D20 | Transições ROUTE_ASSIGNED/IN_TRANSIT/DELIVERED/COMPLETED não são manuais | Pertencem aos fluxos de rota e entrega (Fases 5/6), que registram prova e movimentos |
| D21 | Cliente do portal só cancela pedido NEW | Depois de confirmado há reserva e planejamento; cancelamento passa pela equipe |
| D22 | Número do pedido via contador por org com `UPDATE ... RETURNING` | Sequencial, sem repetição e sem depender de `max()+1` sob concorrência |
| D23 | Portal não vê motivos internos, override nem nomes da equipe | Privacidade e separação entre dados operacionais internos e do cliente |
