# Dashboard ADMIN — backend P1

`GET /api/admin/dashboard` agrega los registros de la cafetería asignada al ADMIN
autenticado. No implementa BFF ni frontend y no publica pedidos individuales ni
datos personales de estudiantes. No calcula ingresos cobrados ni pérdidas económicas.

## Request y tiempo

Parámetros únicos permitidos:

| Parámetro | Contrato |
|---|---|
| `range` | Obligatorio: `TODAY`, `LAST_7_DAYS`, `LAST_30_DAYS`, `CUSTOM` |
| `from`, `to` | Solo para `CUSTOM`, ambos obligatorios, fechas estrictas `YYYY-MM-DD` |
| `rankingLimit` | Entero 1–50, predeterminado 10 |

Se rechazan valores vacíos, parámetros repetidos/desconocidos, combinaciones
incompatibles, fechas inválidas/futuras, rangos invertidos y más de 366 fechas
inclusivas. No se aceptan selectores de cafetería, usuario, zona horaria o corte.
Los headers y claims comerciales no eligen cafetería.

Ejemplos:

```http
GET /api/admin/dashboard?range=TODAY
GET /api/admin/dashboard?range=LAST_7_DAYS&rankingLimit=10
GET /api/admin/dashboard?range=CUSTOM&from=2026-10-01&to=2026-10-24&rankingLimit=50
```

El servicio lee `TimeProvider.now()` una vez. `BusinessDate` determina hoy en
`America/Bogota`. Siete días significa hoy y los seis anteriores; treinta días,
hoy y los veintinueve anteriores. No se recorta al mes como el historial WORKER.

`startInclusive` es el comienzo de `from` en Bogotá. `calendarEndExclusive` es
el comienzo del día posterior a `to`. `endExclusive` es el mínimo entre ese fin
calendario y `asOf`. Todos los eventos se filtran por `[startInclusive,endExclusive)`.
`partial` indica si se aplicó ese corte. Un pedido exactamente en el corte se
recuperará en una lectura posterior. En medianoche exacta TODAY puede estar vacío.
Los cambios de mes/año y los años bisiestos usan aritmética de calendario.

No se implementan comparaciones: comparar un día parcial con otro completo exige
una política adicional de períodos equivalentes.

## Métricas y fuentes

`basis=EVENT_DATE`, `currency=COP`. Sean R las creaciones del período, D las
entregas verificables y N las no recogidas verificables.

| Campo summary | Fórmula / fuente |
|---|---|
| `receivedOrders` | Cantidad de R, con cualquier estado posterior |
| `deliveredOrders` | Cantidad de D |
| `notCollectedOrders` | Cantidad de N |
| `notCollectedUnits` | Suma de cantidades de las líneas de N, o null si incompletas |
| `receivedOrderValue` | Suma de `orders.total` en R |
| `deliveredOrderValue` | Suma de `orders.total` en D |
| `notCollectedOrderValue` | Suma de `orders.total` en N |
| `notCollectedItemValue` | Suma de `order_items.subtotal` en N, o null si incompletas |
| `notCollectedRateDenominator` | D + N |
| `notCollectedRatePercent` | 100 × N / (D + N); null cuando D + N = 0 |

R utiliza `created_at`, D `delivered_at` y N `not_collected_at`. Un pedido creado
el lunes y entregado el martes cuenta en días diferentes. Activos y cancelados
solo cuentan como recibidos; no son automáticamente no recogidos.

Las entregas/no recogidas exigen estado correspondiente, timestamps y creación
finitos, evento no anterior a creación, un único timestamp terminal compatible y
pertenencia al período. No se usa `updated_at` ni se reconstruyen fechas desconocidas.

Los importes de cabecera y de líneas permanecen independientes. Una diferencia
genera advertencia pero no corrige datos ni invalida automáticamente líneas coherentes.
Una cabecera monetaria inválida vuelve null su agregado monetario; el pedido sigue
contando. Nunca se utiliza `payments`.

`trend` contiene todas las fechas inclusivas del rango y los tres conteos diarios,
agrupados en Bogotá. El resumen deriva de los mismos agregados que las tendencias.

## Rankings

Ambos rankings agrupan por `lunch_id`. Publican `productId`, `historicalName`,
`units`, `orders` distintos e `itemValue` histórico. No recogidos añade
`unitSharePercent`: 100 × unidades del producto / todas las unidades de N,
calculado antes del Top. En entregados ese campo es null.

Orden: unidades DESC, pedidos DESC, UUID del producto ASC. El nombre corresponde
al último snapshot del universo del ranking: evento DESC, UUID de pedido DESC,
ID de línea DESC. Un último nombre vacío se conserva como desconocido (null)
con advertencia. No se sustituye por otro nombre ni por el catálogo actual.

Productos inactivos permanecen en los resultados. La unión al catálogo en el
diagnóstico verifica identidad/cafetería; no lee su nombre ni precio actual.

Cada ranking contiene:

