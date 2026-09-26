# TOALHAS EXPRESS — PROMPT MESTRE

Atue como arquiteto e engenheiro full stack sênior, com foco em segurança, sistemas financeiros e PostgreSQL. Sua tarefa é **implementar** (não prototipar) um sistema de produção para a Toalhas Express, empresa de aluguel de toalhas para salões, barbearias, clínicas, spas e academias. O sistema centraliza a operação que hoje está espalhada em planilhas, WhatsApp e no painel do gateway: clientes, contratos, pedidos, estoque circulante, lavanderia, rotas, motoristas, cobrança e inadimplência. O administrador não deve precisar abrir o painel do Asaas na rotina.

Salve este documento no repositório como `docs/SPEC.md`. Ele é a fonte da verdade do projeto.

---

## 1. Regras inegociáveis

1. O frontend envia **intenção**, nunca valores finais. O backend busca dados confiáveis e calcula valor, saldo, status, desconto, juros e cliente. Todo input é validado com Zod no servidor.
2. Saldo de estoque e saldo financeiro **nunca** são editados diretamente. Eles derivam de movimentos (ledger) append-only.
3. Movimentos de estoque, movimentos financeiros, cobranças, pagamentos e audit logs nunca são apagados. Use `deleted_at` ou estados.
4. Pagamento só é confirmado por webhook validado ou por consulta server-to-server ao Asaas. Redirect de sucesso não confirma nada.
5. Webhooks, criação de cobrança, pedidos recorrentes, envio de mensagens, entrega e coleta são **idempotentes** (`idempotency_key` + constraint UNIQUE). Duplo clique ou retry não duplica nada. Timeout não significa que a operação falhou: consulte o estado antes de repetir.
6. Operações compostas rodam em **uma transação**. Reserva de estoque e operações financeiras usam locking (`SELECT ... FOR UPDATE` ou equivalente) contra race condition.
7. Isolamento total: cliente vê só os próprios dados, motorista vê só as próprias rotas e nada financeiro, e nenhuma organização acessa dados de outra. Isso é validado no backend **e** por RLS. Toda busca por ID verifica o vínculo (defesa contra IDOR/BOLA).
8. Falha de serviço externo (Asaas, Maps, WhatsApp, n8n) nunca derruba nem desfaz operação interna. Nesse caso, o sistema registra o estado pendente e tenta de novo depois.
9. Toda cobrança tem origem rastreável. Todo pagamento é conciliável. Todo override administrativo é auditado.
10. Segredos ficam só em variáveis de ambiente. A `SUPABASE_SERVICE_ROLE_KEY` nunca vai ao navegador. Dados de cartão nunca são armazenados.

**Prioridade em conflitos:** integridade financeira > segurança > integridade de estoque > privacidade > regras de negócio > disponibilidade > manutenibilidade > performance > UX > estética.

---

## 2. Stack e infraestrutura (decidido)

- **App:** Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui + React Hook Form + Zod + TanStack Query. Deploy na Vercel.
- **Dados:** Supabase (PostgreSQL, Auth com MFA TOTP, Storage privado, RLS). Todas as mudanças de schema são feitas por migrations versionadas.
- **Jobs:** tabela `jobs` no Postgres (status, attempts, `next_run_at`, `last_error`), com retry, backoff exponencial com jitter, limite de tentativas e `DEAD_LETTER`. O worker é acionado por endpoint protegido, chamado por Vercel Cron e/ou n8n.
- **Outbox:** eventos críticos (ChargeCreated, PaymentReceived, DeliveryCompleted etc.) são gravados em `outbox_events` na mesma transação da operação e publicados depois pelo worker.
- **Testes:** Vitest (unitário e integração) e Playwright (E2E).
- **Ambientes:** development, staging e production, com credenciais separadas. O Asaas usa sandbox fora de produção. O seed roda só em desenvolvimento.

