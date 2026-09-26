# Plano de implementação

Fonte da verdade: [`docs/SPEC.md`](docs/SPEC.md). Cada fase termina com lint, typecheck, testes e build verdes e um relatório em `docs/reports/`.

| Fase | Escopo | Status |
|---|---|---|
| 1 | Fundação: projeto, schema base, organização, auth com MFA, RBAC, RLS, auditoria, layout, jobs e outbox | ✅ Concluída — [relatório](docs/reports/FASE-01.md) |
| 2 | Clientes: cadastro (auto cadastro com aprovação, admin, CSV), geocoding, visão 360° | ⏳ Próxima |
| 3 | Produtos, ledger de estoque (`towel_movements`) e saldo por cliente | Pendente |
| 4 | Pedidos, máquina de estados, reserva com lock e recorrência | Pendente |
| 5 | Motoristas, veículos, rotas e app do motorista (PWA) | Pendente |
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