- `availability`: `AVAILABLE` o `UNAVAILABLE_INCOMPLETE_ITEMS`.
- `limit`, `hasMore`, `items`.
- `totals`: productos distintos, pedidos distintos, unidades y valor del universo.
- `omitted`: productos, unidades y valor fuera del Top.

Los pedidos globales no se obtienen sumando pedidos por producto. Un producto
repetido en varias líneas suma unidades y valores, pero cuenta una vez por pedido.

Si hay un pedido sin líneas o líneas con cantidad/precio/subtotal/relaciones
inválidos en un universo terminal, su ranking no se publica como definitivo:
items vacío, totales/omitidos null, availability UNAVAILABLE_INCOMPLETE_ITEMS.
`hasMore=false` solo es interpretable para rankings AVAILABLE. Las métricas
independientes de cabecera continúan disponibles. Con universo válido vacío,
el ranking está AVAILABLE y sus totales son cero.

## Tipos y ejemplo coherente

Conteos y unidades son strings enteros no negativos; importes strings decimales
exactos de dos posiciones. Se utiliza BigInteger/BigDecimal sin conversión a double.
Porcentajes se calculan con HALF_UP a dos decimales y pueden ser null.
Las sumas no heredan el límite de un precio individual NUMERIC(12,2).
IDs de productos son UUID, fechas ISO e instantes UTC. El límite es entero JSON.

La respuesta contiene `period`, `basis`, `currency`, `summary`, `trend`,
`topDeliveredProducts`, `notCollectedProducts`, `coverage`.

Fragmentos coherentes de una respuesta sin eventos verificables (se omiten period,
el ranking entregado y coverage únicamente para abreviar):

```json
{
  "basis": "EVENT_DATE",
  "currency": "COP",
  "summary": {
    "receivedOrders": "0",
    "deliveredOrders": "0",
    "notCollectedOrders": "0",
    "notCollectedUnits": "0",
    "receivedOrderValue": "0.00",
    "deliveredOrderValue": "0.00",
    "notCollectedOrderValue": "0.00",
    "notCollectedItemValue": "0.00",
    "notCollectedRatePercent": null,
    "notCollectedRateDenominator": "0"
  },
  "trend": [
    {
      "date": "2026-10-24",
      "receivedOrders": "0",
      "deliveredOrders": "0",
      "notCollectedOrders": "0"
    }
  ],
  "notCollectedProducts": {
    "availability": "AVAILABLE",
    "limit": 10,
    "hasMore": false,
    "totals": {"products": "0", "orders": "0", "units": "0", "itemValue": "0.00"},
    "omitted": {"products": "0", "units": "0", "itemValue": "0.00"},
    "items": []
  }
}
```

La ausencia de eventos verificables NO certifica ausencia total de actividad.
El consumidor debe mostrar coverage y distinguir null de cero.

## Coverage

`assessment=LIMITED` siempre: procedencia no certificada y diagnóstico global no
ejecutado. `assessedAt` coincide con asOf. `provenance.status=UNKNOWN` y
`verifiedRealOrders=null`; no se excluyen registros por nombres, importes o UUID.

Cada check devuelve code, status (PASS/WARN/NOT_CHECKED), scope, examinedOrders,
affectedOrders y assessedAt. scope contiene basis, eventTypes y límites del
intervalo, o límites null para el histórico global no examinado.

| Check | Universo realmente examinado |
|---|---|
| TERMINAL_DATE_VALIDITY / CREATED_COHORT | Creados en el intervalo; detecta fechas faltantes, incompatibles y futuras conocidas de esa cohorte |
| TERMINAL_DATE_VALIDITY / RECORDED_TERMINAL_EVENTS | Pedidos distintos con fecha de entrega/no recogida en intervalo, incluidos candidatos incompatibles |
| HEADER_AMOUNT_VALIDITY | Pedidos seleccionados por cada tipo de evento |
| ITEM_INTEGRITY | Pedidos seleccionados por cada tipo de evento |
| HEADER_ITEM_RECONCILIATION | Subconjunto seleccionado con líneas utilizables y cabecera monetaria válida |
| HISTORICAL_NAME | Pedidos seleccionados con al menos una línea de nombre vacío |
| UNDATED_TERMINALS | CAFETERIA_ALL_HISTORY, NOT_CHECKED y ambos conteos null |

Los checks por tipo usan scope SELECTED_EVENT_ORDERS y eventTypes explícitos.
Los contadores entre checks se solapan y no se suman como pedidos únicos.
La conciliación no afirma haber examinado cabeceras/líneas no calculables.

Advertencias: INVALID_TERMINAL_DATES_{basis}, INVALID_HEADER_AMOUNT_{event},
INCOMPLETE_ITEMS_{event}, HEADER_ITEM_MISMATCH_{event}, MISSING_HISTORICAL_NAME_{event},
UNDATED_TERMINALS_NOT_ASSESSED, UNVERIFIED_ORDER_PROVENANCE y, sin eventos,
NO_VERIFIABLE_EVENTS. Cada advertencia incluye affects.