**Arquitetura:** módulos por domínio, cada um com as camadas `endpoint → service → domain → repository`. Componentes nunca acessam o banco diretamente. Serviços externos ficam atrás de interfaces: `PaymentProvider` (Asaas), `MapsProvider` (Google), `MessagingProvider` (WhatsApp/n8n), `StorageProvider`. As máquinas de estado ficam centralizadas no domínio, sem `if status ===` espalhado pelo código. Os erros seguem um padrão tipado (`ValidationError`, `AuthorizationError`, `NotFoundError`, `ConflictError`, `BusinessRuleError`, `ProviderError`, `InventoryError`), e o cliente nunca vê stack trace.

**Convenções:** IDs em UUID, com `organization_id` em toda entidade de negócio (preparado para SaaS). Timestamps em UTC e exibição em `America/Sao_Paulo`, com vencimentos em `DATE`. **Dinheiro sempre em centavos `BIGINT`, sem exceção.** CPF/CNPJ e telefone ficam normalizados no banco (telefone em +55) e recebem máscara só na interface. Toda tabela tem `created_at` e `updated_at`, com índices em `organization_id`, FKs, status, datas e IDs externos.

---

## 3. Acesso

**Perfis:** ADMIN, MANAGER, DRIVER, CUSTOMER e INTEGRATION (usado pelo n8n). Os roles são conjuntos de **permissões granulares** (`customer.read`, `order.create`, `inventory.adjust`, `finance.create_charge`, `finance.refund`, `finance.reconcile`, `route.manage`, `audit.read`, `permissions.manage` etc.). A autorização valida a permissão, nunca o nome do role.

- **ADMIN:** acesso total. MFA obrigatório.
- **MANAGER:** operação completa, com financeiro conforme as permissões atribuídas. MFA recomendado.
- **DRIVER:** vê apenas as próprias rotas e, em cada parada, cliente, endereço, telefone, observações operacionais e quantidades a entregar e coletar. Não vê valores, dívidas, contratos nem relatórios.
- **CUSTOMER:** vê e opera apenas os próprios dados: pedidos, toalhas em posse, contrato, cobranças e parte do cadastro.
- **INTEGRATION:** token de API com permissões mínimas. Pode criar pedidos DRAFT, disparar rotinas e informar status de mensagens.

**Step-up (MFA recente)** é exigido para estorno, cancelamento financeiro, alteração de permissões e integrações, ajuste grande de estoque e exportação em massa. Sessões usam cookies seguros, sem token privilegiado em localStorage. Há rate limit em login, recuperação de senha, cadastro, uploads, pedidos, cobranças e envio de mensagens.

---

## 4. Clientes

- **Formas de cadastro:** auto cadastro (com aprovação configurável antes de liberar pedidos), cadastro por admin ou gerente, e importação CSV. O fluxo da importação é: upload → preview → mapeamento de colunas → validação → detecção de duplicados → escolha (ignorar, atualizar ou só novos) → relatório de importados, atualizados e rejeitados. Nenhum registro inválido é importado em silêncio.
- **Campos:** PF/PJ, razão social, nome fantasia, CPF/CNPJ (único por organização), responsável, telefone, WhatsApp, e-mail, endereço completo, lat/lng, `place_id`, preferência e consentimento de comunicação, observações.
- **Status:** `pending | active | suspended | inactive`.
- **Endereço:** passa por geocoding no Google para gravar lat/lng e `place_id`, com correção manual no mapa. Geocoding em massa roda em job.
- **Visão 360° no admin:** abas de resumo, pedidos, entregas/coletas, toalhas, contrato, financeiro, ocorrências, comunicação e auditoria.

---

## 5. Estoque (ativo circulante)

