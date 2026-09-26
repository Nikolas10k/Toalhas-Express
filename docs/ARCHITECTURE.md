# Arquitetura

## Visão geral

```
Navegador ──(cookies httpOnly, JSON)──▶ Next.js (Vercel)
                                         ├─ proxy.ts ........ CSP com nonce, renovação de sessão
                                         ├─ app/ (páginas) .. Server Components chamam services
                                         └─ app/api/ ........ route() → service → domain → repository
                                                                   │
                         ┌─────────────────────────────────────────┼───────────────────────────┐
                         ▼                                         ▼                           ▼
              Supabase Auth (login, MFA)              PostgreSQL (RLS, ledgers)        Providers externos
                                                       jobs · outbox_events            (Asaas, Google, n8n)
                                                              ▲
                              Vercel Cron / n8n ──▶ /api/internal/jobs/run (worker)
```

## Camadas

Cada módulo de domínio vive em `src/server/modules/<modulo>/`:

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Endpoint | `src/app/api/**/route.ts` | Declara auth, permissão, schema Zod; chama o service. Sem regra de negócio. |
| Service | `<modulo>.service.ts` | Autoriza (`authorize`), abre transação, orquestra domínio + repositórios, audita, grava outbox. |
| Domain | `<modulo>.domain.ts` | Regras puras e máquinas de estado. Sem I/O. 100% testável. |
| Repository | `<modulo>.repository.ts` | SQL parametrizado. Recebe `Tx`. Nunca decide regra. |

Regras:

- Componentes (`src/app/**/*.tsx`, `src/components/**`) **nunca** importam `@/server/db` nem repositórios — o ESLint bloqueia.
- Serviços externos ficam atrás de interfaces em `src/server/providers/` (`PaymentProvider`, `MapsProvider`, `MessagingProvider`, `StorageProvider`). Mocks só em testes.
- Máquinas de estado são declaradas uma vez com `defineStateMachine` (`src/server/core/state-machine.ts`); toda transição passa por `assertTransition`.
- O frontend envia **intenção**. Schemas Zod são `strictObject` (campos extras → 422, contra mass assignment).

## Wrapper de rotas (`src/server/http/route.ts`)

Todo Route Handler passa por `route({...})`, que aplica em ordem:

1. Contexto da requisição (`request_id`, `correlation_id`, IP, user agent) via `AsyncLocalStorage`.
2. CSRF: métodos que alteram estado com auth por cookie exigem `Origin`/`Sec-Fetch-Site` da própria aplicação.
3. Autenticação: `public`, `session` (logado, sem exigir vínculo), `user` (membro ativo + MFA quando exigido), `integration` (token `txi_`), `cron` (`CRON_SECRET` ou token com `jobs.run`).
4. Rate limit padrão por ator/token.
5. Autorização por permissão (+ step-up quando a permissão exige).
6. Limite de body e validação Zod de body/query.
7. Mapeamento de erros tipados → JSON `{ error: { code, message, requestId } }`, sem stack trace.

## Transações e RLS no backend

`src/server/db/transaction.ts`:

- `withActorTransaction(actor, fn)`: `BEGIN` → `set_config('app.user_id' | 'app.org_id' | 'app.actor_type' | ...)` → `SET LOCAL ROLE app_user` → `fn(tx)` → `COMMIT`. O RLS filtra por organização ativa e vínculo do ator **mesmo que o repositório esqueça o filtro**.
- `withSystemTransaction(fn)`: para worker, webhooks, rate limit e bootstrap de identidade. Sem RLS; uso explícito e revisável.

Operações compostas (ex.: confirmar entrega = operação + itens + movimentos + status + outbox + auditoria) rodam em **uma** transação. Locks de estoque/financeiro usam `SELECT ... FOR UPDATE` dentro dela.

## Jobs

Tabela `jobs` + `app.claim_jobs()` com `FOR UPDATE SKIP LOCKED` (vários workers em paralelo sem pegar o mesmo job).

- Estados: `PENDING → RUNNING → SUCCEEDED | PENDING (retry) | DEAD_LETTER`; `CANCELLED`.
- Falha repetível → backoff exponencial com *equal jitter* (`src/server/core/backoff.ts`); `ValidationError`/`BusinessRuleError`/`ProviderError(retryable=false)` → `DEAD_LETTER` direto.
- Lock expirado (worker morreu) → job é reclamado de novo; se já excedeu `max_attempts`, vai para `DEAD_LETTER`.
- Handlers são registrados em `src/server/modules/jobs/worker.ts` e **devem ser idempotentes**.

## Outbox

`recordOutboxEvent(tx, …)` grava o evento na mesma transação da operação, com `idempotency_key` única. O worker reivindica eventos (`app.claim_outbox_events`) e publica via `OutboxPublisher` (n8n com HMAC). Falha → retry com backoff → `DEAD_LETTER`. Sem publisher configurado, nada é reivindicado e os eventos permanecem `PENDING`. O conteúdo do evento é imutável (trigger).

## Idempotência de comandos

`executeIdempotent(actor, { scope, key, request }, fn)` grava a chave **na mesma transação** do comando. Requisições concorrentes com a mesma chave serializam no índice único; a perdedora é desfeita inteira e devolve a resposta armazenada. Mesma chave com outro payload → `409`. Falha no comando não consome a chave.

## Erros

`src/server/core/errors.ts`: `ValidationError` (422), `AuthenticationError` (401), `MfaRequiredError`/`StepUpRequiredError`/`AuthorizationError` (403), `NotFoundError` (404 — também para recurso de outro tenant), `ConflictError`/`InventoryError` (409), `BusinessRuleError` (422), `RateLimitError` (429), `ProviderError` (502). Qualquer outro erro → 500 genérico.

## Frontend

- Admin desktop first (`/admin`), portal do cliente (`/portal`) e app do motorista (`/motorista`) mobile first.
- Guardas de página: `requirePageActor(permission, path)` redireciona para login, MFA ou "sem acesso". Services revalidam tudo.
- TanStack Query para dados client-side; mutações **não** fazem retry automático (timeout ≠ falha).
- Datas em UTC no banco, exibidas em `America/Sao_Paulo` (`formatDateTime`). Dinheiro em centavos (`src/server/core/money.ts`).
