# Toalhas Express

Sistema de gestão para aluguel de toalhas (salões, barbearias, clínicas, spas e academias): clientes, contratos, pedidos, estoque circulante, lavanderia, rotas, motoristas, cobrança e inadimplência.

A especificação completa (fonte da verdade) está em [`docs/SPEC.md`](docs/SPEC.md). O andamento por fase está em [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind 4 · componentes estilo shadcn/ui · React Hook Form · Zod · TanStack Query · Supabase (Postgres, Auth com MFA TOTP, RLS) · Vitest · Playwright · Vercel.

## Começando

Pré-requisitos: Node 22+, PostgreSQL 16+ local (para testes) e, para rodar o app, um projeto Supabase (local via `supabase start` ou hospedado).

```bash
npm ci
cp .env.example .env.local        # preencha os valores (nunca commite)
npm run dev                       # http://localhost:3000
```

Banco e primeiro acesso:

```bash
supabase db reset                 # local: aplica supabase/migrations + seed.sql
# ou, em projeto hospedado: supabase db push
node --env-file=.env.local scripts/bootstrap.mjs \
  --org-name "Toalhas Express" --org-slug toalhas-express \
  --admin-email voce@empresa.com.br --admin-name "Seu Nome"
```

O administrador recebe um convite por e-mail, define a senha e é obrigado a configurar o autenticador (TOTP) no primeiro acesso.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run lint` / `npm run typecheck` | ESLint e `tsc --noEmit` |
| `npm test` | Testes unitários (Vitest) |
| `npm run test:integration` | Testes de integração contra PostgreSQL real (recria `TEST_DATABASE_URL`) |
| `npm run test:e2e` | Playwright contra o build de produção |
| `npm run build` | Build de produção |
| `npm run check:bundle-secrets` | Falha se algum segredo de servidor aparecer no JS do navegador |
| `npm run verify` | Tudo acima, na ordem do CI |

## Documentação

- [ARCHITECTURE](docs/ARCHITECTURE.md) — camadas, módulos, transações, jobs e outbox
- [SECURITY](docs/SECURITY.md) — modelo de ameaças, RBAC, RLS, MFA, headers
- [DATABASE](docs/DATABASE.md) — schema, convenções, migrations, RLS
- [INTEGRATIONS](docs/INTEGRATIONS.md) — Supabase, n8n, Asaas, Google, WhatsApp
- [DEPLOYMENT](docs/DEPLOYMENT.md) — ambientes, Vercel, Supabase, variáveis
- [RUNBOOK](docs/RUNBOOK.md) — operação, incidentes, backup/restore
