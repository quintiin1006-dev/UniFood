# Historial WORKER del mes actual

La UI en `/worker` usa `GET /api/worker/orders/history` a través de Next/BFF.
Spring verifica identidad, rol WORKER exclusivo, cafetería y mes en America/Bogota.
No se consulta Supabase REST ni se envían IDs de cafetería como autoridad.

El DTO incluye businessDate, nextBusinessDateAt, monthStart, rangeStart, rangeEnd,
orders, nextCursor y hasHistory. El parser selecciona solo campos publicados,
valida terminales, ventana, orden, UUIDs únicos, snapshots e importes. No añade PII.
clientName viene de orders.client_name; null/vacío muestra «Cliente no disponible».
Cada tarjeta muestra fecha y hora de Bogotá y productos históricos, sin catálogo actual.

La búsqueda es server-side por referencia, cliente, estado y productos. No hay
filtrado local del dataset ni un segundo motor de normalización/búsqueda.
El campo controlado limita 120 caracteres y aplica debounce de 300 ms.
Filtros MONTH/WEEK/TODAY y estado se combinan con q. Las fechas libres y meses
anteriores/futuros no están disponibles. La página tiene límite server-side
(default 30, máximo 100) y cursor opaco, con acción «Cargar más».

WorkerHistoryStore invalida/aborta respuestas al cambiar criterios o desmontar.
Cambiar criterios oculta tarjetas anteriores y reinicia paginación. Al entrar,
recuperar foco/visibilidad y cada 30 segundos visible se refresca la primera página
con los filtros conservados. Al deadline del backend retira datos antes del refetch;
un fallo no permite volver a mostrar el mes vencido. Un 400 durante carga de otra
página reinicia sin cursor; no se inventan fechas a partir del reloj local.

Loading, vacío real del mes y filtros sin resultados tienen estados diferenciados.
hasHistory solo distingue los dos vacíos: no se muestran cantidades, KPIs, ventas,
gráficos ni métricas WORKER. El total de una tarjeta pertenece a ese pedido.

Browser y BFF usan no-store, timeout y redirects bloqueados. El BFF solo reenvía
criterios permitidos y el Bearer verificado. Un 503 conserva cookies y recuperación;
401/403 ocultan datos y detienen consultas automáticas sin loops ni logout propio.

Pedidos → Entregados recibe solo delivered_at del business day actual. Su BFF
conserva los headers X-Business-Date y X-Next-Business-Date-At; el hook retira
entregados vencidos y solicita un listado nuevo sin afectar los otros estados.

Pruebas: worker-history-*.test.mjs, pruebas de pedidos, SQL/Hibernate nativo y E2E
worker-history.spec.ts / worker-orders-business-day.spec.ts. Los fixtures HTTP son
solo dobles loopback: las reglas SQL se verifican en PostgreSQL real.
Las capturas opcionales WORKER_HISTORY_VISUAL_AUDIT=1 se guardan en TEMP.
Ver [contrato backend](../../../unifood-backend/docs/worker-history.md).
