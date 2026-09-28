# Relatório — Fase 7: Lavanderia

**Status:** concluída · lint, typecheck, 241 testes (unitários + integração), 60 E2E e build verdes; nenhum segredo no bundle.

## Migration

`20261002000100_laundry.sql` — `laundry_receipts` (+ itens), `laundry_batches` (+ numeração), `laundry_batch_items`, `laundry_inspections`, `laundry_batch_events`, FK de `towel_movements.laundry_batch_id`, RLS e as funções `app.laundry_queue()` / `app.pending_laundry_receipts()`.

## Como funciona

```
Coleta na parada ──▶ Aguardando lavagem
        │
Rota encerrada ──▶ Conferência na base (coletado × contado; diferença → ocorrência)
        │
Montar lote ──────▶ Em lavagem          (LAUNDRY_ENTRY)
Lavando → Secando → Dobrando
Ir para inspeção ─▶ Em inspeção         (LAUNDRY_EXIT)
Inspeção ─────────▶ Disponível / Danificada (ocorrência) / Descartada
```

Cancelar um lote só é possível antes de começar a lavar; as toalhas voltam para a fila.

## Funcionalidades

- **Estoque → Lavanderia**: fila por produto (aguardando, em lavagem, em inspeção), rotas a conferir com botão **Conferir**, lista de lotes e **Novo lote** (quantidades limitadas à fila).
- **Detalhe do lote**: etapas visuais, botão da próxima etapa, cancelamento com motivo, inspeção com aprovadas / com dano / descarte (a soma precisa fechar), tipo de dano, histórico.
- **Ocorrências**: falta na conferência pode ser registrada como perda interna (sem cobrança ao cliente); dano da inspeção pode voltar para a lavagem, ao estoque ou ser descartado.

## Testes

| Cenário | Resultado |
|---|---|
| **SPEC §14:** 1000 disponíveis → entrega 100 → coleta 80 → lavagem → **980 disponíveis e 20 com o cliente**, total 1000, sem divergência | ✅ |
| Etapas na ordem exata da SPEC; fora de ordem recusado; cancelar só antes de lavar | ✅ |
| Lote maior que a fila recusado; dois lotes simultâneos com as mesmas toalhas → só um | ✅ |
| Cancelar lote devolve as toalhas para a fila | ✅ |
| Inspeção que não fecha recusada; dano exige tipo; aprovadas, dano e descarte movimentam certo | ✅ |
| Dano da inspeção vira ocorrência sem cliente, sem opção de cobrança, e pode voltar ao estoque | ✅ |
| Conferência com falta: ocorrência; perda interna registrada; tentativa de cobrar o cliente recusada; conferência em dobro não duplica | ✅ |
| Motorista não monta lote | ✅ |
| Consistência do estoque (ledger × saldos) sem divergências ao final | ✅ |
| APIs e página exigem login (E2E) | ✅ |

## Riscos e pendências

1. As toalhas saem da fila ao **montar** o lote (não ao ligar a máquina). O estado "Em lavagem" inclui lotes ainda aguardando início.
2. A conferência é por rota; toalhas sujas geradas na base (ex.: uso interno) entram na fila por transferência manual em Estoque.
3. Telas autenticadas não foram exercitadas em navegador neste ambiente; regras cobertas por testes de service/RLS/banco.

## Próxima fase

**Fase 8 — Contratos:** contrato por cliente com franquia de toalhas, preço por entrega/peça/mensalidade, regras de cobrança de perda e dano, vigência e reajuste — base para o Financeiro (Fase 9).