Toalhas são ativos reutilizáveis, não produtos vendidos. **Tudo é movimento** em `towel_movements` (append-only), com os tipos: `STOCK_ENTRY, RESERVATION, RESERVATION_RELEASE, DELIVERY_DISPATCH, DELIVERY, COLLECTION, LAUNDRY_ENTRY, LAUNDRY_EXIT, TRANSFER, DAMAGE, LOSS, DISCARD, MANUAL_ADJUSTMENT`. Cada movimento registra produto, quantidade, origem → destino, e cliente, pedido, rota, parada e motorista quando aplicável, além de motivo e usuário.

**Estados derivados por produto:** disponível, reservado, em rota, com clientes, aguardando lavagem, em lavagem, em inspeção, danificado, perdido, descartado. **A soma dos estados deve sempre fechar com o total.** Crie uma verificação de consistência que gere alerta quando não fechar.

**Saldo por cliente e produto:** entregues − coletadas ± ajustes autorizados, com data da última entrega e da última coleta. O saldo nunca é digitado. Ajuste manual exige permissão, motivo e auditoria, e gera um movimento `MANUAL_ADJUSTMENT`.

**Produtos:** SKU, nome, tamanho, categoria, custo, preço de reposição, estoque mínimo e ativo.

**Lavanderia:** coleta → recebimento/conferência → `laundry_batches` (`WAITING → WASHING → DRYING → FOLDING → INSPECTION → COMPLETED`). A inspeção destina cada toalha para estoque disponível, dano ou descarte.

---

## 6. Pedidos

Pedidos são criados por cliente, admin ou gerente em nome do cliente (caso comum, porque o cliente pede por WhatsApp ou telefone), ou pelo n8n como `DRAFT`. Tipos: `DELIVERY | COLLECTION | DELIVERY_AND_COLLECTION`. Cada pedido tem número, cliente, contrato, endereço, data, janela de atendimento, itens, observações, responsável, rota, motorista e histórico de status.

**Máquina de estados (única fonte de transições válidas):**

| De | Para |
|---|---|
| DRAFT | NEW, CANCELLED |
| NEW | CONFIRMED, CANCELLED |
| CONFIRMED | PREPARING, RESCHEDULED, CANCELLED |
| PREPARING | READY, CANCELLED |
| READY | ROUTE_ASSIGNED, RESCHEDULED, CANCELLED |
| ROUTE_ASSIGNED | IN_TRANSIT, READY (desatribuir), RESCHEDULED |
| IN_TRANSIT | DELIVERED, DELIVERY_PROBLEM |
| DELIVERY_PROBLEM | RESCHEDULED, CANCELLED |
| RESCHEDULED | CONFIRMED |
| DELIVERED | COMPLETED |

Cancelar, reagendar ou desatribuir libera a reserva (`RESERVATION_RELEASE`). Depois de `IN_TRANSIT`, o pedido não pode ser cancelado diretamente, só via `DELIVERY_PROBLEM`.

**Reserva:** ao confirmar, o sistema reserva estoque com lock. Se não houver quantidade suficiente, a operação é bloqueada com "Estoque insuficiente". O override para estoque negativo exige permissão, motivo, confirmação e auditoria, e gera alerta.

**Recorrência:** `recurring_order_rules` guarda dias, horário, itens e endereço. A geração automática usa a chave `rule_id:data`, com UNIQUE, para não duplicar.

---

## 7. Rotas, entrega e coleta

