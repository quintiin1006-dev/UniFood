# Disponibilidad diaria del backend

Spring determina el día mediante el `TimeProvider` existente: Instant convertido
con `America/Bogota`. La zona del host, PostgreSQL y navegador no decide el día.
El catálogo sigue en `lunches`; stock y `Lunch.isAvailable()` no intervienen.

## Instalación y permisos

Aplicar 001–012, clasificar explícitamente todos los productos (incluso inactivos)
y aplicar `013_daily_availability.sql`. Su pre-audit bloquea escrituras de catálogo,
aborta ante cualquier categoría NULL y revierte toda la migración. No hace backfill.
Después, la categoría es obligatoria sin DEFAULT; cada inserción interna debe elegirla.
Los snapshots, IDs y relaciones de pedidos anteriores permanecen intactos.

`cafeteria_daily_states` tiene PK `(cafeteria_id,business_date)`.
`daily_item_availability` tiene PK `(item_id,business_date)` y FK compuesta
`(item_id,cafeteria_id)` a `lunches(id,cafeteria_id)`. Ambas conservan fechas históricas,
booleanos y timestamps obligatorios. Las FK RESTRICT evitan eliminar sus referencias
históricas. No hay CHECK con CURRENT_DATE, cron, precarga masiva ni borrado diario.

RLS está habilitado sin policies; se revocan permisos de tabla y columna a PUBLIC,
anon y authenticated. No se crean funciones ni secuencias. Ejecutar la auditoría
de solo lectura antes y después del despliegue. Sus listados de permisos inesperados
incluyen ambas tablas. Las RPC de identidad y Supabase Auth siguen intactos.
La conexión Spring viene de `SUPABASE_DB_URL`: comprobar el rol real y sus permisos
de lectura, escritura y locks antes de desplegar. Las pruebas locales usan postgres,
propietario del clúster temporal; no demuestran los permisos del servidor remoto.

## API WORKER

Todos los endpoints resuelven el JWT subject verificado contra las reglas existentes:
usuario activo, rol exclusivo WORKER y exactamente una asignación. Los claims de
negocio y cualquier cafeteriaId enviado por el navegador no son autoridad.

| Método | Ruta | Entrada | Respuesta 200 |
| --- | --- | --- | --- |
| GET | `/api/worker/availability/today` | Ninguna | businessDate, cafeteria, categories |
| PUT | `/api/worker/availability/today/items/{itemId}` | `{ "available": true/false }` | businessDate, itemId, available |
| PUT | `/api/worker/availability/today/cafeteria-state` | `{ "open": true/false }` | businessDate, open |

Cada PUT exige `X-Business-Date: YYYY-MM-DD`, tomado del GET anterior. Es una
precondición de pantalla: Spring calcula de nuevo el día de escritura y rechaza
cualquier diferencia con 409. No permite elegir fechas futuras o históricas.
Las respuestas del módulo, incluidos sus errores, llevan `Cache-Control: no-store`.

GET incluye todas las categorías en orden DEL_DIA, CORRIENTE, EJECUTIVO, ESPECIAL,
DESAYUNO, con grupos vacíos permitidos. Dentro de cada grupo ordena nombre con
collation C y UUID como desempate. Una sola consulta obtiene el estado y solo
productos activos de la cafetería autorizada. Categoría inválida falla de forma
segura; nunca se infiere ni se descarta silenciosamente un producto.

Ausencia de fila diaria significa false y consultar no crea filas. Abrir y habilitar
son flags independientes: habilitar un producto con la cafetería cerrada permite
preparar la oferta antes de abrir. Cerrar no reescribe los flags de productos.
GET devuelve el flag persistido, incluso si la cafetería está administrativamente
inactiva; `active` permite mostrar esa condición. Una futura creación de pedido
deberá comprobar día, cafetería activa/abierta y producto activo/disponible juntos.
Esta fase no implementa dicha creación ni utiliza stock como disponibilidad.

Con una cafetería administrativamente inactiva se permite consultar, cerrar y
deshabilitar productos propios. Abrir o habilitar devuelve 409. Un producto inactivo
no aparece en GET; habilitarlo devuelve 409 y deshabilitarlo es seguro. Un item ajeno
y uno inexistente reciben el mismo 404, sin confirmar su existencia.

## Escrituras concurrentes

Los PUT ejecutan UPSERT con valores absolutos dentro de una transacción. La última
escritura confirmada prevalece para una misma clave; repetir true o false conserva
el estado y no crea duplicados. `created_at` se conserva; `updated_at` registra la
escritura, por lo que reintentar puede actualizar ese metadato.

Un lock FOR SHARE sobre cafetería y, para productos, sobre lunch protege la comprobación
de actividad contra cambios administrativos concurrentes. Dos WORKER pueden adquirir
esos locks a la vez. La PK y el UPSERT serializan únicamente la misma clave diaria.
Estos locks pueden esperar a cambios administrativos y hacer esperar a operaciones
de órdenes que bloqueen la cafetería; las transacciones son cortas y tienen timeout
de 15 segundos. No se cambian FIFO ni sus queries.

Se vuelve a comprobar el día después de los locks y del UPSERT. Si una espera cruza
medianoche, la excepción 409 revierte el UPSERT completo. El último chequeo del reloj
es el punto de aceptación antes del COMMIT; no se promete arbitrar la hora exacta en
que PostgreSQL termina de confirmar después de ese chequeo.

## Errores

| Estado | Código / condición |
| --- | --- |
| 401 | Autenticación ausente o inválida, mediante el resource server existente |
| 403 | AVAILABILITY_FORBIDDEN: no cumple la política WORKER |
| 400 | AVAILABILITY_INVALID_REQUEST: body, UUID o contexto ausente/inválido |
| 404 | AVAILABILITY_ITEM_NOT_FOUND / AVAILABILITY_CAFETERIA_NOT_FOUND |
| 409 | AVAILABILITY_DAY_EXPIRED: actualizar pantalla |
| 409 | AVAILABILITY_CAFETERIA_INACTIVE / AVAILABILITY_ITEM_INACTIVE |
| 503 | AVAILABILITY_TEMPORARILY_UNAVAILABLE, Retry-After: 5 |
| 500 | AVAILABILITY_CATALOG_INVALID / AVAILABILITY_INTERNAL_ERROR |

Los mensajes son fijos, sin SQL ni detalles internos. El advice se limita al
controller de disponibilidad y no sustituye los contratos de órdenes o perfil.
Un 503 permite reintentar; estos endpoints no gestionan ni eliminan cookies de sesión.
La autorización compartida conserva su nombre histórico `OrderAuthorization`;
renombrarla es deuda separada y no cambia las reglas de esta fase.

## Pruebas locales

Las pruebas de API usan un clúster PostgreSQL nativo aislado con 001–012, datos
históricos sintéticos y 013. Comprueban el aborto sin reparación ante categorías
pendientes, constraints, grants efectivos y detección de permisos inesperados.
La persistencia JDBC participa en `JpaTransactionManager` con Hibernate, como en
el backend, para demostrar que las excepciones posteriores al UPSERT revierten
la escritura. Las carreras coordinan commits y observan una espera de lock en
`pg_stat_activity`; no dependen solo de ejecutar hilos o dormir un tiempo fijo.
Incluyen ambos estados iguales, estados opuestos con ambos ganadores, medianoche
durante la espera y desactivación administrativa concurrente.
