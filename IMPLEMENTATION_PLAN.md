# Plano de implementação

Fonte da verdade: [`docs/SPEC.md`](docs/SPEC.md). Cada fase termina com lint, typecheck, testes e build verdes e um relatório em `docs/reports/`.

| Fase | Escopo | Status |
|---|---|---|
| 1 | Fundação: projeto, schema base, organização, auth com MFA, RBAC, RLS, auditoria, layout, jobs e outbox | ✅ Concluída — [relatório](docs/reports/FASE-01.md) |
| 2 | Clientes: cadastro (auto cadastro com aprovação, admin, CSV), geocoding, visão 360° | ✅ Concluída — [relatório](docs/reports/FASE-02.md) |
| 3 | Produtos, ledger de estoque (`towel_movements`) e saldo por cliente | ✅ Concluída — [relatório](docs/reports/FASE-03.md) |
| 4 | Pedidos, máquina de estados, reserva com lock e recorrência | ✅ Concluída — [relatório](docs/reports/FASE-04.md) |
| 5 | Motoristas, veículos, rotas e app do motorista (PWA) | ✅ Concluída — [relatório](docs/reports/FASE-05.md) |
| 6 | Entrega, coleta, prova, ocorrências, dano e perda | ✅ Concluída — [relatório](docs/reports/FASE-06.md) |
| 7 | Lavanderia (`laundry_batches`) | ✅ Concluída — [relatório](docs/reports/FASE-07.md) |
| 8 | Contratos e regras de cobrança | ✅ Concluída — [relatório](docs/reports/FASE-08.md) |
| 8B | Lavanderia enxuta, enxoval de clientes (hotéis/spas), perfil Operador e romaneio | ✅ Concluída — [relatório](docs/reports/FASE-08B.md) |
| 9 | Financeiro interno (billable events, receivables, charges, payments, ledger) | ⏳ Próxima |
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

## Fase 5 — checklist

- [x] `vehicles` (placa antiga/Mercosul, capacidade em toalhas, status) e `drivers` (CPF, telefone, usuário do app, veículo padrão, status)
- [x] `routes` (PLANNED → IN_PROGRESS → COMPLETED/CANCELLED), `route_stops` (8 status da SPEC), `route_events` append-only com geolocalização
- [x] Planejamento: pedidos READY da data no mapa, seleção em ordem, motorista/veículo, capacidade, uma rota aberta por motorista/dia, pedido em uma rota só (lock)
- [x] Atribuição READY → ROUTE_ASSIGNED garante a reserva; tirar da rota ou cancelar a rota mantém a reserva (pedido volta a READY)
- [x] Ordenação manual (subir/descer) e otimização pela Google Routes API a partir da base de saída, com distância e duração
- [x] App do motorista (PWA): rota do dia, próxima parada, Iniciar rota (carrega o veículo RESERVED → IN_ROUTE, pedidos IN_TRANSIT), Navegar, Ligar, Cheguei, Próxima, Finalizar
- [x] Isolamento do motorista no backend e no RLS (só as próprias rotas; clientes só com rota aberta; nada financeiro)
- [x] Telas: Rotas (com base de saída), Nova rota, Detalhe (mapa, paradas, linha do tempo), Motoristas, Veículos

## Fase 6 — checklist

- [x] Atendimento da parada numa transação: operação + itens (previsto × carregado × entregue; esperado × saldo × coletado × danificado) → movimentos → ocorrências → status → outbox
- [x] Coleta com divergência cria `QUANTITY_DIVERGENCE` + alerta automaticamente; o restante segue com o cliente (nada corrigido em silêncio)
- [x] Entrega a menor cria ocorrência; toalhas não entregues voltam ao estoque ao finalizar a rota
- [x] Prova: recebedor, horário, geolocalização (ausência registrada sem bloquear) e fotos (obrigatórias se configurado)
- [x] Fotos: tipo real pelos bytes, 5 MB, nome aleatório, bucket privado, link assinado de 5 min; redução no aparelho sem EXIF
- [x] Problema na parada (fechado, recusa, endereço, outro) → parada FAILED/SKIPPED, pedido DELIVERY_PROBLEM, ocorrência
- [x] Ocorrências OPEN → UNDER_REVIEW → RESOLVED | CANCELLED, responsável, histórico, fotos
- [x] Dano (classificação + decisão RETURN_TO_LAUNDRY / RETURN_TO_STOCK / DISCARD / CHARGE_CUSTOMER) e perda (registrar com ou sem cobrança) com prévia do impacto
- [x] `billable_events` gerado uma única vez por ocorrência (unique + trigger de imutabilidade); receivable/charge na Fase 9
- [x] Finalizar rota devolve o que não foi entregue, conclui pedidos entregues e libera os com problema para replanejamento; equipe pode encerrar
- [x] Telas: app do motorista (Atender, Registrar problema), Entregas, Coletas, Ocorrências, Perdas/Danos, abas do cliente, prova na rota, configuração da foto

