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
