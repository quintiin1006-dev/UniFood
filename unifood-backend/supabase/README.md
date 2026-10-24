# Correcciones de integridad y despliegue

Esta guía describe las migraciones incrementales 008–011. Ejecutar primero
`audit_business_integrity.sql` con una conexión administrativa de lectura. Requiere
un esquema instalado hasta 007 y también puede repetirse después de 011. Los tres
listados de incompatibilidades deben estar vacíos antes de instalar 009/011. Los
listados de permisos/policies documentan la exposición efectiva del entorno de destino.
Después de 010, los listados de grants inesperados de tabla/columna deben estar vacíos,
las RPC deben existir y coincidir con sus permisos esperados y los helpers deben tener
`unexpected_helper_execute=false`. Revisar también superusuario/BYPASSRLS para los roles
de navegador. El script usa una transacción READ ONLY y no modifica ni repara datos.

## Orden de despliegue

1. Auditar datos y grants; resolver incompatibilidades mediante decisiones administrativas
   explícitas. No desactivar cuentas, eliminar asignaciones ni corregir importes automáticamente.
2. Detener las escrituras del backend anterior durante el despliegue: no mezclar versiones
   JPA antiguas y nuevas. Aplicar 008–011 en orden y desplegar el backend nuevo.
3. Verificar que la conexión Spring usa su rol de servidor con los permisos requeridos;
   nunca `anon`/`authenticated` ni una credencial expuesta al navegador.
4. Comprobar las dos RPC de identidad y los permisos efectivos con el preflight.

`setup_auth.sql` sigue consolidando exclusivamente 005–007. No sustituye 008–011;
se retiró su concesión de UPDATE de perfil para que repetirlo no reabra permisos por columna.
Las migraciones históricas 001–007 no se modifican.

## Cardinalidad

009 considera `cafeterias.is_active` como actividad administrativa de la cafetería.
No usa `service_available`, stock ni estado diario. Crear una cafetería con
`is_active=false`; asignar su ADMIN inactivo, completar el perfil y activar ADMIN/cafetería
en una transacción válida. Una cafetería activa exige un ADMIN asignado y activo.
Nunca puede haber dos ADMIN asignados, aunque estén inactivos. Puede haber muchos WORKER.

Un usuario tiene como máximo una asignación. WORKER/ADMIN activos requieren exactamente
una; inactivos pueden tener cero mientras se aprovisionan. CLIENT/SUPER_ADMIN requieren cero.
Cambios de rol, asignación, actividad y eliminación se validan juntos al commit.
Revocar al único ADMIN exige reemplazarlo válidamente en la misma transacción o desactivar
administrativamente la cafetería. Esto no define apertura/cierre diario.

La tabla guard serializa las escrituras de aprovisionamiento antes de los locks por
usuario de 007. Su escritura evita write skew también en REPEATABLE READ/SERIALIZABLE;
un conflicto en esos niveles puede requerir reintentar la transacción administrativa
completa (40001). Se prioriza simplicidad verificable sobre paralelismo de aprovisionamiento.
El coste es un punto compartido y validaciones globales: revisar si crece mucho el volumen.
TRUNCATE está bloqueado; usar DELETE respetando los invariantes.
Esta coordinación también afecta altas de estudiantes y otras escrituras en las tablas
de perfiles; la independencia entre usuarios de 007 aislada no implica paralelismo con 009.

## Acceso directo

010 revoca permisos de tabla y columna y retira policies de las tablas de negocio
propiedad de UniFood. RLS permanece habilitado y sin policies de acceso directo.
Supabase Auth conserva su schema y sus triggers; las únicas RPC públicas de UniFood
son `is_institutional_email` (anon/authenticated) y `current_auth_profile` (authenticated).
No se cambian extensiones ni tablas ajenas. No se conceden privilegios nuevos al rol Spring.

Las policies anteriores permitían lectura propia sin exigir actividad y 005 concedía
UPDATE(full_name,phone). La prueba reproduce grants amplios del proveedor antes de aplicar
010 y verifica que desaparecen, incluido el permiso por columna, para CLIENT, WORKER e
inactivos. No se presupone que esos grants estén instalados en la base remota.
Los defaults modificados corresponden al propietario que aplica la migración; otros
propietarios/roles heredados requieren revisar los permisos efectivos antes de desplegar.

## Items y creación futura