Un PASS con cero examinados solo significa que no se detectó una infracción en
ese conjunto vacío. No garantiza el histórico. Fechas nulas de pedidos creados
antes del intervalo podrían pertenecer a cualquier período y no se atribuyen a este.
No se ejecuta un escaneo global por solicitud ni se inventa su resultado.

## Seguridad, transacción y errores

Resource Server comparte el JwtDecoder existente. El subject debe ser UUID.
AuthorizationQueryPort exige usuario activo, rol exactamente ADMIN y una sola
asignación. El servicio verifica existencia de cafetería y permite lectura si
está inactiva. Ningún selector del navegador entra al puerto de persistencia.

Autorización y lecturas comparten transacción readOnly, REPEATABLE_READ y timeout
15 segundos, siguiendo ADMIN Catálogo. No hay FOR UPDATE ni bloqueo de cola.
Una revocación concurrente se observa según el snapshot de la solicitud; no se
promete revocar una respuesta ya iniciada.

AdminDashboardSecurityConfig delimita una cadena Resource Server para esta ruta:
añade no-store y errores públicos también antes del controller. Las demás rutas
conservan su cadena existente. El advice del dashboard está limitado a su controller.

| Estado | Significado |
|---|---|
| 200 | Consulta válida, vacía o limitada con coverage |
| 400 | ADMIN_DASHBOARD_INVALID_REQUEST |
| 401 | UNAUTHORIZED, JWT ausente/inválido |
| 403 | ADMIN_DASHBOARD_FORBIDDEN |
| 500 | ADMIN_DASHBOARD_INTERNAL_ERROR |
| 503 | ADMIN_DASHBOARD_TEMPORARILY_UNAVAILABLE; Retry-After: 5 |

Todas las respuestas de la ruta usan Cache-Control: no-store. No se incluyen
mensajes de excepciones, SQL, tokens, clientes, documentos, notas ni pedidos en JSON.

## SQL y rendimiento

Recursos en `src/main/resources/sql/admin-dashboard/`: events.sql (CTE común),
daily.sql, item-quality.sql, date-quality.sql y ranking.sql. La concatenación
usa únicamente recursos estáticos internos; todos los valores son parámetros JDBC.
Los candidatos se acotan por cafetería/intervalo antes de agregar. Ranking solo
se ejecuta cuando el diagnóstico de líneas de su universo es válido.

Máximo siete SELECT por petición: autorización, existencia, diario, integridad
de líneas, fechas y dos rankings. Con rankings no disponibles se ejecutan menos.
No hay N+1 ni carga completa de entidades JPA; tendencias devuelven máximo 366 días
y cada ranking máximo 50 productos. Top limita la respuesta, no el trabajo de agregar.

No se crean índices ni migraciones. Existen índices por cafetería/estado/creación,
no recogida, entregados y order_items(order_id). Los candidatos de diagnóstico
incluyen estados incompatibles, por lo que no se afirma que siempre utilicen los
índices parciales terminales. El posible índice (cafeteria_id,created_at), planes
y costo a escala productiva quedan pendientes de medición representativa.

## Pruebas y límites de validación

Las pruebas nuevas son AdminDashboardRequestTest, AdminDashboardServiceTest y
AdminDashboardApiPostgresTest. Este último crea un cluster PostgreSQL temporal,
loopback, puerto aleatorio, instala migraciones 001–017 y lo detiene al terminar.
Nunca lee SUPABASE_DB_URL ni conecta a una base externa. Los fixtures corruptos
alteran restricciones únicamente en ese cluster propio y las restauran.

Ejecución con Java 21 desde unifood-backend:

```text
mvnw.cmd -Dtest=AdminDashboard*Test test
```

Cobertura: filtros, roles/asignaciones, Bogotá/calendario, BigDecimal y números
grandes, datos de dos cafeterías, snapshots/desempates, líneas repetidas o corruptas,
fechas nulas/incompatibles, discrepancias, Top/denominadores, errores HTTP,
no-store, readOnly/REPEATABLE_READ y número constante de consultas.

Resultados ejecutados en esta entrega, con Java 21 y PostgreSQL 18.3 local aislado:

| Verificación | Resultado |
|---|---|
| AdminDashboardRequestTest | 30 pruebas aprobadas |
| AdminDashboardServiceTest | 13 pruebas aprobadas |
| AdminDashboardApiPostgresTest | 27 pruebas aprobadas, SQL/JDBC y HTTP reales |
| Suite backend completa (`mvnw.cmd -q test`) | 608 pruebas en 43 clases; 0 fallos, 0 errores, 0 omitidas |
| Spotless sobre los Java nuevos del dashboard | Aprobado |
| Whitespace de archivos nuevos y `git diff --check` | Sin incidencias |

La primera ejecución de PostgreSQL requirió salir del sandbox por bloqueo de
procesos hijos (EPERM). La ejecución autorizada posterior utilizó exclusivamente
clusters temporales propios. No se ha auditado Supabase remoto ni certificado
procedencia comercial o pagos. No se ejecutó carga productiva ni E2E frontend:
el checkout CLIENT productivo y el BFF/frontend permanecen fuera de este módulo.