- **Rotas:** o admin vê um mapa com os pedidos prontos, seleciona pedidos, motorista, veículo e data, e ordena as paradas manualmente ou por otimização via Google Routes API, com distância e duração estimadas. Estados da rota: `PLANNED → IN_PROGRESS → COMPLETED | CANCELLED`. Estados da parada: `PENDING, ON_THE_WAY, ARRIVED, IN_SERVICE, COMPLETED, FAILED, SKIPPED, RESCHEDULED`.
- **Motoristas e veículos:** motorista tem nome, CPF, telefone, usuário vinculado, veículo padrão e status `ACTIVE | INACTIVE | ON_LEAVE`. Veículo tem placa, modelo, capacidade e status.
- **App do motorista (mobile first, PWA):** mostra a rota do dia (paradas, entregas, coletas), a próxima parada e os botões Iniciar rota, Navegar, Cheguei, Entregar, Coletar, Registrar problema, Próxima e Finalizar.
- **Entrega:** registra a quantidade prevista, a carregada e a efetivamente entregue (esta gera movimento `DELIVERY`).
- **Coleta:** o motorista vê a quantidade esperada (saldo do cliente) e informa a coletada. **Se houver diferença, o sistema cria automaticamente uma ocorrência `QUANTITY_DIVERGENCE`** e o saldo restante continua com o cliente. Nada é corrigido em silêncio.
- **Prova da operação:** nome do recebedor, foto (configurável), timestamp e geolocalização. A falta de geolocalização é registrada, mas não bloqueia a operação.
- **Finalizar entrega ou coleta:** tudo acontece em uma transação: valida pedido e parada → registra operação e itens → cria movimentos → atualiza status → grava evento no outbox.

**Ocorrências:** tipos `NOT_RETURNED, IN_USE, DAMAGED, LOST, CUSTOMER_REFUSED, CUSTOMER_CLOSED, ADDRESS_PROBLEM, QUANTITY_DIVERGENCE, OTHER`. Cada uma registra produto, quantidade, fotos, responsável e resolução, com status `OPEN → UNDER_REVIEW → RESOLVED | CANCELLED`.

**Dano:** classificação (rasgada, manchada, queimada, desfiada, desgaste) e decisão `RETURN_TO_LAUNDRY | RETURN_TO_STOCK | DISCARD | CHARGE_CUSTOMER`.

**Perda:** registra quantidade × preço de reposição e decisão de cobrar ou não.

Quando o cliente é cobrado por dano ou perda, a cadeia é: `billable_event → receivable → charge`, gerada uma única vez.

---

## 8. Contratos

Campos: cliente, número, vigência, status, itens e produtos, quantidade contratada, franquia, preço excedente, preço de perda e de dano, desconto, dia de vencimento, renovação. Tipos de cobrança: `MONTHLY_FIXED | PER_DELIVERY | PER_QUANTITY | HYBRID | CUSTOM`. As regras de cálculo ficam em serviço de domínio testável. Alterações de contrato são auditadas.

---

## 9. Financeiro

**Modelo de dados:**

- `billable_events`: origem da cobrança (contrato, pedido, entrega, excedente, perda, dano, taxa, ajuste).
- `receivables`: o que o cliente deve, no domínio interno, com `source_type` e `source_id`.
- `charges`: tentativa ou meio de cobrança no gateway (boleto, Pix, cartão ou manual), ligada a um receivable.
- `payments`: pagamento efetivo, com valor bruto, taxas, valor líquido, datas e ID da transação no provider.
- `financial_movements`: ledger append-only com `RECEIVABLE_CREATED, PAYMENT_RECEIVED, REFUND, CANCELLATION, ADJUSTMENT, FEE, DISCOUNT, INTEREST, FINE`.
- `reconciliations`: vínculo entre receivable, charge, payment do provider e payment interno.

**Estados da charge:** `DRAFT, AWAITING_PROVIDER, PENDING, OVERDUE, PAID, PARTIALLY_PAID, CANCELLED, REFUNDED, FAILED`. O status do Asaas é mapeado para esse estado interno e nunca vaza para o domínio. Se o Asaas estiver fora do ar, o receivable existe e a charge fica em `AWAITING_PROVIDER` até a integração voltar.

**Operações específicas (nunca editar status à mão):**

- **Pagamento manual:** `REGISTER_MANUAL_PAYMENT` exige permissão, valor, método, justificativa e comprovante opcional.
- **Cancelamento:** valida permissão e estado → cancela no provider → registra → audita.
- **Estorno:** exige `finance.refund` e step-up, mostra cliente, valor e motivo antes de confirmar.

