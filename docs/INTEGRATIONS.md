# Integrações

Todos os serviços externos ficam atrás de interfaces em `src/server/providers/`. Falha externa nunca derruba nem desfaz operação interna: o estado pendente é registrado e o worker tenta de novo.

| Integração | Interface | Fase | Status | Credenciais |
|---|---|---|---|---|
| Supabase Auth | `src/server/supabase/*` | 1 | ✅ Ativa | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| PostgreSQL | `src/server/db/*` | 1 | ✅ Ativa | `DATABASE_URL` (Supavisor, modo transação, porta 6543) |
| n8n (outbox) | `OutboxPublisher` → `N8nOutboxPublisher` | 1/11 | ✅ Adapter pronto | `N8N_OUTBOX_WEBHOOK_URL`, `N8N_OUTBOX_HMAC_SECRET` — **faltam** |
| Asaas | `PaymentProvider` | 10 | Interface | `ASAAS_API_URL`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` — **faltam** |
| Google Maps (Geocoding + Routes) | `MapsProvider` → `GoogleMapsProvider` | 2/5 | ✅ Adapter pronto | `GOOGLE_MAPS_SERVER_KEY` — **falta** (sem ela, localização fica pendente e a otimização de rota fica indisponível) |
| OpenStreetMap (tiles do mapa) | `LocationMap` (Leaflet) | 2 | ✅ Ativo | nenhuma (atribuição exibida no mapa) |
| WhatsApp Business Platform | `MessagingProvider` | 11 | Interface | via n8n — **faltam** |
| Supabase Storage | `StorageProvider` → `SupabaseStorageProvider` | 6 | ✅ Adapter pronto | usa `SUPABASE_SERVICE_ROLE_KEY` só no servidor; bucket privado `operation-proofs` criado pela migration |

## Supabase

Configuração necessária no painel (por ambiente):

1. **Authentication → Providers → Email**: habilitado; *Confirm email* ligado; *Allow new users to sign up* **desligado** (até a Fase 2).
2. **Authentication → Multi-Factor**: TOTP habilitado (enroll + verify).
3. **Authentication → URL Configuration**: *Site URL* = `APP_URL`; *Redirect URLs* inclui `${APP_URL}/auth/confirm`.
4. **Authentication → Email Templates** (Reset password e Invite): usar o link com `token_hash`:
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/redefinir-senha` (troque `type=invite` no template de convite).
5. **Authentication → Password**: mínimo 12, letras maiúsculas/minúsculas e dígitos; proteção contra senhas vazadas (se disponível no plano).
6. **JWT Signing Keys**: preferir chaves assimétricas (verificação local de `getClaims()` sem ida ao Auth).
7. **API → Data API**: pode permanecer ligado — `anon`/`authenticated` não têm privilégios. Opcionalmente, desligar.

## n8n

O n8n é **orquestrador, não fonte de verdade**: não acessa o banco, não recebe a service role key, não recebe o webhook do Asaas, não cria/cancela cobrança, não registra pagamento, não movimenta estoque.

**Backend → n8n (eventos do outbox)**

- `POST ${N8N_OUTBOX_WEBHOOK_URL}` com JSON `{ event_id, event_type, organization_id, aggregate_type, aggregate_id, occurred_at, correlation_id, payload }`.
- Headers: `x-toalhas-event-id`, `x-toalhas-signature: t=<epoch>,v1=<hmac_sha256_hex(secret, "<t>.<body>")>`.
- O workflow deve: validar a assinatura em tempo constante, rejeitar `t` com mais de 5 minutos, deduplicar por `event_id`, responder 2xx só após persistir. Qualquer não-2xx gera retry com backoff.

**n8n → backend**

- Header `Authorization: Bearer txi_...` (token INTEGRATION) e `Idempotency-Key` em toda chamada de escrita.
- `GET /api/integration/v1/whoami` — valida o token.
- `POST /api/internal/jobs/run` — dispara um ciclo do worker (exige `jobs.run`).
- `POST /api/integration/v1/orders` — cria pedido **DRAFT** (permissão `order.create_draft`, `Idempotency-Key` obrigatório). Corpo: `{ customerId? | customerPhone?, type, scheduledDate: "YYYY-MM-DD", windowStart?, windowEnd?, items: [{ productId, deliveryQuantity, collectionQuantity }], notes? }`. Resposta `201 { id, number, status: "DRAFT", replayed: false }`; retry com a mesma chave devolve `200` com o mesmo pedido e `replayed: true`. Telefone ambíguo ou desconhecido → `404`. O rascunho só vira pedido depois de aprovado por alguém da equipe.
- Eventos de pedido publicados no outbox: `OrderCreated`, `OrderConfirmed`, `OrderCancelled`, `OrderStatusChanged` (payload com `order_id`, `number`, `customer_id`, `from`, `to`, `scheduled_date`).
- Próximas fases: callback de status de mensagem.

