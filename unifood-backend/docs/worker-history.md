# Historial WORKER del mes actual

`GET /api/worker/orders/history` consulta terminales del mes calendario actual de
la cafetería autorizada. Backend, BFF y UI dentro de `/worker` usan el recorrido
Browser → Next/BFF → Spring → PostgreSQL. No hay acceso frontend directo a tablas
business de Supabase. El endpoint diario anterior se sustituye al desplegar ambos
servicios; la UI ya no descarga el dataset mensual para buscar en memoria.

## Identidad y fecha

Spring toma la identidad del subject del JWT verificado y consulta hechos actuales:
usuario activo, rol exclusivamente WORKER y exactamente una cafetería asignada.
No usa claims de rol/cafetería ni IDs suministrados por navegador como autoridad.
Los parámetros desconocidos o duplicados reciben 400, incluidos cafeteriaId,
userId, fechas libres y selectores de otros meses. Otros roles reciben 403.

El caso de uso captura `TimeProvider.now()` una sola vez y usa `BusinessDate` en
`America/Bogota`. La ventana autorizada es inicio del mes incluido hasta inicio
del siguiente día excluido. La zona del host, de PostgreSQL o del navegador no
escoge la fecha. Al cambiar el mes, el mes anterior deja de ser consultable por
WORKER; los datos permanecen almacenados. Nunca se inventan timestamps legacy.

## Pedidos → Entregados

El listado operacional conserva su array JSON y los cuatro estados activos, sin
recortar pendientes por su fecha de creación. Solo incluye
DELIVERED si `dayStart <= delivered_at < nextDayStart`. No usa created_at ni
updated_at para esta selección. La columna Entregados ordena por deliveredAt y
mantiene su límite visual existente. La consulta de items sigue siendo por lote.
NOT_COLLECTED y CANCELLED se consultan exclusivamente mediante Historial: el
listado operacional tampoco expone esos terminales antiguos en su JSON, aunque
las columnas operativas ya los ocultaban. No cambian sus transiciones.

Spring publica `X-Business-Date` y `X-Next-Business-Date-At`, calculados desde la
misma lectura del reloj que delimita la consulta. El BFF conserva esos headers.
El hook usa el deadline para retirar entregados vencidos antes de consultar,
sin borrar otros estados. Mantiene polling y foco; no cambia transiciones, FIFO,
recordatorios, cancelaciones ni versiones. No requiere cerrar sesión al cambiar día.

## Selección y snapshots

| Estado | Timestamp terminal |
|---|---|
| DELIVERED | delivered_at |
| NOT_COLLECTED | not_collected_at |
| CANCELLED | cancelled_at |

Solo el timestamp de su estado define la pertenencia temporal. PENDING, PREPARING,
READY y CALLED quedan fuera. Los terminales sin fecha verificable siguen guardados
y excluidos; created_at y updated_at no sirven como fallback.

`orders.client_name` y los detalles de `order_items` son snapshots históricos.
No se consulta el perfil actual ni el catálogo para reconstruirlos. Nombre vacío
o null se presenta como «Cliente no disponible». Los pedidos sin items siguen
siendo representables. No se publican documento, email, teléfono, usuario, claims,
metadata Auth ni IDs de cafetería/productos. La referencia corta puede colisionar:
es una etiqueta visual, no identidad ni autorización.

## Criterios, búsqueda y paginación

Parámetros opcionales, únicos y validados:

| Parámetro | Contrato |
|---|---|
| q | Hasta 120 caracteres, espacios normalizados, substring literal |
| range | MONTH (default), WEEK (lunes, acotado al mes), TODAY |
| status | DELIVERED, NOT_COLLECTED o CANCELLED |
| limit | Entero 1–100, default 30 |
| cursor | Posición opaca, máximo 512 caracteres |

