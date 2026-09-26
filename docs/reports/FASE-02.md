# Relatório — Fase 2: Clientes

**Status:** concluída · lint, typecheck, 147 testes (unitários + integração), 32 E2E e build verdes; nenhum segredo no bundle.

## Migration

`20260927000100_customers.sql` — `customers`, `customer_users`, `customer_imports`, `customer_import_rows`, `app.current_customer_ids()`, RLS (equipe × portal), permissão de alterar `organizations.settings` com `organization.manage`, configurações padrão de clientes.

## Funcionalidades

- **Cadastro pela equipe** (`/admin/clientes/novo`): validação com o mesmo schema no navegador e na API (CPF/CNPJ com dígito verificador — inclusive CNPJ alfanumérico —, telefone +55, CEP, UF, e-mail). Idempotente (duplo clique não duplica). Entra ativo.
- **Lista** (`/admin/clientes`): busca por nome, fantasia, responsável, e-mail, CPF/CNPJ e telefone; filtros por status com contagem; paginação por cursor.
- **Visão 360°** (`/admin/clientes/[id]`): dados, endereço com mapa, acesso ao portal, abas das próximas fases, comunicação (consentimento com data/origem) e auditoria do cliente.
- **Status** com motivo obrigatório e impacto exibido antes de confirmar: aprovar, recusar, suspender, reativar, inativar (máquina de estados central; transições inválidas rejeitadas).
- **Geocoding**: job por cliente com retry/backoff; em massa por botão; correção manual arrastando o marcador (Leaflet/OSM), com motivo, nunca sobrescrita.
- **Importação CSV** (`/admin/clientes/importar`): upload validado → prévia → mapeamento sugerido por sinônimos (sem acento) → validação linha a linha → duplicados (no banco e no próprio arquivo) → estratégia (só novos / novos + atualizar / só atualizar) → commit atômico e idempotente → relatório e CSV de rejeitados. Nada inválido entra em silêncio.
- **Auto cadastro** (`/cadastro`): cria acesso no Supabase (e-mail de confirmação), cliente `pending` ou `active` conforme configuração, perfil CUSTOMER e vínculo ao portal — em uma transação. Rate limit por IP e documento; mesma resposta para qualquer desfecho.
- **Portal**: início com avisos de status e atalhos; "Meus dados" permite alterar só contato e preferências.
- **LGPD**: exportar dados do titular e anonimizar (step-up).
- **Usuários**: convidar, suspender/reativar, alterar perfis (step-up; ninguém suspende a si mesmo; a organização nunca fica sem ADMIN ativo).
- **Configurações**: ligar auto cadastro e exigir aprovação.

## Testes

| Suite | Novos nesta fase | Destaques |
|---|---|---|
| Unitários | 36 | CPF/CNPJ (exemplo oficial alfanumérico da Receita), telefone, CEP, CSV (aspas, BOM, CRLF, `;`/`,`/tab, Windows-1252, binário), mapeamento, normalização de linhas, estratégias, máquina de estados exaustiva, CSV injection, schemas estritos |
| Integração | 21 | unicidade por org, idempotência concorrente, RLS (motorista, outra org, cliente A × B, update direto bloqueado), diff na auditoria, geocoding (parcial, não encontrado, sem provider, manual preservado), anonimização sem dados na auditoria, fluxo completo de importação e retry do commit, estratégias, arquivos inválidos, gestão de usuários |
| E2E | 5 | APIs exigem sessão, IDs inválidos não geram 500, cadastro público desligado/validação |

**Bug encontrado pelos testes e corrigido:** dois cliques simultâneos com a mesma chave de idempotência colidiam no índice do CPF/CNPJ antes de a chave ser gravada (retornava 409 em vez de reaproveitar a resposta). Agora a idempotência serializa por chave com `pg_advisory_xact_lock`.

## Riscos e pendências

1. **Credenciais**: `GOOGLE_MAPS_SERVER_KEY` (sem ela, clientes ficam "Localização pendente", mas podem ser ajustados no mapa); `SUPABASE_SERVICE_ROLE_KEY` (sem ela, convites de usuários/portal mostram mensagem clara e não funcionam); `PUBLIC_SIGNUP_ORG_SLUG` + habilitar sign-up no Supabase para o auto cadastro.
2. Telas administrativas autenticadas não foram exercitadas em navegador neste ambiente (sem Supabase local); regras cobertas por testes de service/RLS. Validar em produção: cadastro, edição, status, mapa, importação.
3. Termos de uso e política de privacidade: o aceite é registrado, mas o texto jurídico precisa ser fornecido pela empresa.
4. Busca usa `LIKE` com índices simples — suficiente para milhares de clientes; busca global com trigram fica para a Fase 12.

## Próxima fase

**Fase 3 — Produtos, ledger de estoque e saldo por cliente:** `products`, `towel_movements` append-only com todos os tipos da SPEC, estados derivados (disponível, reservado, em rota, com clientes, lavanderia, danificado, perdido, descartado) com verificação de consistência, saldo por cliente/produto derivado e ajuste manual auditado.