011 valida primero las relaciones e importes existentes. Añade la clave estructural
`cafeteria_id` a items, FK compuestas a order/lunch, e igualdad exacta del subtotal.
La única actualización de datos es el backfill de esa clave desde la orden, después
del audit; no repara relaciones ni snapshots. Las FK también protegen movimientos
concurrentes de órdenes/lunches. Un trigger deriva la clave si un escritor interno la
omite; una clave suministrada incorrectamente se rechaza.

El precio de catálogo posterior no modifica nombre/precio/subtotal históricos. El futuro
caso de creación debe leer el catálogo autorizado, calcular importes en el backend y
guardar snapshots en una transacción; nunca aceptar unit_price/subtotal del navegador.
La DB comprueba consistencia aritmética y pertenencia; no compara snapshots históricos
con el precio actual. No existe un nuevo endpoint de creación ni checkout.

## Clasificación del catálogo (012)

`012_catalog_categories.sql` añade `lunches.category` como enum PostgreSQL
`public.catalog_category`, con exactamente estos valores:

- `DEL_DIA`: producto o plato de la oferta definida como «del día».
- `CORRIENTE`: almuerzo corriente.
- `EJECUTIVO`: almuerzo ejecutivo.
- `ESPECIAL`: producto o plato especial.
- `DESAYUNO`: producto de desayuno.

La columna permite NULL y no tiene DEFAULT ni backfill. Un NULL significa
**pendiente de clasificación administrativa**, no una categoría funcional.
Los productos existentes y las nuevas inserciones que omitan categoría permanecen
sin clasificar; no se infiere por nombre, precio, stock ni horario. La clasificación
requiere una decisión humana explícita por producto.

Aplicar 012 después de 011 y antes de desplegar el backend que mapea la nueva columna:
Hibernate valida el esquema y requiere que `category` exista. El modelo Java conserva
la compatibilidad temporal con NULL, incluido el constructor anterior de `Lunch`.
El nombre físico sigue siendo `public.lunches`; `CatalogItem` queda como terminología
de dominio para una fase posterior. No existe una segunda tabla de catálogo.

La migración no modifica stock, actividad administrativa, `service_available`, IDs,
FK ni snapshots históricos de `order_items`. Sigue el patrón de enums del esquema
y revoca explícitamente `USAGE` de `public.catalog_category` para `PUBLIC`, `anon` y
`authenticated`, dentro de la misma transacción. No añade grants de tabla o columna.

La auditoría conserva sus comprobaciones de columnas y añade `unexpected_type_usage`
para los tres actores: todos deben devolver `false` después de 012. Para `PUBLIC`
inspecciona la ACL del tipo (incluidos los defaults); para `anon`/`authenticated` usa
`has_type_privilege`, que incluye permisos heredados. Antes de 012 ese listado está
vacío porque el tipo no existe. La auditoría sigue siendo de solo lectura.

Las pruebas nativas conectan como `postgres`, propietario del tipo y superusuario
del clúster temporal: conserva `USAGE` sin GRANT adicional y Hibernate prueba los
cinco valores y NULL después de la revocación. El rol productivo no está fijado en el
repositorio: procede de `SUPABASE_DB_URL`. Verificar su identidad y permisos efectivos
antes de desplegar; no inferir que sea `postgres` ni conceder permisos a roles de
navegador para resolver una configuración del servidor. El permiso USAGE del tipo
controla la creación de objetos dependientes, no concede acceso a los productos.

La secuencia es **012 → clasificación humana explícita → 013**. La migración
`013_daily_availability.sql` aborta si queda cualquier producto sin categoría y
solo entonces hace la columna obligatoria. No clasifica ni repara productos.
Introduce estado diario de cafetería y disponibilidad diaria por producto, con
permisos de navegador cerrados. Aplicarla antes de desplegar los endpoints Spring.
El contrato y la coordinación de escrituras se describen en
[Disponibilidad diaria](../docs/availability.md). El módulo dispone de BFF y UI WORKER;
la disponibilidad diaria no participa en la creación ni el procesamiento de pedidos.
`Lunch.isAvailable()` conserva la regla histórica `active && stock > 0`; no se usa
como fuente de disponibilidad diaria.

Después de aplicar 012, esta consulta de solo lectura permite revisar los pendientes:

