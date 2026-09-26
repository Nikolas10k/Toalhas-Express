# Relatório — Fase 1: Fundação

**Status:** concluída · lint, typecheck, testes (unitários, integração, E2E) e build verdes.

## Migrations criadas

| Arquivo | Conteúdo |
|---|---|
| `20260926000100_foundation_helpers.sql` | schema `app`, role `app_user`, revogação dos defaults do Supabase para `anon`/`authenticated`, GUCs de contexto, triggers `set_updated_at` e `prevent_mutation` |
| `20260926000200_organizations_access.sql` | `organizations`, `permissions` (53 permissões), `roles` (`mfa_required`), `role_permissions`, `profiles`, `organization_members`, `member_roles`, `integration_tokens`, helpers de autorização, `app.bootstrap_organization` (roles de sistema) |
| `20260926000300_audit_logs.sql` | `audit_logs` append-only com índices por org/data, entidade, ator, ação e correlação |
| `20260926000400_jobs_outbox_idempotency.sql` | `jobs` + `app.claim_jobs`, `outbox_events` (imutável) + `app.claim_outbox_events`, `idempotency_keys`, `rate_limit_buckets` + `app.rate_limit_hit` |
| `20260926000500_rls_policies.sql` | RLS em todas as tabelas, políticas `TO app_user`, GRANTs mínimos, revogação de EXECUTE |

## Principais arquivos

- `src/server/core/` — erros tipados, env validado, logger com redação, contexto de requisição, crypto, backoff, máquina de estados, dinheiro em centavos.
- `src/server/db/` — cliente `postgres.js`, `withActorTransaction` (RLS) e `withSystemTransaction`.
- `src/server/auth/`, `src/server/authz/` — claims do JWT, ator, sessão, guardas de página, catálogo de permissões, `authorize()` com MFA e step-up.
- `src/server/http/` — `route()` (CSRF, auth, rate limit, permissão, Zod, erros), utilitários de segurança.
- `src/server/modules/` — `access`, `audit`, `auth`, `jobs` (+ worker e manutenção), `outbox` (+ publisher n8n HMAC), `idempotency`, `rate-limit`.
- `src/server/providers/` — interfaces `PaymentProvider`, `MapsProvider`, `MessagingProvider`, `StorageProvider`.
- `src/proxy.ts` — CSP com nonce e renovação de sessão.
- `src/app/` — login, recuperação/redefinição de senha, MFA (cadastro e verificação), admin (layout com menu completo, dashboard, Auditoria, Usuários, Permissões, páginas de módulos planejados), portal do cliente e app do motorista (cascas protegidas).
- API: `/api/health`, `/api/auth/{login,logout,password/forgot,password/update,mfa/enroll,mfa/verify,mfa/status}`, `/api/me`, `/api/admin/audit-logs`, `/api/internal/jobs/run`, `/api/integration/v1/whoami`, `/auth/confirm`.
- `scripts/` — `bootstrap.mjs` (org + convite do primeiro ADMIN, idempotente), `db-test-setup.mjs`, `check-bundle-secrets.mjs`.
- `.github/workflows/ci.yml`, `vercel.json` (cron do worker), `supabase/config.toml`, `supabase/seed.sql` (só dev).

## Funcionalidades entregues

- Multi-tenant com `organization_id` e isolamento por RLS **também no backend**; Data API do Supabase sem acesso a dados.
- RBAC por permissões granulares; ADMIN com MFA obrigatório; step-up para 12 permissões sensíveis.
- Auth completa via backend com rate limit e mensagens anti-enumeração; sessões em cookies httpOnly.
- Auditoria append-only com contexto completo e mascaramento de segredos.
- Fila de jobs com retry, backoff exponencial com jitter, dead letter e recuperação de lock expirado; worker protegido por `CRON_SECRET` ou token INTEGRATION.
- Outbox transacional com publicação HMAC para o n8n e retenção quando o n8n está indisponível.
- Idempotência de comandos resistente a concorrência; rate limit compartilhado sem PII em claro.
- Headers de segurança (CSP nonce + strict-dynamic, HSTS, nosniff, frame-ancestors, Permissions-Policy), CSRF por origem, proteção contra open redirect e mass assignment.

## Testes executados

| Suite | Resultado | Destaques |
|---|---|---|
| Unitários (Vitest) | 51 ✅ | erros sem stack, máquina de estados (varredura exaustiva), backoff, redação de logs, open redirect, CSRF, claims/AMR, autorização (gerente sem `finance.refund` não estorna; motorista sem financeiro; step-up), HMAC do n8n, schemas estritos |
| Integração (Postgres 16) | 43 ✅ | RLS em todas as tabelas; `anon`/`authenticated` sem GRANT; catálogo TS = banco; org A não vê org B nem trocando a org ativa ou buscando por ID; motorista não se promove; usuário/token suspenso/revogado perde acesso; auditoria append-only e anti-spoofing; jobs (retry, dead letter, SKIP LOCKED com 5 workers, lock expirado); outbox (rollback, dedupe, retry, imutável); idempotência (duplo clique e 5 requisições simultâneas → 1 efeito); rate limit |
| E2E (Playwright, desktop + mobile) | 22 ✅ | CSP/headers, redirecionamento de áreas protegidas, validação acessível no login, 401 sem stack, worker exige segredo, CSRF de outra origem → 403, campos extras → 422, body grande → 422, `next` saneado, health |
| Bundle | ✅ | build com segredos-sentinela; nenhum segredo nem nome de variável secreta em `.next/static` |
| `npm audit` | ✅ | 0 vulnerabilidades |

## Riscos e pendências

1. **Fluxos reais de Supabase Auth (login, TOTP, recuperação) não foram exercitados ponta a ponta** — não há projeto Supabase/credenciais neste ambiente. Validar em staging seguindo `docs/INTEGRATIONS.md#supabase` (inclui ajuste dos templates de e-mail para `token_hash`).
2. **Credenciais ausentes** (documentadas, nada inventado): Supabase (dev/staging/prod), n8n (`N8N_OUTBOX_*`), Asaas, Google Maps.
3. O backend usa o role `postgres` no pooler; recomendação para a Fase 13: role de login dedicado com privilégios mínimos + `app_user`.
4. `style-src 'unsafe-inline'` (necessário para atributos `style` de bibliotecas de UI); scripts seguem estritos. Reavaliar na Fase 13.
5. Usuários/Permissões estão **somente leitura** na UI; convite, suspensão e edição de roles (com step-up e auditoria) entram na Fase 2 junto com o cadastro de clientes. Usuários com vínculo em mais de uma organização usam a primeira; o seletor de organização fica para quando houver o caso real.
6. Vercel Hobby só permite cron diário — usar n8n para acionar o worker com frequência ou plano Pro.
7. `supabase/config.toml` não foi validado contra uma instalação do Supabase CLI neste ambiente.

## Próxima fase

**Fase 2 — Clientes:** tabela `customers` (PF/PJ, documento único por org, contatos normalizados, endereço, lat/lng, `place_id`, consentimento de comunicação, status `pending|active|suspended|inactive`), vínculo `customer_users` para RLS do portal, auto cadastro com aprovação configurável, cadastro por admin/gerente, importação CSV com preview/mapeamento/validação/duplicados/relatório, geocoding (`GoogleMapsProvider`) com job em massa e correção manual, visão 360° (abas), gestão de usuários com convite e step-up.
