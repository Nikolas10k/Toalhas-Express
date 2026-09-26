# Deploy

## Ambientes

| Ambiente | App | Supabase | Asaas | Seed |
|---|---|---|---|---|
| development | `npm run dev` | local (`supabase start`) ou projeto dev | sandbox | `supabase/seed.sql` |
| staging | Vercel Preview (branch `staging`) | projeto **separado** | sandbox | nunca |
| production | Vercel Production (`main`) | projeto **separado** | produção | nunca |

Cada ambiente tem suas próprias credenciais. Nunca reutilize chaves entre ambientes.

## Variáveis (Vercel → Project → Settings → Environment Variables)

Veja `.env.example`. Obrigatórias na Fase 1: `APP_ENV`, `APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `CRON_SECRET`, `APP_HASH_PEPPER`.

- `NEXT_PUBLIC_*` são embutidas no build; mude e faça novo deploy.
- `DATABASE_URL`: use a string do **Supavisor em modo transação** (porta 6543). O cliente já usa `prepare: false`.
- `CRON_SECRET` e `APP_HASH_PEPPER`: `openssl rand -base64 48`. Trocar o pepper zera os contadores de rate limit (efeito aceitável).

## Passo a passo (primeiro deploy)

1. Criar projeto Supabase e configurar Auth conforme `docs/INTEGRATIONS.md#supabase`.
2. Aplicar migrations: `supabase link --project-ref <ref>` e `supabase db push`.
3. Criar projeto na Vercel apontando para o repositório; configurar variáveis por ambiente.
4. Deploy. Verificar `GET /api/health` → `{"data":{"status":"ok","database":"ok"}}`.
5. Rodar `scripts/bootstrap.mjs` com as variáveis do ambiente para criar a organização e convidar o admin.
6. Admin aceita o convite, define a senha e configura o TOTP.

## Worker (jobs + outbox)

`vercel.json` agenda `GET /api/internal/jobs/run` uma vez por dia (06:00 UTC, limite do plano Hobby; no Pro, use `*/5 * * * *`) com `Authorization: Bearer $CRON_SECRET` (a Vercel envia automaticamente quando `CRON_SECRET` está definido). No plano Hobby a Vercel só permite cron diário: nesse caso, use o n8n para chamar `POST /api/internal/jobs/run` com token INTEGRATION a cada minuto.

## Migrations

- Sempre versionadas em `supabase/migrations/`, aplicadas por `supabase db push` (ou pipeline). Nunca alterar schema pelo painel.
- Migrations devem ser compatíveis com a versão anterior do app (expand → migrate → contract) para permitir deploy sem downtime.
- O CI aplica todas as migrations em um Postgres limpo e roda os testes de integração.

## CI (`.github/workflows/ci.yml`)

`npm ci` → `npm audit --omit=dev --audit-level=high` → lint → typecheck → unit → integração (Postgres 16) → build com segredos-sentinela → check de segredos no bundle → E2E (Playwright) + job separado de secret scan (gitleaks).