```sql
SELECT l.id,
       l.name AS nombre,
       l.description AS descripcion,
       l.price AS precio,
       c.id AS cafeteria_id,
       c.name AS cafeteria,
       s.name AS sede,
       i.name AS institucion,
       l.category AS categoria_actual,
       l.is_active AS activo_administrativamente
FROM public.lunches l
JOIN public.cafeterias c ON c.id = l.cafeteria_id
JOIN public.sites s ON s.id = c.site_id
JOIN public.institutions i ON i.id = s.institution_id
WHERE l.category IS NULL
ORDER BY i.name, s.name, c.name, l.name, l.id;
```

Ejecutarla con una conexión administrativa autorizada; no clasifica ni modifica datos.

## Fecha de cancelación (014)

`014_order_cancellation_timestamp.sql` añade `orders.cancelled_at` como TIMESTAMPTZ
nullable, sin DEFAULT, backfill ni índices adicionales. No actualiza las órdenes
existentes ni modifica las migraciones 001–013.

Spring es la fuente temporal: las cancelaciones CLIENT y WORKER comparten
`Order.cancelPending` y guardan el instante recibido de `TimeProvider` junto al
estado, actor y versión, mediante el mismo `saveAndFlush` transaccional. El reloj
se consulta después de obtener el lock de la orden. La fecha representa la
operación aceptada por el dominio, igual que `delivered_at` y `not_collected_at`;
no pretende representar el instante exacto de COMMIT. Los plazos, el arbitraje
contra PREPARING, FIFO, locks y versionado conservan sus reglas anteriores.

La DB valida el dato, sin producir otra fecha: nuevas inserciones CANCELLED y
nuevas transiciones a CANCELLED requieren un timestamp explícito; una fecha
registrada no puede cambiar ni eliminarse y solo puede acompañar a CANCELLED.
El guard es SECURITY INVOKER con search_path vacío, no realiza escrituras
adicionales y no modifica `version`. Sus permisos EXECUTE y los privilegios de
la nueva columna se revocan a PUBLIC, anon y authenticated. Los escritores
internos autorizados deben proporcionar una fecha verificable, no omitirla.

Los terminales heredados sin su timestamp correspondiente conservan fecha
**desconocida**: `delivered_at`, `not_collected_at` o `cancelled_at` NULL. No se
infieren desde `created_at`, `updated_at` ni `cancellation_deadline`. Una cancelada
heredada con NULL puede recibir cambios permitidos en otros campos sin inventar
una fecha; tampoco puede adquirirla mediante una actualización ordinaria.
Esos registros se conservan y quedan fuera de la consulta de terminales del mes.
El [endpoint Spring de Historial WORKER](../docs/worker-history.md),
`GET /api/worker/orders/history`, es de solo lectura y limita WORKER al mes actual
en America/Bogota, con búsqueda server-side y paginación por cursor. El BFF Next y la UI
WORKER de Historial dentro de `/worker` están implementados: Browser → Next/BFF
→ Spring → PostgreSQL, sin acceso directo del frontend a tablas de negocio Supabase.

### Aplicación manual y coordinada

1. Auditar el esquema y los datos con una conexión administrativa autorizada.
   Confirmar que 001–013 están instaladas, `cancelled_at` aún no existe y el
   backend nuevo ha pasado sus pruebas. No asignar fechas al legado.
2. Pausar las escrituras de órdenes, drenar las transacciones y retirar todas las
   instancias antiguas. El backend antiguo no suministra `cancelled_at` y sus
   cancelaciones serían rechazadas por el nuevo guard.
3. Ejecutar manualmente el contenido completo de
   `014_order_cancellation_timestamp.sql` una sola vez en Supabase SQL Editor,
   con el propietario administrativo autorizado. La migración es transaccional;
   no arrancar el backend nuevo antes de crear la columna que Hibernate valida.
4. Repetir `audit_business_integrity.sql`. El bloque de cancelación debe mostrar
   columna nullable sin default, CHECK validado, función sin SECURITY DEFINER y
   search_path vacío, trigger de fila BEFORE INSERT/UPDATE habilitado (tipo 23)
   asociado al guard y todos los privilegios inesperados en false. Antes de 014
   esos bloques están vacíos; la auditoría también funciona sin la columna.
5. Desplegar la versión nueva y verificar, con datos de prueba autorizados, las
   dos cancelaciones y el conflicto con PREPARING. Confirmar fecha del backend,
   misma escritura y permisos cerrados antes de reabrir las operaciones.

