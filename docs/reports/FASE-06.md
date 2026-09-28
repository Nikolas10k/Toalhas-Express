# Relatório — Fase 6: Entrega, coleta, prova, ocorrências, dano e perda

**Status:** concluída · lint, typecheck, 233 testes (unitários + integração), 56 E2E e build verdes; nenhum segredo no bundle.

## Migration

`20261001000100_operations.sql` — `stop_operations`, `stop_operation_items`, `incidents` (+ numeração), `incident_events`, `billable_events`, `attachments`, `app.customer_product_balance()`, RLS, configuração `operations.requireProofPhoto` e bucket privado `operation-proofs`.

## Como funciona

```
Motorista chega → Atender: entregues / coletadas / com dano + recebedor + foto + local
   │  (uma transação)
   ├─ COLLECTION  com o cliente → aguardando lavagem
   ├─ DELIVERY    em rota → com o cliente
   ├─ diferença?  → ocorrência QUANTITY_DIVERGENCE + alerta (o restante segue com o cliente)
   ├─ dano?       → ocorrência DAMAGED (toalhas separadas, decisão da equipe)
   └─ parada concluída, pedido ENTREGUE, evento DeliveryCompleted

Problema na parada → ocorrência + parada com problema + pedido "Problema na entrega"
Finalizar rota     → não entregues voltam ao estoque; entregues → CONCLUÍDO; com problema → livres para replanejar
```

| Decisão na ocorrência | Estoque | Cobrança |
|---|---|---|
| Voltar para a lavagem | nada muda (já está aguardando lavagem) | — |
| Voltar ao estoque | aguardando lavagem → danificada → disponível | — |
| Descartar | → danificada → descartada | — |
| Descartar e cobrar | → danificada → descartada | 1 cobrável: qtd × preço de reposição |
| Registrar perda | com o cliente → perdida | opcional: 1 cobrável |
| Sem movimentação | — | — |

Antes de confirmar, a tela mostra o impacto, ex.: *"6 toalhas de Toalha banho serão registradas como perdidas para Spa X, reduzindo o saldo dele para 0 e gerando cobrança de R$ 90,00."*

## Funcionalidades

- **App do motorista**: botão **Atender** (por produto: entregues, coletadas, com dano + tipo de dano; nome de quem recebeu; foto pela câmera; observações; avisos do que vai virar ocorrência) e **Registrar problema** (com foto).
- **Operação → Entregas / Coletas**: registros do dia com previsto × realizado, recebedor, local, fotos e ocorrências.
- **Operação → Ocorrências** e **Estoque → Perdas/Danos**: lista com filtros, ocorrência manual, detalhe com histórico, fotos, saldo do cliente, análise, cancelamento e resolução com prévia.
- **Rotas**: atendimentos registrados na rota, "Problema" por parada pela equipe e **Encerrar rota**.
- **Cliente 360°**: abas **Entregas/Coletas** e **Ocorrências**.
- **Configurações**: "Foto obrigatória na prova".

## Testes (critérios de aceite da SPEC §14)

| Cenário | Resultado |
|---|---|
| 1000 disponíveis → entregar 100 → 900 disponíveis e 100 com o cliente; pedido concluído ao finalizar | ✅ |
| **Divergência:** saldo 100, coleta 94 → `COLLECTION` 94, 6 com o cliente, ocorrência e alerta | ✅ |
| **Perda cobrada:** exatamente um fato cobrável (6 × R$ 15,00 = R$ 90,00), mesmo com duas confirmações simultâneas | ✅ |
| Entrega a menor (10 → 7): ocorrência; 3 voltam ao estoque ao finalizar | ✅ |
| Problema na parada: pedido em problema, toalhas voltam, pedido reagendado entra em outra rota | ✅ |
| Não entrega mais que carregou, não coleta mais que o saldo, exige recebedor, exige foto quando configurado | ✅ |
| Duplo envio do atendimento → um registro e um movimento só | ✅ |
| Upload: texto/SVG/PDF recusados pelo conteúdo, > 5 MB recusado, nome aleatório; foto de outra pessoa não pode ser usada | ✅ |
| Dano: ocorrência com classificação; descartar e cobrar → descarte + cobrável de R$ 30,00; não resolve duas vezes | ✅ |
| Motorista não resolve ocorrência e não enxerga cobráveis (RLS) | ✅ |
| Quem não tem `finance.create_charge` não gera cobrança (mas pode registrar perda sem cobrar) | ✅ |
| Máquina de estados de ocorrências: toda transição fora da tabela é rejeitada | ✅ |
| APIs/páginas exigem login; upload de outra origem bloqueado (E2E) | ✅ |

**Achado pelos testes e corrigido:** nome do recebedor com 1 letra passava na validação da API e só o banco recusava; agora a API responde com mensagem clara.

## Riscos e pendências

1. **Fotos em produção** dependem de `SUPABASE_SERVICE_ROLE_KEY` na Vercel (já usada nos convites). Sem ela, o upload fica indisponível e o resto funciona.
2. Cobráveis ficam **pendentes** até o Financeiro (Fase 9) gerar conta a receber e cobrança.
3. Coleta leva direto para "aguardando lavagem"; lotes de lavanderia (lavagem → inspeção → disponível) entram na Fase 7.
4. Telas autenticadas não foram exercitadas em navegador neste ambiente (sem Supabase Auth local); regras cobertas por testes de service/RLS/banco.

## Próxima fase

**Fase 7 — Lavanderia:** lotes (`laundry_batches`) com etapas aguardando → em lavagem → inspeção → concluído, entrada/saída com contagem, perdas/danos na inspeção e retorno ao estoque disponível.