## Fase 7 — checklist

- [x] Conferência na base por rota (esperado = coletado nas paradas × contado), uma vez por rota; diferença vira ocorrência (falta = possível perda interna; sobra = investigar)
- [x] `laundry_batches` WAITING → WASHING → DRYING → FOLDING → INSPECTION → COMPLETED (cancelar só antes de lavar)
- [x] Movimentos: montar lote (aguardando → em lavagem), ir para inspeção (em lavagem → em inspeção), inspeção (→ disponível / danificada / descarte), cancelar (→ volta à fila)
- [x] Inspeção precisa fechar (aprovadas + dano + descarte = lote); dano vira ocorrência sem cliente com destino decidido pela equipe
- [x] Leituras da lavanderia com permissão própria (`laundry.read`) via funções no banco
- [x] Critério de aceite SPEC §14: 1000 → entrega 100 → coleta 80 → lavagem = 980 disponíveis e 20 com o cliente, sem divergência
- [x] Telas: Lavanderia (fila, conferência, lotes) e detalhe do lote (etapas, inspeção, histórico)

## Fase 8 — checklist

- [x] Contrato por cliente: número `CT-00001`, vigência, status DRAFT → ACTIVE ↔ SUSPENDED → ENDED / DRAFT → CANCELLED, renovação (automática, manual, sem), dia de vencimento 1–28
- [x] Tipos de cobrança `MONTHLY_FIXED | PER_DELIVERY | PER_QUANTITY | HYBRID | CUSTOM` com validação do que cada um exige
- [x] Itens: quantidade contratada, franquia, preço por peça, excedente, perda e dano (vazio = preço de reposição)
- [x] Um contrato vigente por cliente (índice único parcial); cliente pendente não ativa
- [x] Cálculo do mês em serviço de domínio puro (centavos, proporcional, desconto em pontos-base); simulação usa as entregas reais
- [x] Alteração de contrato vigente exige motivo; revisão imutável + auditoria com antes/depois
- [x] Resolução de perda/dano usa o preço do contrato vigente
- [x] Job diário de renovação (estende ou encerra, idempotente)
- [x] Telas: Contratos (lista, novo, detalhe com simulação e revisões), aba Contrato do cliente, "Meu contrato" no portal

## Fase 8B — checklist

