# Relatório — Fase 4: Pedidos, máquina de estados, reserva e recorrência

**Status:** concluída · lint, typecheck, 197 testes (unitários + integração), 42 E2E e build verdes; nenhum segredo no bundle.

## Migration

`20260929000100_orders.sql` — `order_counters` + `app.next_order_number()`, `orders`, `order_items`, `order_status_history` (append-only), `recurring_order_rules`, FK de `towel_movements.order_id`, `app.can_see_customer_record()` e RLS (equipe, portal só os próprios pedidos, integração só os rascunhos que criou).

## Ciclo de vida do pedido

```
DRAFT → NEW → CONFIRMED → PREPARING → READY → ROUTE_ASSIGNED → IN_TRANSIT → DELIVERED → COMPLETED
                  ↘ RESCHEDULED → CONFIRMED          ↘ DELIVERY_PROBLEM → RESCHEDULED / CANCELLED
(cancelamento até READY; em trânsito, só via "problema na entrega")
```

| Evento | Efeito no estoque |
|---|---|
| Confirmar (NEW/RESCHEDULED → CONFIRMED) | Reserva as quantidades de entrega (disponível → reservado), com lock de linha |
| Atribuir rota (READY → ROUTE_ASSIGNED) | Garante a reserva (idempotente — não reserva duas vezes) |
| Cancelar, reagendar, tirar da rota (→ READY) | Libera tudo o que o pedido tinha reservado |
| Sem estoque suficiente | Bloqueia. Quem tem `order.override_stock` pode confirmar com motivo e autenticador recente: saldo fica negativo, alerta `STOCK_OVERRIDE`, auditoria `order.confirmed_with_stock_override` |

Tudo acontece na **mesma transação** do status, histórico, auditoria e outbox: ou tudo grava, ou nada grava.

Na tela de pedidos só aparecem as transições manuais. Atribuição de rota, trânsito, entrega e conclusão ficam para os fluxos de rota e entrega (Fases 5 e 6), que vão registrar prova e movimentos de estoque.

## Funcionalidades

- **Pedidos** (`/admin/pedidos`): contadores por status, filtro por status, período e busca por cliente/número.
- **Novo pedido**: busca de cliente (só ativos), tipo, data e janela, itens por produto (entregar/coletar), observações e notas internas, "confirmar agora". Idempotente: duplo clique não cria dois pedidos.
- **Detalhe**: itens com quantidade reservada, endereço copiado do cadastro, histórico completo, botões de ação conforme permissão; cancelar/reagendar pedem motivo (e nova data); sem estoque, quem pode vê a opção "Confirmar sem estoque".
- **Recorrências** (`/admin/pedidos/recorrencias`): regra por dias da semana, janela, itens e vigência; ativar/desativar. O job diário gera os pedidos dos próximos 7 dias sem duplicar.
- **Cliente → aba Pedidos** na visão 360°.
- **Portal**: Novo pedido (só com cadastro ativo; endereço do cadastro), Meus pedidos, acompanhamento, cancelamento enquanto o pedido é NEW; cartões "Pedido atual" e "Próxima entrega" na tela inicial.
- **n8n**: `POST /api/integration/v1/orders` cria **rascunho** (cliente por ID ou telefone), sempre com `Idempotency-Key`. Um rascunho só vira pedido depois que alguém da equipe aprova.
- **Eventos** no outbox: `OrderCreated`, `OrderConfirmed`, `OrderCancelled`, `OrderStatusChanged`.

## Testes (critérios de aceite)

| Cenário | Resultado |
|---|---|
| Máquina de estados: as 144 combinações de status conferidas contra a tabela da SPEC | ✅ |
| Confirmar reserva; cancelar libera; eventos no outbox | ✅ |
| Sem estoque → bloqueado e nada muda | ✅ |
| Override: gerente negado; admin sem autenticador recente → step-up; admin com motivo → saldo −5, alerta e auditoria | ✅ |
| Reagendar libera; reconfirmar reserva de novo; atribuir rota é idempotente; tirar da rota libera | ✅ |
| Transição fora da tabela, transição de rota feita manualmente e cancelar em trânsito → rejeitados | ✅ |
| Data no passado, cliente pendente, motorista tentando criar → rejeitados | ✅ |
| 5 pedidos criados em paralelo → números sequenciais sem repetição | ✅ |
| Duplo clique com a mesma chave → um pedido só | ✅ |
| Portal: cria só para o próprio cliente, não vê pedidos de outros, cancela só NEW, não vê motivos internos nem nomes da equipe | ✅ |
| n8n: rascunho pelo telefone, retry com a mesma chave devolve o mesmo pedido; token só enxerga os rascunhos que criou | ✅ |
| Itens, histórico e pedidos não podem ser apagados nem reescritos pelo app (privilégio mínimo) | ✅ |
| Recorrência rodando duas vezes em paralelo → nenhuma ocorrência duplicada | ✅ |
| APIs e páginas de pedidos exigem login; integração sem token válido → 401 sem stack trace (E2E) | ✅ |

## Riscos e pendências

1. As telas autenticadas não foram exercitadas em navegador neste ambiente (sem Supabase Auth local); as regras estão cobertas por testes de service/RLS/banco e o build compila todas as páginas.
2. O worker roda uma vez por dia (limite do plano Hobby da Vercel), então recorrências são geradas às 03:00 (horário de Brasília) para 7 dias à frente. Com o plano Pro ou o n8n chamando `/api/internal/jobs/run`, a frequência aumenta.
3. Notificações ao cliente (pedido confirmado/reagendado) dependem do WhatsApp — Fase 11. Os eventos já estão no outbox.
4. Edição dos itens de um pedido já criado não foi incluída: para mudar, cancela-se e cria-se outro (preserva a trilha de reserva). Pode entrar depois se a operação pedir.

## Próxima fase

**Fase 5 — Motoristas, veículos e rotas:** cadastro de motoristas e veículos, montagem de rota com pedidos READY (atribuição → reserva garantida), ordenação de paradas, app do motorista (PWA) com isolamento total (só as próprias rotas, nada financeiro).