**Inadimplência:** tela com vencimento, dias de atraso, valor original, juros, multa, total e último contato, com filtros por faixa de atraso (1–7, 8–15, 16–30, 31–60, 60+).

**Portal do cliente, seção Financeiro:** abas Em aberto, Vencidos, Pagos e Todos. Cada cobrança tem os botões Abrir boleto, Baixar PDF, Copiar linha digitável, Copiar Pix e QR Code. Não existe botão falso de "abrir qualquer banco": o sistema copia a linha digitável e orienta o cliente a colar no app do banco.

---

## 10. Asaas

- Toda comunicação é server-side, exclusivamente no `AsaasPaymentProvider`. O fluxo é `PaymentService → PaymentProvider → Asaas`.
- O cliente é criado no Asaas na primeira cobrança, e o `provider_customer_id` é guardado como referência externa (não como chave primária).
- **A recorrência é interna:** contratos geram receivables, e cada receivable gera uma cobrança avulsa no Asaas. Assinaturas do Asaas não são usadas.
- Toda cobrança enviada leva `externalReference` com o ID interno da charge. O sistema guarda o ID do pagamento no Asaas, as URLs de fatura e boleto, a linha digitável e o Pix copia e cola.
- **As notificações nativas do Asaas ao cliente ficam desativadas.** Só o sistema notifica.
- **Juros e multa:** configurados no Asaas por boleto, conforme o contrato. Quando o valor pago diferir do receivable, a diferença entra no ledger como `INTEREST`/`FINE` a partir do webhook.
- **Webhook `POST /api/webhooks/asaas`:** valida o token do webhook (diferente da API key) → limita o tamanho do body → grava o evento bruto em `provider_webhook_events` com UNIQUE `(provider, event_id)` → responde 200 imediatamente → processa em job. O parser tolera campos desconhecidos. Estados do evento: `PENDING, PROCESSING, PROCESSED, FAILED, DEAD_LETTER`.
- **Conciliação periódica** por job cobre webhooks perdidos.
- **Pré-requisitos documentados:** chave Pix cadastrada na conta Asaas, token de webhook, API keys separadas de sandbox e produção.
- **NFS-e:** deixar a estrutura (tabela e interface) pronta para emissão via Asaas. A regra tributária será definida com a contabilidade.
- Nomes de eventos, campos e autenticação vêm da **documentação oficial atual** do Asaas.

---

## 11. WhatsApp e n8n

**Mensagens:** o fluxo é `evento no outbox → NotificationService` (verifica preferência, consentimento e telefone válido) `→ notification_job → MessagingProvider`. Usar somente a WhatsApp Business Platform oficial, com templates aprovados. Proibido: WhatsApp Web, QR Code de sessão pessoal, Selenium ou bibliotecas não oficiais.

- As mensagens de cobrança levam **link para o portal autenticado**, sem CPF, valores sensíveis ou IDs sequenciais na URL.
- Eventos com automação liga/desliga: `CHARGE_CREATED, CHARGE_DUE_SOON, CHARGE_DUE_TODAY, CHARGE_OVERDUE, PAYMENT_CONFIRMED, ORDER_CONFIRMED, ROUTE_STARTED, DELIVERY_COMPLETED, COLLECTION_COMPLETED`.
- **Anti-spam:** `idempotency_key = org:entidade:evento` com UNIQUE, cooldown e opt-out.
- A tabela `notifications` registra status `QUEUED, SENDING, SENT, DELIVERED, READ, FAILED, CANCELLED`, com ID da mensagem no provider e erro.
- Falha no envio nunca desfaz a cobrança nem a operação que gerou a mensagem.

**n8n (self-hosted) é orquestrador, não fonte de verdade.** Ele não tem regra de negócio, não acessa o banco e não recebe a service role key.