## Asaas (Fase 10) — pré-requisitos

- Chave Pix cadastrada na conta Asaas.
- API keys **separadas** de sandbox (`https://api-sandbox.asaas.com/v3`) e produção.
- Token de autenticação do webhook (diferente da API key), configurado no painel do Asaas e em `ASAAS_WEBHOOK_TOKEN`.
- Notificações nativas do Asaas ao cliente **desativadas**.
- Nomes de eventos, campos e autenticação serão conferidos na documentação oficial vigente no momento da implementação.

## Google Maps

- **Geocoding (Fase 2):** chave de servidor `GOOGLE_MAPS_SERVER_KEY`, restrita por API (Geocoding API; Routes API na Fase 5). Chamadas com `region=br`, `language=pt-BR`, `components=country:BR` e `bounds` do Distrito Federal (preferência, não restrição — ajuda endereços como SQS/SQN e quadras). A região padrão fica em `src/lib/geo/defaults.ts`, que também define o centro dos mapas (Brasília).
- Cada cadastro/alteração de endereço enfileira o job `customer.geocode` (retry com backoff). `REQUEST_DENIED`/`INVALID_REQUEST` não são repetidos (dead letter → alerta). Resultado `partial_match` ou `APPROXIMATE` vira `PARTIAL`.
- Geocoding em massa: botão "Localizar pendentes" → job `customers.geocode_pending` enfileira até 200 clientes por vez.
- Correção manual no mapa (status `MANUAL`) nunca é sobrescrita pelo geocoding automático.
- O mapa de visualização/correção usa Leaflet + tiles do OpenStreetMap (sem chave). Não há chave de navegador do Google: nada do Google roda no browser.
- **Otimização de rota (Fase 5):** Routes API `POST https://routes.googleapis.com/directions/v2:computeRoutes` com `optimizeWaypointOrder: true`, `travelMode: DRIVE`, `routingPreference: TRAFFIC_UNAWARE` (a otimização de ordem não aceita o modo com trânsito), chave no header `X-Goog-Api-Key` e `X-Goog-FieldMask: routes.distanceMeters,routes.duration,routes.optimizedIntermediateWaypointIndex`. Origem e destino = base de saída (Rotas → Base). Até 25 paradas por otimização. Habilite a **Routes API** no projeto do Google Cloud e inclua-a na restrição da chave.
- A chamada acontece fora da transação; a nova ordem só é aplicada se a rota ainda estiver planejada e com as mesmas paradas. Resposta que não seja uma permutação exata das paradas é descartada. Falha do Google não altera nada (a ordem manual continua disponível).
- **Navegação do motorista:** link `https://www.google.com/maps/dir/?api=1&destination=lat,lng` (abre o app de mapas do celular; não usa chave).
- **Fotos (Fase 6):** upload `POST /api/uploads` (multipart, campo `file`) → validação por magic bytes (JPEG/PNG/WEBP), 5 MB, rate limit, nome aleatório `org/AAAA-MM/uuid.ext` → Storage REST com a service role. Visualização por `GET /api/admin/attachments/:id` (link assinado de 5 min). Nenhuma URL pública.
- Eventos de operação no outbox: `DeliveryCompleted`, `QuantityDivergenceDetected`, `IncidentOpened`, `IncidentResolved`, `BillableEventCreated`.
- Eventos de rota no outbox: `RoutePlanned`, `RouteStarted`, `StopArrived`, `RouteCompleted`, `RouteCancelled`.

## Supabase — auto cadastro (Fase 2)

- Para `/cadastro` funcionar, habilite **Allow new users to sign up** no Supabase (Authentication → Providers → Email) e mantenha **Confirm email** ligado. Usuários criados sem vínculo não acessam nada no app.
- O template de confirmação deve apontar para `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/portal`.
- Convites de usuários e de contatos do portal exigem `SUPABASE_SERVICE_ROLE_KEY` no servidor.
