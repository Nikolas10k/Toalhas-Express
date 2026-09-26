# Relatório — Fase 5: Motoristas, veículos, rotas e app do motorista

**Status:** concluída · lint, typecheck, 217 testes (unitários + integração), 50 E2E e build verdes; nenhum segredo no bundle.

## Migration

`20260930000100_routes.sql` — `vehicles`, `drivers`, `routes`, `route_stops`, `route_events` (append-only), FKs de `orders` e `towel_movements` para rota/parada/motorista, funções de RLS do motorista (`app.current_driver_id`, `app.driver_can_see_order`, `app.driver_can_see_customer`), `app.set_route_depot` e ajuste das políticas de pedidos, clientes e movimentos para o motorista.

## Como funciona

```
Pedido READY ──(montar rota)──▶ ROUTE_ASSIGNED ──(motorista inicia)──▶ IN_TRANSIT ──▶ (Fase 6: entrega/coleta)
                  reserva garantida           carrega o veículo: RESERVED → IN_ROUTE
```

| Momento | O que acontece (sempre numa única transação) |
|---|---|
| **Montar rota** | Trava os pedidos, exige READY + sem rota + mesma data, confere a capacidade do veículo e uma rota aberta por motorista/dia; pedidos vão para ROUTE_ASSIGNED com a reserva garantida; paradas numeradas na ordem escolhida |
| **Reordenar / otimizar** | Subir/descer paradas ou otimizar pela Google Routes API a partir da base de saída (distância e duração estimadas) |
| **Tirar da rota / cancelar rota** | Pedido volta a READY **mantendo a reserva**; no cancelamento as paradas ficam registradas como "não visitada" |
| **Iniciar rota** (motorista) | Carrega o veículo (RESERVED → IN_ROUTE, com rota, parada e motorista no movimento), pedidos vão para IN_TRANSIT, 1ª parada "a caminho". Repetir o toque não duplica nada |
| **Cheguei / Próxima** | Registra horário e geolocalização (se o celular não informar, fica registrado "sem geolocalização" e nada é bloqueado) |
| **Finalizar rota** | Só quando nenhuma parada ficou aberta |

## Funcionalidades

- **Rotas** (`/admin/rotas`): lista por data e status, paradas feitas, carga × capacidade, percurso; **base de saída** marcada no mapa.
- **Nova rota**: pedidos prontos da data em lista e no mapa (clique no ponto seleciona), numeração na ordem de seleção, motorista (com veículo padrão), barra de ocupação do veículo.
- **Detalhe da rota**: mapa numerado com o trajeto, paradas com subir/descer/remover, adicionar pedidos, trocar motorista/veículo, otimizar, cancelar, linha do tempo.
- **Motoristas** e **Veículos**: cadastro, status, vínculo do usuário do app, veículo padrão.
- **App do motorista** (`/motorista`, instalável como PWA): rota de hoje e próximas; na rota: Iniciar, parada atual com Navegar (abre o mapa do celular), Ligar, Cheguei, "Ir para esta parada", Finalizar. Só dados operacionais: cliente, endereço, telefone, observações e quantidades.

## Testes (critérios de aceite)

| Cenário | Resultado |
|---|---|
| Rota criada com pedidos prontos → ROUTE_ASSIGNED, paradas na ordem, reserva inalterada; duplo clique cria uma rota só | ✅ |
| Duas rotas disputando o mesmo pedido ao mesmo tempo → só uma leva | ✅ |
| Pedido não pronto, de outra data, capacidade excedida, data passada, segunda rota do motorista no dia → rejeitados sem deixar nada pela metade | ✅ |
| Reordenar exige a lista exata; remover parada e cancelar rota devolvem READY com a reserva | ✅ |
| Otimização: sem chave → mensagem clara; sem base → pede a base; ordem do provedor aplicada; falha externa ou resposta inválida → nada muda | ✅ |
| Motorista B não vê a rota, o pedido, o cliente nem os movimentos do motorista A (service **e** RLS direto); motorista não acessa planejamento | ✅ |
| Resposta do app do motorista sem notas internas nem valores | ✅ |
| Iniciar rota (dois toques simultâneos) → um carregamento só: RESERVED −10, IN_ROUTE +10, pedidos IN_TRANSIT | ✅ |
| Paradas: uma "a caminho" por vez, não sai da parada sem concluir, não finaliza com parada aberta, admin não cancela rota em andamento | ✅ |
| Geolocalização registrada quando existe; ausência registrada sem bloquear | ✅ |
| Rota de outro dia não inicia; motorista inativo perde o acesso ao app | ✅ |
| Google Routes: chave só no header, ordem otimizada aplicada, ordem inválida recusada, 403 não repete, > 25 paradas nem chama a API | ✅ |
| APIs e páginas exigem login; manifest, service worker e página offline sem dados (E2E) | ✅ |

## Mudança em decisão anterior

Na Fase 4, tirar um pedido da rota (→ READY) **liberava** a reserva. Com as rotas reais isso criaria corrida pelo estoque entre rotas, então agora a reserva é **mantida** (o pedido continua pronto). Testes da Fase 4 ajustados.

## Riscos e pendências

1. **Entregar, Coletar e Registrar problema** aparecem desabilitados no app: chegam na Fase 6 (com prova, divergência e ocorrências). Até lá, uma rota iniciada não consegue ser finalizada pelo app — o RUNBOOK explica a correção manual. Recomendo não iniciar rotas reais antes da Fase 6.
2. Otimização exige `GOOGLE_MAPS_SERVER_KEY` com **Routes API** habilitada e a base de saída cadastrada; sem isso, só ordem manual.
3. As telas autenticadas não foram exercitadas em navegador neste ambiente (sem Supabase Auth local); regras cobertas por testes de service/RLS/banco e todas as páginas compilam.
4. PWA sem modo offline de propósito (nenhum dado de cliente no aparelho, nenhuma ação enfileirada).

## Próxima fase

**Fase 6 — Entrega, coleta, prova e ocorrências:** registrar prevista × carregada × entregue (`DELIVERY`), coleta com saldo esperado e divergência automática (`QUANTITY_DIVERGENCE` + alerta), prova (recebedor, foto em bucket privado, horário, geolocalização), ocorrências, dano e perda com decisão e cadeia de cobrança preparada.