La migración toma locks DDL; dimensionar la ventana con los datos auditados.
La medición de Historial mensual motivó los índices específicos de 015. Si falla
el despliegue, mantener las escrituras pausadas y resolver la incompatibilidad;
no desactivar el guard ni fabricar fechas para hacer funcionar una versión antigua.

## Índices de Historial WORKER (015)

`015_worker_history_indexes.sql` crea solo dos índices parciales, uno para
DELIVERED por `(cafeteria_id, delivered_at DESC, id DESC)` y otro para CANCELLED
por `(cafeteria_id, cancelled_at DESC, id DESC)`. Excluyen timestamps desconocidos.
Se conserva el índice existente de NOT_COLLECTED. EXPLAIN ANALYZE confirmó que
sin ellos las páginas pequeñas recorrían pedidos anteriores a la ventana permitida.
No se añaden extensiones, tablas, columnas, grants ni cambios de históricos.

Aplicar después de 014, una sola vez, con una ventana dimensionada para los locks
de CREATE INDEX normal. No se usa CONCURRENTLY dentro de la migración transaccional.
El backend, BFF y UI publican el contrato mensual coordinadamente. Pedidos →
Entregados sigue limitado al día de negocio mediante delivered_at; Historial usa
timestamps terminales del mes actual. No hay métricas WORKER, endpoints ADMIN,
borrado físico, cron ni reinicio mensual de datos.

## Revisión del catálogo ADMIN (016)

`016_catalog_revision.sql` añade `lunches.version bigint NOT NULL DEFAULT 0`
y un trigger SECURITY INVOKER con search_path vacío. Las filas existentes reciben
0; los INSERT no eligen su revisión y cada UPDATE incrementa OLD.version+1.
Las escrituras de ADMIN comparan expectedVersion en SQL antes de aplicar cambios.
El trigger no reemplaza esa condición ni permite que un caller fuerce una revisión.
No cambia los índices, FK, snapshots, categorías, stock ni grants de tablas.
EXECUTE del trigger permanece revocado para PUBLIC, anon y authenticated.

Aplicar una vez después de 015, con propietario autorizado, antes de desplegar
el backend que consulta la nueva columna. Dimensionar la ventana para el lock DDL
de ALTER TABLE. Las migraciones previas no se modifican. Las pruebas locales
comprueban por separado actualización de datos anteriores, revisión, rollback,
restricciones y permisos. No ejecutan migraciones contra Supabase remoto.
El [contrato de catálogo ADMIN](../docs/admin-catalog.md) describe las escrituras
y el reinicio transaccional de disponibilidad del día al reactivar un producto.

## Imágenes privadas del catálogo (017)

`017_catalog_images.sql` añade assets y operaciones durables, propiedad compuesta
producto/cafetería y el puntero nullable `lunches.image_asset_id`. Conserva los datos
de `image_url`; no cambia snapshots, stock, categorías ni migraciones anteriores.
RLS y revocaciones explícitas de tabla/columna mantienen cerrado el acceso browser.
La asociación usa expectedVersion y el trigger existente de 016. La limpieza física
se realiza mediante Storage API después de desasociar, nunca borrando metadatos de
Storage por SQL. Aplicar una sola vez después de 016 antes del backend nuevo.

La migración no crea buckets ni cambia Supabase remoto. El [contrato de imágenes
ADMIN](../docs/admin-product-images.md) documenta configuración backend, bucket
privado, permisos, límites de despliegue, recuperación y limpieza. Las pruebas
locales no acreditan políticas ni credenciales de un proyecto Storage real.

## Pruebas locales

Instalar dependencias del monorepo, Java 21, Node y binarios nativos PostgreSQL (initdb,
pg_ctl, psql). En Windows se busca Program Files/PostgreSQL y en otras plataformas
pg_config. Las nuevas pruebas nativas fallan si falta PostgreSQL; no se omiten silenciosamente.
El bootstrap compartido crea un clúster temporal en loopback y lo cierra al finalizar;
no acepta una URL externa ni variables de conexión productivas. Quedan logs temporales.
`mvnw.cmd clean verify` incluye Hibernate/JPA real y `npm test` las carreras SQL.
Las carreras de órdenes coordinan un flush sin commit con una espera observada en
PostgreSQL: órdenes distintas de una cafetería, recordatorios y ambos ganadores posibles
de DELIVERED/NOT_COLLECTED. Los tiempos máximos limitan las esperas; no establecen por sí
solos la evidencia de concurrencia.
