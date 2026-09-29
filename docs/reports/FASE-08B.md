# Relatório — Fase 8B: Lavanderia enxuta, enxoval de clientes, perfil Operador e romaneio

**Status:** concluída · lint, typecheck, 269 testes (unitários + integração), 68 E2E e build verdes; nenhum segredo no bundle.

Fase extra, pedida a partir da operação real: lavanderia própria (8 lavadoras, 5 secadoras, calandra, 7h–23h), cerca de 30% do faturamento vindo de higienização de enxoval de hotéis e spas, cobrado por peça.

## Migration

`20261004000100_linen_service.sql` — `products.kind`, trigger que impede movimento de estoque de enxoval, `linen_service_orders` (+ itens, eventos, numeração `OS-`), ajuste em `stop_operation_items` (coleta de enxoval sem saldo), perfil `OPERATOR`.

## Como funciona

**Toalhas de aluguel (processo enxuto):**

```
Coleta (motorista conta) ──▶ Sujas aguardando lavagem   (automático)
Lavar, secar, dobrar ──────▶ nada no sistema
Carrinho pronto ───────────▶ Lançar produção: boas → estoque | dano → ocorrência | descarte
```

**Enxoval de hotel/spa (roupa do cliente, fora do estoque):**

```
Parada: motorista conta o rol ──▶ OS-00001 "Na lavanderia"
Saiu pronta ───────────────────▶ "Pronta" (confere; falta exige explicação → ocorrência)
Planejamento de rotas ─────────▶ "Gerar entregas" (um pedido por cliente, já confirmado)
Parada: entrega o limpo e recolhe o sujo ──▶ OS entregue + nova OS
Fechamento do mês ─────────────▶ peças do rol × preço por peça do contrato
```

## Funcionalidades

- **Lavanderia**: abas *Toalhas de aluguel* (sujas por produto, Lançar produção, Informar diferença), *Enxoval de clientes* (OS por status, botão Pronta) e *Histórico de produção*.
- **App do motorista**: bloco "Enxoval do cliente" na parada (entregar limpas, coletar rol, peças que já vieram com dano, adicionar peça fora do previsto).
- **Rotas**: aviso de enxoval pronto com "Gerar entregas para <data>"; **Romaneio** de separação imprimível (totais do estoque, enxoval por cliente, lista por parada).
- **Produtos**: tipo Toalha de aluguel / Enxoval do cliente.
- **Contratos**: item de enxoval com preço por peça higienizada; simulação soma a linha de higienização.
- **Cliente 360°**: aba Enxoval.
- **Perfil Operador**: lavanderia, separação e rotas; sem clientes, contratos, estoque geral ou financeiro.

## Testes

| Cenário | Resultado |
|---|---|
| 1000 → entrega 100 → coleta 80 → produção (78 boas, 1 dano, 1 descarte): 978 disponíveis, 20 com o cliente, total 1000, ledger consistente | ✅ |
| Produção maior que as sujas recusada; repetir com a mesma chave não duplica | ✅ |
| Coleta de enxoval gera OS sem nenhum movimento de estoque | ✅ |
| Pronta com falta exige explicação; sobra impossível; falta vira ocorrência só com "nenhuma ação" | ✅ |
| Operador não gera entregas; gerar de novo não duplica; pedido confirmado sem reserva de estoque | ✅ |
| Entrega do limpo + coleta do sujo na mesma parada fecha a OS e abre outra | ✅ |
| Cobrança: 80 lençóis × R$ 2,50 + 20 fronhas × R$ 1,00 = R$ 220,00 | ✅ |
| Parada de entrega de enxoval não espera toalha de aluguel de volta; fronha entregue a menos vira ocorrência | ✅ |
| Enxoval sem estoque inicial; produto com histórico não muda de tipo; banco recusa movimento de enxoval | ✅ |
| Operador sem acesso a clientes e ao estoque geral | ✅ |

## Riscos e pendências

1. Telas autenticadas não foram exercitadas em navegador neste ambiente; regras cobertas por testes de service/RLS/banco.
2. Os lotes com etapas continuam existindo por baixo (histórico); a tela não oferece mais o fluxo por etapas.
3. Portal do hotel ainda não mostra as OS (pode entrar junto com o financeiro).

## Próxima fase

**Fase 9 — Financeiro interno:** fechamento mensal a partir dos contratos (aluguel + higienização), receivables, charges, pagamentos e ledger.