- **Comunicação backend → n8n:** eventos do outbox por webhook assinado com HMAC, contendo o `event_id`.
- **Comunicação n8n → backend:** API interna autenticada com o token INTEGRATION e `idempotency_key` em toda chamada.
- **Permitido:**
  - receber mensagens de WhatsApp de clientes e criar pedido `DRAFT` para confirmação humana;
  - usar o adapter `N8nMessagingProvider` para entregar mensagens e devolver o status por callback;
  - disparar rotinas agendadas (worker de jobs, recorrência, conciliação, lembretes de vencimento);
  - enviar alertas e relatórios agendados ao administrador.
- **Proibido:** receber o webhook do Asaas, criar ou cancelar cobrança, registrar pagamento, movimentar estoque ou mudar status diretamente.
- Se o n8n cair, os eventos continuam no outbox até serem confirmados.

---

## 12. Segurança, auditoria e LGPD

- **RLS** em todas as tabelas expostas: cliente vinculado ao `auth.uid()`, motorista às rotas atribuídas, admin e gerente à própria organização.
- **Proteções:** SQL injection, XSS, CSRF, SSRF, mass assignment (whitelist de campos por schema), path traversal, open redirect e enumeração de usuários.
- **Headers:** CSP (com `frame-ancestors`), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Nada de CORS `*` em API autenticada.
- **Uploads:** validação de MIME real, extensão, tamanho e quantidade; nome interno aleatório; bucket privado; acesso por signed URL com expiração.
- **Chaves do Google Maps:** chave de browser e chave de servidor separadas, ambas restritas por domínio e por API.
- **`audit_logs` append-only:** registra ator, ação, entidade, before/after, IP, user agent e correlation_id. Cobre alterações de cliente e contrato, ajustes de estoque, cobranças, cancelamentos, pagamentos manuais, estornos, permissões e usuários.
- **Logs:** estruturados, com `request_id` e `correlation_id`. Nunca registram senha, token, chave ou dados de cartão.
- **LGPD:** coletar só o necessário, registrar consentimento de comunicação e ter processo para exportar, corrigir e anonimizar dados, respeitando a retenção legal dos registros financeiros.

---

## 13. Dashboards, relatórios e UX

- **Dashboard admin:** pedidos, entregas e coletas do dia, rotas ativas, estoque por estado, perdas e danos, faturamento, valores recebidos, a receber, vencidos e inadimplentes, com filtro de período.
- **Diagnóstico de consistência:** estoque fecha com o total, receivables fecham com pagamentos, toda parada concluída tem operação ou justificativa, e o histórico de cada pedido é coerente. A ferramenta aponta problemas e não corrige nada automaticamente sem trilha de auditoria.
- **Alertas:** estoque abaixo do mínimo, webhook parado, jobs em dead letter, integração offline, ocorrências abertas, rotas não concluídas, saldo inconsistente, logins suspeitos.
- **Relatórios** (exportação em CSV/Excel, com permissão): clientes, pedidos, movimentação de toalhas, saldo por cliente, perdas e danos, lavanderia, rotas, faturamento, recebimentos, inadimplência e conciliação.
- **Busca global paginada** por cliente, CPF/CNPJ, telefone, pedido, cobrança, rota e motorista.
- **Interface profissional:** desktop first no admin, mobile first no motorista e no cliente. Inclui skeletons, estados vazios, toasts e acessibilidade (labels, foco, e status que não dependem só de cor).
- **Ações críticas mostram o impacto antes de confirmar.** Exemplo: "30 toalhas serão registradas como perdidas para o cliente X, reduzindo o saldo dele e gerando cobrança de R$ 450,00".
- **Menu admin:** Dashboard · Pedidos · Clientes · Contratos · Operação (Entregas, Coletas, Ocorrências) · Estoque (Visão geral, Movimentações, Lavanderia, Perdas/Danos) · Rotas (Rotas, Motoristas, Veículos) · Financeiro (Visão geral, Contas a receber, Cobranças, Pagamentos, Inadimplência, Conciliação) · Relatórios · Administração (Usuários, Permissões, Integrações, Automações, Auditoria, Configurações).
- **Portal do cliente:** próxima entrega, pedido atual, toalhas em posse, cobranças em aberto. Botões: Novo pedido, Meus pedidos, Minhas toalhas, Financeiro, Meus dados.

