# Relatório — Fase 8: Contratos e regras de cobrança

**Status:** concluída · lint, typecheck, 258 testes (unitários + integração), 64 E2E e build verdes; nenhum segredo no bundle.

## Migration

`20261003000100_contracts.sql` — `contracts` (+ numeração `CT-`), `contract_items`, `contract_revisions` (append-only), FK `orders.contract_id`, RLS e a função `app.contract_loss_damage_price()`.

## Como funciona

```
Rascunho ──ativar──▶ Vigente ◀──reativar── Suspenso
   │                   │  └──suspender──▶     │
cancelar            encerrar ◀────────────────┘
```

- Só **um contrato vigente por cliente** (garantido no banco). Cliente com cadastro pendente não ativa contrato.
- Tipos: mensalidade fixa, por entrega, por peça entregue, híbrido (mensalidade + excedente acima da franquia) e personalizado.
- Perda e dano: preço do contrato por produto; sem preço no contrato, vale o preço de reposição do produto. A resolução de ocorrências já usa esse valor.
- Alterar um contrato vigente exige **motivo**; cada alteração gera uma revisão imutável e auditoria com antes/depois.
- Renovação diária: automática estende a vigência; manual/sem renovação encerra ao vencer.

## Funcionalidades

- **Contratos**: lista com filtros, novo contrato (rascunho), detalhe com ações de status, edição, **simulação do mês** (com as entregas reais) e histórico de revisões.
- **Cliente 360°**: aba Contrato com os contratos do cliente e atalho para criar.
- **Portal**: "Meu contrato" com condições, franquia e preços de perda/dano (sem observações internas).

## Testes

| Cenário | Resultado |
|---|---|
| Rascunho → vigente; segundo vigente para o mesmo cliente recusado | ✅ |
| Alteração de vigente sem motivo recusada; com motivo gera revisão e auditoria antes/depois | ✅ |
| Contrato encerrado não pode ser alterado; transição inválida recusada | ✅ |
| Cliente pendente não ativa; mensalidade obrigatória no tipo fixo; motorista não cria | ✅ |
| **Híbrido:** franquia 50, entregues 80 → R$ 500 + 30 × R$ 3 = **R$ 590** | ✅ |
| Perda de 4 peças cobrada pelo preço do contrato (R$ 25) = R$ 100 | ✅ |
| Proporcional, desconto, vencimento, fora da vigência, renovação de fim de mês (unitários) | ✅ |
| Renovação automática estende; manual encerra; rodar de novo não faz nada | ✅ |
| Portal vê só o próprio contrato vigente, sem notas internas; não vê rascunho nem de outro cliente | ✅ |
| APIs e páginas exigem login (E2E) | ✅ |

## Riscos e pendências

1. A simulação mostra o valor; a geração do lançamento (receivable) e da cobrança entra na Fase 9.
2. `CUSTOM` só calcula a mensalidade; o variável fica para lançamento manual.
3. Reajuste por índice (IPCA/IGP-M) é manual, via edição com motivo.

## Próxima fase

**Fase 9 — Financeiro interno:** billable events → receivables → charges, pagamentos e ledger, com o fechamento mensal a partir dos contratos.