No hay calendario para meses anteriores/futuros ni rangos libres. Búsqueda y
filtros se combinan en Spring/SQL. Se busca por referencia, nombre snapshot,
estado técnico/etiqueta española y producto histórico. Los alias españoles se
resuelven en aplicación; SQL no contiene traducciones de estados. Se normalizan
mayúsculas, espacios y acentos mediante NFD y funciones nativas PostgreSQL UTF-8,
sin extensiones ni una segunda autoridad de búsqueda en el navegador. % y _
son texto literal, no comodines SQL.

El orden es completed_at DESC, id DESC. El cursor contiene posición y una huella
del mes/cafetería/criterios/tamaño, nunca autoridad. SQL aplica siempre cafetería
y ventana aunque un cliente altere el cursor. Cursor malformado, de otro alcance,
mes o filtro recibe 400. El cursor no representa una fotografía transaccional
congelada: nuevas entradas anteriores a la posición pueden aparecer en páginas
siguientes; nuevas entradas por encima se recuperan al refrescar.

Cada rama UNION ALL se limita antes de combinar; la página se selecciona antes
de unir los items. Se consulta limit+1 para decidir nextCursor, sin COUNT ni
agregados. EXISTS por producto evita duplicar órdenes. Una sola SELECT devuelve
metadatos y página incluso si no hay coincidencias: no hay N+1. hasHistory es solo
un booleano del mes autorizado para distinguir vacío real de filtros sin resultados.

La respuesta contiene businessDate, nextBusinessDateAt, monthStart, rangeStart,
rangeEnd (exclusivo), orders, nextCursor y hasHistory. Cada pedido conserva id,
reference, clientName, status, completedAt, total e items con name, quantity,
unitPrice y subtotal. El UUID sirve como clave interna de tarjeta, no texto visible.

## UI y rollover

El campo controlado aplica debounce de 300 ms, con label, icono, limpiar y foco
visible. Hay filtros Hoy/Semana/Mes y estado, y acción explícita «Cargar más».
Cambiar criterios reinicia cursor y oculta resultados de los criterios anteriores.
AbortController y generaciones impiden que respuestas viejas sustituyan nuevas.

Se consulta al entrar, al volver foco/visibilidad y cada 30 segundos visible.
El refresh conserva filtros y vuelve a la primera página. Al alcanzar el deadline
del servidor se eliminan las tarjetas anteriores antes del refetch, también si
falla la nueva lectura. Una respuesta con deadline vencido no repuebla la pantalla.
Los cursores que vencen durante «Cargar más» reinician la consulta sin cursor.
El reloj del browser agenda consultas, no selecciona fechas de negocio.

Historial conserva detalle individual para trazabilidad. No ofrece contadores,
KPIs, ventas, gráficos ni métricas WORKER. El total dentro de una tarjeta es el
importe de ese pedido. ADMIN permanece fuera de alcance.

## Errores, permisos y despliegue

Todas las lecturas y respuestas de errores del módulo usan no-store.
401 conserva la semántica de autenticación; 403 deniega el historial.
400 usa WORKER_HISTORY_INVALID_REQUEST; los fallos temporales usan 503,
WORKER_HISTORY_TEMPORARILY_UNAVAILABLE y Retry-After: 5. Un fallo inesperado usa
500 y WORKER_HISTORY_INTERNAL_ERROR. No se publican SQL, stacks ni detalles privados.
El advice solo cubre este controller; un error de proyección no se confunde con
criterios inválidos. Un 503 conserva la sesión y permite recuperar sin borrar cookies.

015 añade únicamente índices parciales para DELIVERED y CANCELLED por cafetería,
timestamp terminal DESC e id DESC. Se conserva el índice existente de
NOT_COLLECTED. La necesidad se verificó con EXPLAIN ANALYZE sobre históricos
sintéticos; no se añaden extensiones, índices de texto, grants ni cambios de datos.
Aplicar los índices con una ventana dimensionada: CREATE INDEX transaccional toma
locks y no es CONCURRENTLY. El backend/BFF deben desplegar el nuevo contrato juntos.
No se modifican migraciones anteriores.

No hay borrado, cron, limpieza mensual, truncado, backfill ni data migration.
La ventana mensual es exclusivamente autorización/consulta/presentación WORKER.