---

## 14. Testes obrigatórios (critério de aceite)

- **Estoque:** com 1000 disponíveis, entregar 100 deixa 900 disponíveis e 100 com o cliente. Coletar 80 deixa 20 com o cliente e 80 na lavanderia. Concluir a lavagem deixa 980 disponíveis e 20 com o cliente. Nenhuma toalha some.
- **Divergência:** com saldo de 100 e coleta de 94, o sistema registra `COLLECTION` de 94, mantém 6 com o cliente, abre ocorrência e gera alerta.
- **Perda cobrada:** gera exatamente um billable_event, um receivable, uma charge e uma mensagem.
- **Concorrência:** com 100 em estoque e duas reservas simultâneas de 80, só uma é confirmada.
- **Financeiro:** contrato de R$ 500 gera receivable, depois boleto, depois webhook de pagamento, que resulta em um único pagamento, ledger atualizado e conciliação. Reenviar o mesmo webhook não duplica nada.
- **Falha de WhatsApp:** a cobrança permanece, a notificação vai para `FAILED` e entra em retry.
- **Segurança:**
  - cliente A não acessa dados do cliente B, mesmo trocando o ID na URL;
  - motorista não acessa nada financeiro;
  - gerente sem `finance.refund` não consegue estornar;
  - organização A não acessa organização B;
  - duplo clique não gera duas cobranças;
  - upload inválido é rejeitado;
  - a service key não aparece no bundle do frontend.
- **Máquinas de estado:** toda transição fora da tabela é rejeitada.

---

## 15. Forma de trabalho

1. Analise o repositório existente (`package.json`, migrations, env, docs) antes de alterar qualquer coisa. Não destrua código funcional.
2. Crie e mantenha `IMPLEMENTATION_PLAN.md` com as fases e o progresso.
3. **Fases:**
   1. Fundação: projeto, schema base, organização, auth com MFA, RBAC, RLS, auditoria, layout, jobs e outbox.
   2. Clientes: cadastro, CSV, geocoding.
   3. Produtos, ledger de estoque e saldo por cliente.
   4. Pedidos, máquina de estados, reserva e recorrência.
   5. Motoristas, veículos, rotas e app do motorista.
   6. Entrega, coleta, prova, ocorrências, dano e perda.
   7. Lavanderia.
   8. Contratos.
   9. Financeiro interno.
   10. Asaas.
   11. WhatsApp e n8n.
   12. Dashboards e relatórios.
   13. Hardening: revisão de segurança como atacante, performance, backup e restore documentados, CI/CD com secret scan e audit de dependências.
4. **Ao fim de cada fase:** rodar lint, typecheck, testes e build, e corrigir os erros antes de avançar. O projeto sempre compila.
5. Integração sem credencial disponível: implemente interface, adapter, validação, env e tratamento de erro, com mocks só nos testes, e documente a credencial que falta. Nunca invente credenciais.
6. Decisões menores não especificadas: escolha a opção mais segura e sustentável, documente e siga sem perguntar.
7. **Documentação:** `README`, `ARCHITECTURE`, `SECURITY`, `DATABASE`, `INTEGRATIONS`, `DEPLOYMENT`, `RUNBOOK` e `.env.example` sem valores reais.
8. **Relatório ao fim de cada fase:** arquivos e migrations criados, funcionalidades entregues, testes executados, riscos pendentes e próxima fase.

**Comece agora pela Fase 1. Implemente, não apenas planeje.**