- [x] Lavanderia enxuta: "Lançar produção" (boas / dano / descarte) num passo; sem lotes e etapas obrigatórios; mesmo ledger por baixo
- [x] Conferência na base opcional ("Informar diferença"), só para rotas recentes; a contagem do motorista vale
- [x] Produto com tipo: toalha de aluguel (estoque) ou enxoval do cliente (sem estoque; trigger no banco impede movimento)
- [x] OS de enxoval: coleta com rol na parada → pronta (falta exige explicação e vira ocorrência) → entrega gerada em lote → entregue
- [x] Coleta e entrega do enxoval nas mesmas rotas e no mesmo app do motorista; peça fora do previsto pode ser adicionada na hora
- [x] Cobrança por peça higienizada (rol da coleta) em qualquer tipo de contrato
- [x] Perfil Operador (lavanderia e separação); romaneio de separação por rota (impressão)
- [x] Telas: Lavanderia (aluguel, enxoval, histórico), aviso "gerar entregas" no planejamento, aba Enxoval do cliente, produto com tipo, contrato com preço por peça lavada

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
| D24 | Sair da rota (→ READY) mantém a reserva (antes liberava) | O pedido continua pronto e vai para outra rota; liberar criaria corrida pelo estoque entre rotas |
| D25 | Carregamento (DELIVERY_DISPATCH) acontece ao **iniciar a rota**, no app do motorista | É o momento físico em que as toalhas saem; pedidos passam a IN_TRANSIT na mesma transação |
| D26 | Rota em andamento não é cancelada pelo admin | As toalhas já saíram: cada parada precisa de desfecho (entrega, coleta ou problema — Fase 6) |
| D27 | Otimização chama o Google fora da transação e só aplica se as paradas não mudaram | Lock nunca fica preso esperando rede; resposta do provedor é validada (permutação exata) |
| D28 | Service worker sem cache de dados e sem fila offline | Dados de clientes não ficam no aparelho; nenhuma ação "fantasma" é registrada depois |
| D29 | Motorista vê dados do cliente só com a rota aberta | Minimização (LGPD): depois de concluída, o histórico da rota fica sem dados pessoais para ele |
| D30 | Pedido confirmado (ou em separação) pode entrar direto na rota; o sistema avança PREPARING → READY → ROUTE_ASSIGNED | Operação não precisa clicar etapa por etapa; cada avanço fica no histórico com o motivo "Avançado ao montar a rota" |
| D31 | Coleta vai direto para "aguardando lavagem"; dano informado na coleta vira ocorrência e o destino (lavar, estoque, descarte, cobrança) é decidido pela equipe | Motorista não decide sobre estoque/cobrança; decisão fica auditada com impacto mostrado antes |
| D32 | Coleta esperada = quantidade do pedido; sem quantidade no pedido, o saldo do cliente | Pedido de "trocar tudo" é o caso comum; pedido com quantidade explícita não gera falsa divergência |
| D33 | Não se coleta mais do que o saldo do cliente no sistema | Evita saldo negativo; excedente vira ocorrência para investigação |
| D34 | Cobrança de perda/dano nasce como `billable_event` imutável e único por ocorrência | Cadeia billable_event → receivable → charge (Fase 9) sem risco de cobrança dupla |
| D35 | Movimento interno pode declarar `authorizedBy` (só serviços; a API de estoque nunca) | Retorno automático de toalhas no fim da rota sem dar ao motorista a permissão geral de estoque |
| D36 | Fotos reduzidas no aparelho (≤ 1600 px, JPEG) antes do upload | Rápido no 4G e remove EXIF (localização vai no registro, não na imagem) |
| D37 | Toalhas saem da fila ao **montar** o lote (não ao começar a lavar) | Dois lotes nunca disputam as mesmas toalhas; cancelar antes de lavar devolve à fila |
| D38 | Conferência na base não corrige estoque; diferença vira ocorrência | Nada corrigido em silêncio; a decisão (perda interna ou nenhuma ação) fica auditada |
| D39 | Falta na conferência é perda interna e nunca gera cobrança ao cliente | A coleta já foi confirmada com o cliente na parada; o sumiço aconteceu depois |
| D40 | Dano achado na lavanderia vira ocorrência sem cliente (sem opção de cobrar) | Desgaste de uso interno; destino (lavar de novo, estoque, descarte) decidido com impacto visível |
| D41 | Um contrato vigente (ACTIVE/SUSPENDED) por cliente, garantido no banco | Evita cobrança dupla e ambiguidade no preço de perda/dano |
| D42 | Uso variável = toalhas efetivamente entregues nas paradas concluídas | Cobrança baseada no que aconteceu, não no que foi pedido |
| D43 | Mensalidade proporcional aos dias de vigência no mês (configurável), arredondamento meio-para-cima em centavos | Início/fim no meio do mês sem conta manual; inteiros evitam erro de ponto flutuante |
| D44 | Preço de perda/dano vem do contrato por função SECURITY DEFINER, independente de quem resolve | O valor cobrado não pode variar conforme a permissão de quem clica |
| D45 | `CUSTOM` não calcula variável automaticamente (só mensalidade, se houver) | Regras fora do padrão ficam com o financeiro, sinalizadas como manuais |
| D46 | Lavanderia registra só a saída ("Lançar produção"); por baixo vira um lote concluído | Rotina da operação (8 lavadoras, 16h/dia) não comporta etapas por máquina; o ledger continua fechando |
| D47 | Conferência na base é opcional; vale a contagem do motorista na coleta | Evita contar duas vezes; diferença ainda vira ocorrência quando informada |
| D48 | Enxoval do cliente é um tipo de produto que nunca entra no ledger (garantido por trigger) | A roupa é do hotel: misturar com o estoque de aluguel falsearia saldos |
| D49 | Cobrança do enxoval pelo rol da coleta, por peça, em qualquer tipo de contrato | Prática do mercado de hotelaria; o hotel pode ter aluguel e higienização no mesmo contrato |
| D50 | Entrega do enxoval pronto é gerada pelo planejamento (um pedido por cliente), não pela lavanderia | Operador não precisa de permissão de pedidos; quem planeja a rota decide a data |
| D51 | Falta de peça do cliente na saída exige explicação e abre ocorrência sem movimento de estoque | Responsabilidade perante o hotel fica registrada; resolução só administrativa |
