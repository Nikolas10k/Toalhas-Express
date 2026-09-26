# Relatório — Fase 3: Produtos, ledger de estoque e saldo por cliente

**Status:** concluída · lint, typecheck, 170 testes (unitários + integração), 36 E2E e build verdes; nenhum segredo no bundle.

## Migration

`20260928000100_inventory.sql` — `products`, `towel_movements` (append-only), `stock_balances` (cache derivado por trigger), `system_alerts`, `app.apply_towel_movement()`, `app.inventory_consistency()`, RLS (equipe, portal só vê o próprio saldo, app nunca escreve saldo).

## Como o estoque funciona

Toda toalha está em exatamente um estado. Um movimento sempre **tira** a quantidade de um estado e **põe** em outro (entradas e ajustes usam o estado virtual "fora do sistema"). Por isso a soma dos estados fecha com o total por construção, e o saldo de cada cliente é literalmente entregues − coletadas ± ajustes.

| Tipo | De → para |
|---|---|
| Entrada | fora → disponível |
| Reserva / liberação | disponível ↔ reservado |
| Saída para rota | reservado (ou disponível) → em rota |
| Entrega | em rota → com o cliente |
| Coleta | com o cliente → aguardando lavagem (ou em rota) |
| Lavanderia | aguardando → em lavagem → em inspeção |
| Transferência | ex.: inspeção → disponível; em rota → disponível (não entregue) |
| Dano / perda / descarte | estado físico → danificado / perdido / descartado |
| Ajuste manual | fora ↔ qualquer estado (com motivo; grande exige autenticador) |

## Funcionalidades

- **Estoque** (`/admin/estoque`): tabela produto × estado com total, destaque de estoque abaixo do mínimo e alertas (inconsistência, saldo negativo, mínimo).
- **Movimentar estoque**: entrada, ajuste, transferência, dano, perda, descarte — em duas etapas, com **prévia do impacto** (saldo antes → depois em cada estado e valor de reposição) antes de confirmar. Idempotente (duplo clique não duplica).
- **Produtos** (`/admin/estoque/produtos`): SKU, nome, tamanho, categoria, custo, preço de reposição, mínimo, ativo; valores digitados em R$ e gravados em centavos.
- **Movimentações** (`/admin/estoque/movimentacoes`): histórico imutável com filtros; **estorno** gera movimento inverso (uma única vez).
- **Cliente → aba Toalhas**: saldo por produto, última entrega/coleta, valor de reposição e ajuste de saldo/registro de perda.
- **Portal → Minhas toalhas** e contador na tela inicial.
- **Verificação de consistência** diária (e reutilizável): recalcula tudo do ledger; abre alerta crítico se o cache divergir; resolve sozinha quando a condição some; nunca corrige dados.

## Testes (critérios de aceite da SPEC §14)

| Cenário | Resultado |
|---|---|
| 1000 disponíveis → entregar 100 → 900 disponíveis e 100 com o cliente | ✅ |
| Coletar 80 → 20 com o cliente e 80 aguardando lavagem | ✅ |
| Concluir lavagem → 980 disponíveis e 20 com o cliente, total 1000, sem divergência | ✅ |
| 100 em estoque, duas reservas simultâneas de 80 → só uma confirmada, a outra recebe "Estoque insuficiente" | ✅ |
| Saldo negativo, transição fora da tabela, movimento de cliente sem cliente | ✅ rejeitados |
| Operação composta com falha no meio → nada gravado | ✅ |
| Movimento reenviado com a mesma chave → não duplica | ✅ |
| Ledger não pode ser alterado/apagado; app não escreve em saldos | ✅ |
| Motorista não movimenta estoque; gerente não faz ajuste grande; admin sem MFA recente precisa de step-up | ✅ |
| Prévia de perda: 30 toalhas × R$ 15,00 = R$ 450,00 | ✅ |
| Cache adulterado → alerta crítico; estoque mínimo → alerta sem duplicar; resolução automática | ✅ |

**Bug encontrado pelos testes e corrigido:** com savepoint escrito em SQL manual, um erro tratado (ex.: movimento repetido) ainda fazia a transação inteira falhar no commit. Todos os savepoints passaram a usar o mecanismo nativo do driver (inclusive em clientes e produtos).

## Riscos e pendências

1. As telas autenticadas não foram exercitadas em navegador neste ambiente (sem Supabase local); regras cobertas por testes de service/RLS/banco.
2. Cobrança de perda/dano ao cliente (billable event → receivable → charge) entra nas Fases 6 e 9; por ora a prévia mostra o valor de reposição.
3. Lotes de lavanderia com etapas (WAITING → … → COMPLETED) entram na Fase 7; os movimentos de lavanderia já existem.

## Próxima fase

**Fase 4 — Pedidos:** pedidos DELIVERY/COLLECTION/DELIVERY_AND_COLLECTION com itens, janela, responsável e histórico; máquina de estados da SPEC; reserva de estoque com lock ao confirmar (override com permissão, motivo, auditoria e alerta); liberação ao cancelar/reagendar/desatribuir; recorrência com chave `rule_id:data`; pedidos DRAFT via n8n.
