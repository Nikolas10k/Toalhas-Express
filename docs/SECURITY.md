# Segurança

Prioridade em conflitos (SPEC §1): integridade financeira > segurança > integridade de estoque > privacidade > regras de negócio > disponibilidade > manutenibilidade > performance > UX > estética.

## Autenticação

- Supabase Auth com e-mail/senha. Login, recuperação e troca de senha passam **pelo backend** (`/api/auth/*`), que aplica rate limit por IP e por e-mail (hash) e devolve mensagens genéricas (anti-enumeração).
- Sessão em cookies `httpOnly`, `SameSite=Lax`, `Secure` em produção. Nenhum token em `localStorage`. O navegador não usa o cliente Supabase.
- Identidade vem sempre de `supabase.auth.getClaims()` (JWT com assinatura verificada), nunca de `getSession()`.
- Cadastro público desligado até a Fase 2. Primeiro admin via `scripts/bootstrap.mjs` (convite por e-mail).
- Senha: mínimo 12 caracteres com maiúsculas, minúsculas e números (Zod + configuração do Supabase).

## MFA (TOTP)

- `roles.mfa_required` define quem é obrigado (ADMIN = sim). Sessão sem AAL2 recebe `403 MFA_REQUIRED` na API e é redirecionada para `/mfa` nas páginas.
- Quem cadastrou TOTP sempre precisa verificar ao entrar (`nextLevel = aal2`).
- **Step-up**: permissões com `requires_step_up` (estorno, cancelamento financeiro, pagamento manual, permissões, integrações, usuários, ajuste grande de estoque, override de estoque, exportações, anonimização) exigem TOTP verificado há no máximo `STEP_UP_MAX_AGE_SECONDS` (padrão 600 s), lido do `amr` do JWT. Integrações nunca executam permissões com step-up.

## Autorização

- Perfis ADMIN, MANAGER, DRIVER, CUSTOMER, INTEGRATION são **conjuntos de permissões** (`public.role_permissions`). O código só verifica permissões (`authorize(actor, 'finance.refund')`), nunca nomes de role.
- Três barreiras: guarda de página (UX) → `authorize()` no service → RLS no banco.
- Organização ativa vem de cookie, mas só é aceita se houver vínculo ativo; senão cai na primeira org do usuário.
- IDOR/BOLA: consultas por ID rodam com RLS da org ativa; registro de outro tenant simplesmente não existe (`404`).

## Banco

- RLS em **todas** as tabelas; backend também sob RLS (`SET LOCAL ROLE app_user`).
- `anon`/`authenticated` sem privilégios: a chave publicável não dá acesso a nenhum dado.
- Funções `SECURITY DEFINER` com `search_path=''`. `EXECUTE` revogado de `PUBLIC` por padrão.
- Append-only (auditoria, jobs, eventos; ledgers nas próximas fases) garantido por trigger.
- SQL sempre parametrizado (tagged templates do `postgres.js`); nenhum SQL concatenado com input.

## HTTP

- CSP por requisição com nonce + `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- HSTS (2 anos, preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restritiva, `COOP same-origin`, sem `X-Powered-By`.
- APIs com `Cache-Control: no-store`, sem CORS (nenhum `Access-Control-Allow-Origin`).
- CSRF: métodos não seguros com auth por cookie exigem `Origin`/`Sec-Fetch-Site` da própria aplicação.
- Open redirect: `sanitizeNextPath` aceita apenas caminhos internos.
- Body limitado por rota (padrão 64 KB); `Content-Type: application/json` obrigatório; Zod `strictObject` rejeita campos extras (mass assignment).
- SSRF: o backend só chama URLs vindas de variáveis de ambiente (n8n, Asaas, Google), com `redirect: 'error'` e timeout.

## Integrações

- Token INTEGRATION: `txi_<prefixo>_<segredo 256 bits>`, só SHA-256 no banco, comparação em tempo constante, revogável, com expiração opcional.
- Worker: `CRON_SECRET` (Vercel Cron) comparado em tempo constante, ou token com `jobs.run`.
- Backend → n8n: HMAC-SHA256 `t=<epoch>,v1=<hex>` sobre `${t}.${body}` + `x-toalhas-event-id` para deduplicação.
- Webhook Asaas (Fase 10): token do webhook ≠ API key, body limitado, evento bruto gravado com `UNIQUE(provider, event_id)`, processamento em job.

## Segredos

- Somente em variáveis de ambiente, separados por ambiente. `.env*` no `.gitignore` (exceto `.env.example`, sem valores).
- `SUPABASE_SERVICE_ROLE_KEY` só no servidor (`import 'server-only'`). O CI compila com valores-sentinela e `npm run check:bundle-secrets` falha se qualquer segredo (ou o nome da variável) aparecer em `.next/static`.
- Logs estruturados com redação automática de chaves sensíveis (senha, token, authorization, cookie, cartão, OTP...) e de padrões (JWT, Bearer, `sb_secret_`, `$aact_`, `txi_`).
- Dados de cartão nunca são armazenados (checkout do Asaas).

## Auditoria

`audit_logs` registra ator, ação, entidade, before/after (mascarados), IP, user agent, `request_id` e `correlation_id`. Na Fase 1: login (sucesso/falha com fingerprint do e-mail), recuperação/troca de senha, MFA (cadastro, verificação, falha), bootstrap de admin. As fases seguintes auditam clientes, contratos, estoque, cobranças, cancelamentos, pagamentos manuais, estornos, permissões e usuários.

## LGPD

- Coleta mínima (perfil: nome e telefone). IP e e-mail em rate limit apenas como hash com pepper.
- `profiles.anonymized_at` e permissão `customer.anonymize` preparam o processo de anonimização (Fase 2), respeitando a retenção legal de registros financeiros.
- Consentimento de comunicação por cliente (Fase 2/11).

## Checklist de revisão (a cada PR)

- [ ] Nenhum input do cliente define valor, status, saldo, cliente ou organização.
- [ ] Toda rota usa `route()` com `permission` adequada e schema Zod estrito.
- [ ] Toda escrita composta está em uma transação; locks onde há disputa.
- [ ] Novas tabelas: RLS habilitado, políticas `TO app_user`, GRANTs mínimos, índices, `organization_id`.
- [ ] Novas funções em `app`: `search_path=''`, sem `EXECUTE` para `PUBLIC`.
- [ ] Operações sensíveis auditadas; permissões sensíveis marcadas com `requires_step_up`.
