# Reporte de correcciones sobre develop

Fecha de cierre del reporte: 12 de octubre de 2026.

Resultado final: todas las validaciones requeridas están aprobadas, incluida
la repetición completa del E2E después de corregir el encabezado de caché.

Las correcciones H1, M1, M2, M3 y M5 se prepararon sobre `develop`, partiendo de
`3b92c969d20137cd30ff4cacac1a15cff2ee5dd6`, después de comprobar una copia limpia
y sincronizada mediante `git fetch origin --prune`. No se cambió de rama ni se
usó `main` como base. Los cambios permanecen locales, sin staging ni commit.

La comparación original `develop...origin/feature/client-frontend` no contiene
cambios exclusivos en las referencias inspeccionadas: ambas apuntan a la misma
base. Este reporte describe las correcciones locales posteriores; no atribuye
estos cambios a commits exclusivos de la rama del compañero.

El alcance de implementación, pruebas y documentación comprende 42 archivos:
31 modificados y 11 nuevos. Este reporte añade un archivo de documentación.
Las migraciones nuevas se aplicaron únicamente en bases de pruebas aisladas.
No se consultó ni modificó una base remota ni se utilizaron secretos productivos.

## 1. H1: causa raíz

Las mutaciones podían reconstruir una orden desde una lectura sin bloqueo y
persistirla después sin comprobar una versión del registro. Dos transacciones
podían leer `PENDING`, calcular transiciones distintas y sobrescribir el estado
confirmado por la otra. La consulta FIFO, por sí sola, no reservaba la cola y
no impedía las carreras entre WORKER ni entre CLIENT y WORKER.

## 2. Estrategia de concurrencia y justificación

Se combinaron tres protecciones, dentro de las transacciones existentes:

- Lectura de la orden con bloqueo de fila `PESSIMISTIC_WRITE`/`FOR UPDATE` para
  validar el estado autoritativo antes de cada mutación.
- Reserva de la fila de cafetería antes de preparar un pedido para serializar
  la decisión FIFO de esa cafetería. La cafetería se obtiene primero mediante
  una proyección, evitando introducir una entidad antigua en la caché JPA.
- `@Version` de Hibernate y una columna `orders.version` para rechazar entidades
  obsoletas. Un trigger incrementa la versión también en actualizaciones SQL
  privilegiadas, y `saveAndFlush` detecta el conflicto antes de devolver éxito.

El bloqueo de orden resuelve la lectura y escritura consistente de una
transición; la reserva de cafetería protege una regla que abarca varios pedidos;
la versión cubre escrituras realizadas desde copias antiguas. Usar solo una
versión no habría resuelto la reserva FIFO ni definido el arbitraje acordado.
No se almacena la prioridad en el proceso Java: PostgreSQL coordina las filas.

Si la cafetería del pedido cambia mientras prepare espera la reserva de cola,
se rechaza la operación: no se prepara usando el bloqueo de otra cafetería.

## 3. Prioridad de cancelación y límite del arbitraje

Se implementó el arbitraje atómico en PostgreSQL aceptado expresamente por el
usuario. La cancelación CLIENT toma la reserva de la orden directamente;
prepare toma primero la reserva de cola y después la reserva de la orden.

Si CLIENT reserva la orden todavía `PENDING` antes del punto de arbitraje de
prepare y confirma la cancelación, el estado queda `CANCELLED` y se persiste
`cancelled_by_client=true`. El WORKER, al adquirir la fila, lee ese estado y
recibe `ORDER_CANCELLED_BY_CLIENT`; no puede sobrescribirlo con `PREPARING`.

Si prepare obtiene primero la reserva y confirma `PREPARING`, una cancelación
posterior espera y recibe `ORDER_ALREADY_PREPARING`. Si la transacción de
prepare revierte, la cancelación puede continuar sobre `PENDING`.

La prioridad se mide en el punto de arbitraje de PostgreSQL. No promete que
cualquier petición HTTP llegada antes del final físico del COMMIT pueda
interrumpir una preparación que ya ganó la reserva. La prueba específica
coordina una espera real sobre la cola, registra la cancelación sobre PENDING
y comprueba que prepare no puede confirmar PREPARING después.

## 4. Protección de todas las transiciones

Todas estas operaciones leen la orden con bloqueo, validan el estado dentro
de su transacción y guardan con comprobación de versión:

| Operación | Estado inicial | Resultado |
| --- | --- | --- |
| Preparar | PENDING | PREPARING; conserva FIFO |
| Cancelar CLIENT | PENDING, pedido propio | CANCELLED; registra actor CLIENT |
| Cancelar WORKER | PENDING | CANCELLED; conserva el plazo existente |
| Marcar listo | PREPARING | READY |
| Llamar | READY | CALLED |
| Entregar | CALLED | DELIVERED |
| Marcar no recogido | CALLED, requisitos de recordatorios cumplidos | NOT_COLLECTED |
| Recordar | CALLED | Conserva CALLED y actualiza contador/fecha con las reglas existentes |

Una transición duplicada no realiza una segunda escritura sobre un estado
confirmado. Las transiciones terminales opuestas y los recordatorios concurrentes
usan el estado vigente. CLIENT sigue pudiendo cancelar únicamente pedidos propios
en PENDING, sin añadirle el plazo de cancelación que ya usa WORKER.

## 5. Contratos HTTP finales

| Situación | HTTP/código | Mensaje funcional |
| --- | --- | --- |
| WORKER prepara una orden cancelada por CLIENT | 409 / ORDER_CANCELLED_BY_CLIENT | El cliente canceló este pedido. |
| CLIENT cancela una orden en preparación | 409 / ORDER_ALREADY_PREPARING | La orden ya está en preparación y no puede cancelarse. |
| Versión obsoleta, conflicto de bloqueo o modificación concurrente | 409 / ORDER_CONCURRENT_MODIFICATION | El pedido cambió mientras lo procesabas. Actualiza y vuelve a intentarlo. |
| Otra transición inválida o violación FIFO | 409 / código de dominio existente | Mensaje funcional del contrato existente |
| Sesión inválida | 401 en API; redirección contextual en páginas | Iniciar sesión |
| Rol sin permiso | 403 | Contrato existente |
| Pedido inexistente, ajeno o fuera del ámbito permitido cuando el contrato oculta su existencia | 404 | Contrato existente |

Los nuevos conflictos se expresan mediante códigos de dominio y se traducen
fuera del dominio. El BFF de cancelación admite el código específico de
preparación y devuelve su mensaje seguro; no reenvía cuerpos internos arbitrarios.
El frontend WORKER puede mostrar el mensaje de cancelación del cliente mediante
su manejo de errores existente. Los errores internos inesperados siguen siendo
500 sanitizados; las carreras previstas tienen tratamiento de conflicto.

La respuesta API de cancelación conserva `Cache-Control: no-store`. Las páginas
gestionadas por el proxy usan `private, no-store`.

## 6. M1: causa y solución de sesión/cookies

Se identificaron dos mecanismos que podían dejar residuos: recrear la respuesta
del proxy en sucesivos callbacks del SDK perdía escrituras previas de cookies;
y confiar en limpieza posterior desde una página no garantizaba enviar las
eliminaciones antes de una redirección o del streaming de Server Components.

El proxy conserva todas las escrituras en un mapa, captura los nombres de las
cookies recibidas y emite las eliminaciones en la misma respuesta final. Cuando
getUser/refresh no valida la identidad, elimina del request y de la respuesta
las cookies del proyecto correspondiente: token, chunks, user, PKCE y remember.
Mantiene cookies ajenas y las de otros proyectos Supabase.

Las páginas protegidas redirigen directamente a `/login` para CLIENT y
`/panel/login` para el panel. Las páginas públicas de login siguen disponibles
sin bucles. Las API protegidas responden 401. El matcher incluye ahora las rutas
de pedidos propios, incluida cancelación. Los handlers de admisión rechazada,
logout y reset usan limpieza explícita incluso si falla el cierre del proveedor.

El E2E de refresh rechazado se amplió a CLIENT y WORKER, con peticiones
concurrentes de API/navegación, comprobación inmediata de todas las cookies,
recarga sin bucles y login posterior. No se relajaron las comprobaciones para
ocultar el fallo.

## 7. M2: migración de cardinalidad

`009_cafeteria_cardinality.sql` valida los datos existentes bajo bloqueo de
instalación y aborta con SQLSTATE 23514 y referencias a perfiles incompatibles.
No desactiva usuarios, borra asignaciones ni repara perfiles automáticamente.

Añade UNIQUE(user_id), pero no depende únicamente de ese constraint: funciones
y triggers diferidos comprueban conjuntamente rol, actividad, asignación y
ADMIN de cada cafetería al finalizar la transacción.

Una fila privada de coordinación serializa las escrituras de aprovisionamiento
antes de los bloqueos por usuario de 007. Su actualización evita write skew
también en REPEATABLE READ y SERIALIZABLE, donde el perdedor puede recibir 40001.
TRUNCATE queda bloqueado en las tablas que participan en esos invariantes.

## 8. Reglas finales WORKER/ADMIN y aprovisionamiento

| Perfil/entidad | Regla |
| --- | --- |
| WORKER activo | Exactamente una cafetería |
| ADMIN activo | Exactamente una cafetería |
| WORKER/ADMIN inactivo | Cero o una asignación durante aprovisionamiento; nunca varias |
| CLIENT | Cero asignaciones operativas |
| SUPER_ADMIN | Cero asignaciones operativas |
| Cafetería administrativamente activa | Exactamente un ADMIN asignado y activo |
| Cualquier cafetería, incluso inactiva | Nunca dos ADMIN asignados; puede tener muchos WORKER |

Se conservan las reglas de 007: un usuario activo tiene exactamente un rol de
negocio; durante el aprovisionamiento inactivo puede tener cero o uno, nunca dos.
El patrón de construcción sigue siendo usuario inactivo, rol, cafetería y
activación únicamente al tener un perfil válido. Una cafetería nueva puede
crearse inactiva y activarse junto con su ADMIN en una transacción válida.
Retirar al único ADMIN exige sustituirlo en la misma transacción o desactivar
administrativamente la cafetería.

`cafeterias.is_active` representa actividad administrativa. Esta corrección no
lo convierte en apertura/cierre diario ni en disponibilidad de productos.

## 9. M3: resultado de la auditoría de RLS y permisos

La auditoría del SQL versionado encontró policies de lectura propia que no
exigían siempre actividad y una concesión UPDATE(full_name,phone) en 005.
Las policies necesitan analizarse junto con los grants: el entorno remoto no
se inspeccionó, por lo que no se afirma que todos los permisos amplios simulados
en pruebas estén instalados en producción.

Se eligió cerrar el acceso directo a tablas de negocio, conforme a la decisión
de usar Spring como autoridad de negocio. `010_backend_business_authority.sql`:

- Revoca permisos de tabla y de columna a PUBLIC, anon y authenticated en las
  15 tablas de UniFood expresamente enumeradas; conserva RLS habilitado y
  elimina sus policies de acceso directo.
- Revoca ejecución de helpers de negocio, incluido el helper legado de stock.
  Esto restringe permisos: no añade ni modifica una lógica de inventario.
- Mantiene las RPC de identidad `is_institutional_email` para anon/authenticated
  y `current_auth_profile` para authenticated.
- Endurece los permisos por defecto del propietario de la migración para objetos
  nuevos; no modifica el schema de Auth, extensiones ni tablas ajenas.

Las pruebas conceden deliberadamente permisos amplios antes de aplicar 010 y
comprueban su revocación usando roles SQL reales, incluido el UPDATE por columna,
para perfiles CLIENT, WORKER e inactivos. También comprueban las RPC de identidad
y el trigger de registro institucional. No equivalen a una auditoría del servicio
PostgREST remoto ni de todas sus posibles membresías heredadas.

Se retiró la concesión UPDATE del script consolidado `setup_auth.sql` para evitar
que ejecutarlo de nuevo reabra acceso por columna. No se editaron 001–007.

## 10. M5: integridad de order_items

`011_order_item_integrity.sql` audita referencias, pertenencia y subtotales
antes de cambiar el esquema; aborta explícitamente con datos incompatibles.

Añade `order_items.cafeteria_id`, lo rellena desde la orden después de la
validación y crea claves foráneas compuestas hacia orders y lunches. El mismo
item debe pertenecer a la cafetería de ambos. Un CHECK exige
`subtotal = unit_price * quantity`. Las FK impiden también movimientos de
padres que romperían la relación, incluso bajo concurrencia.

Un trigger deriva la clave de cafetería si un escritor interno la omite; una
clave suministrada incorrectamente se rechaza. No reescribe nombres ni importes
históricos. Cambiar el precio/nombre del catálogo no cambia el snapshot del item.

La base comprueba consistencia aritmética y estructural, no compara un precio
histórico con el precio actual del catálogo. El futuro caso de creación tendrá
que obtener precios del catálogo autorizado y calcular importes en el backend;
ese endpoint no se implementó en esta corrección.

## 11. Inventario completo de archivos

M = archivo existente modificado; N = archivo nuevo. Los 42 archivos de las
correcciones son los siguientes. Parte del diff Java corresponde al formato
exigido por Spotless en los propios archivos intervenidos.

```text
M unifood-backend/src/main/java/com/santotofood/adapter/in/web/error/GlobalExceptionHandler.java
M unifood-backend/src/main/java/com/santotofood/adapter/out/persistence/OrderPersistenceAdapter.java
M unifood-backend/src/main/java/com/santotofood/adapter/out/persistence/entity/OrderEntity.java
M unifood-backend/src/main/java/com/santotofood/adapter/out/persistence/mapper/OrderMapper.java
M unifood-backend/src/main/java/com/santotofood/adapter/out/persistence/repository/SpringDataOrderRepository.java
M unifood-backend/src/main/java/com/santotofood/application/service/OrderService.java
M unifood-backend/src/main/java/com/santotofood/domain/exception/InvalidOrderStateException.java
N unifood-backend/src/main/java/com/santotofood/domain/exception/OrderConflictException.java
M unifood-backend/src/main/java/com/santotofood/domain/model/Order.java
M unifood-backend/src/main/java/com/santotofood/domain/port/out/OrderRepository.java
M unifood-backend/src/main/java/com/santotofood/shared/error/ErrorCode.java
M unifood-backend/src/test/java/com/santotofood/adapter/in/web/error/GlobalExceptionHandlerTest.java
N unifood-backend/src/test/java/com/santotofood/adapter/out/persistence/OrderConcurrencyPostgresTest.java
M unifood-backend/src/test/java/com/santotofood/application/service/ClientOrderCancellationServiceTest.java
M unifood-backend/src/test/java/com/santotofood/application/service/OrderServiceTest.java
M unifood-backend/src/test/java/com/santotofood/config/ClientOrderCancellationApiTest.java
N unifood-backend/supabase/README.md
N unifood-backend/supabase/audit_business_integrity.sql
N unifood-backend/supabase/migrations/008_order_concurrency.sql
N unifood-backend/supabase/migrations/009_cafeteria_cardinality.sql
N unifood-backend/supabase/migrations/010_backend_business_authority.sql
N unifood-backend/supabase/migrations/011_order_item_integrity.sql
M unifood-backend/supabase/setup_auth.sql
M unifood-web/app/api/auth/[action]/route.ts
M unifood-web/app/api/me/orders/[orderId]/cancel/route.ts
M unifood-web/docs/auth.md
M unifood-web/features/auth/server/client.ts
M unifood-web/features/auth/server/config.ts
M unifood-web/proxy.ts
M unifood-web/tests/auth-role-cardinality-concurrency.test.mjs
M unifood-web/tests/auth-role-cardinality.test.mjs
M unifood-web/tests/auth.test.mjs
N unifood-web/tests/business-integrity-concurrency.test.mjs
N unifood-web/tests/business-integrity.test.mjs
M unifood-web/tests/client-order-cancellation.test.mjs
M unifood-web/tests/client-order-ownership.test.mjs
M unifood-web/tests/e2e/auth-audit.spec.ts
N unifood-web/tests/helpers/backend-postgres.mjs
M unifood-web/tests/helpers/native-auth-database.mjs
M unifood-web/tests/order-authorization.test.mjs
M unifood-web/tests/orders.test.mjs
M unifood-web/tests/proxy.test.mjs
```

El archivo adicional de este reporte es `REPORTE_CAMBIOS.md`.

## 12. Migraciones nuevas y orden

| Orden | Archivo | Función |
| --- | --- | --- |
| 008 | 008_order_concurrency.sql | Versión de órdenes y origen de cancelación CLIENT |
| 009 | 009_cafeteria_cardinality.sql | Pre-audit, cardinalidad y coordinación concurrente de perfiles |
| 010 | 010_backend_business_authority.sql | Mínimo privilegio y cierre del acceso directo de negocio |
| 011 | 011_order_item_integrity.sql | Pre-audit, FK compuestas y consistencia del subtotal |

Las migraciones históricas 001–007 permanecen intactas. `setup_auth.sql` sigue
consolidando 005–007 y no sustituye las migraciones nuevas. El script independiente
`audit_business_integrity.sql` es un preflight de solo lectura; no es una migración.
Las condiciones y secuencia de despliegue están en `unifood-backend/supabase/README.md`.

## 13. Pruebas nuevas y ampliadas

`OrderConcurrencyPostgresTest` ejecuta 14 casos con PostgreSQL nativo,
Hibernate/JPA, repositorios y servicio reales. Incluye cancelación ganadora
sobre PENDING, cancelación tardía, siete transiciones duplicadas concurrentes,
recordatorios/transiciones terminales, entidad obsoleta, actualización SQL que
invalida la versión, FIFO y cambio de cafetería mientras se espera la cola.
Los tests de error handling comprueban códigos, mensajes y ausencia de mensajes
internos de excepciones de concurrencia.

`business-integrity.test.mjs` verifica perfiles completos, rechazo de datos
legados incompatibles, grants por tabla/columna, identidad preservada,
pertenencia e importes de items y conservación de snapshots. La cobertura SQL
local incluye PGlite; las carreras no se simulan con ese motor.

`business-integrity-concurrency.test.mjs` usa PostgreSQL nativo para cuatro
carreras en cada uno de tres niveles de aislamiento: doble cafetería de un
WORKER, dos ADMIN en una cafetería, cambio de rol frente a asignación y activación
de cafetería frente a desactivación del único ADMIN. También comprueba el
movimiento concurrente de un lunch frente a la inserción del item.

Los tests de proxy/auth verifican chunks, PKCE, múltiples callbacks, aislamiento
entre proyectos y eliminación explícita en handlers. Los tests del BFF y de
pedidos comprueban los mensajes seguros de conflicto. El E2E de refresh rechazado
se ejecutó diez veces por perfil: diez WORKER y diez CLIENT.

El helper nuevo crea y cierra un PostgreSQL local aislado para JPA. No admite una
URL de base externa. Las pruebas nativas nuevas fallan si faltan los binarios;
no se omiten silenciosamente. Requieren Java 21, Node, dependencias web y PostgreSQL.

## 14. Resultados de validación

| Validación | Resultado | Fecha de la ejecución usada |
| --- | --- | --- |
| Backend: .\\mvnw.cmd clean verify | BUILD SUCCESS; 148 pruebas, 0 fallos, 0 errores, 0 omitidas | 10 de octubre; backend sin cambios posteriores |
| Concurrencia JPA/PostgreSQL | 14/14, incluidos en las 148 | 10 de octubre |
| Frontend: npm test | 137/137, 0 fallos, 0 omitidas | 12 de octubre, tras la corrección final de caché |
| Frontend: npm run lint | Aprobado | 12 de octubre |
| Frontend: npm run build | Aprobado; compilación y validación TypeScript | 12 de octubre |
| Frontend: npm run test:e2e | 71/71 aprobadas, ejecución completa de 5,3 minutos | 12 de octubre |
| E2E refresh rechazado, repeat-each=10 | 20/20 | 10 de octubre |
| Pruebas SQL/concurrencia | Aprobadas dentro de las suites anteriores | 10 y 12 de octubre |
| Preflight de solo lectura | Ejecutado satisfactoriamente en fixture local | 10 de octubre |
| Spotless, archivos Java intervenidos | Aprobado | 10 de octubre |
| git diff --check | Aprobado | 12 de octubre |

No existe un script typecheck separado en package.json; el build realizó la
validación TypeScript. El build usó URL y clave sintéticas de pruebas.

La primera ejecución completa de E2E obtuvo 70/71: el nuevo matcher del proxy
cambió el encabezado de la cancelación CLIENT de `no-store` a `private, no-store`,
incumpliendo el contrato existente. Se corrigió la respuesta de API para mantener
`no-store` y la repetición completa aprobó 71/71; no se modificó la expectativa del E2E.

El E2E se ejecutó en una copia temporal del frontend con los archivos de código,
configuración y pruebas comprobados idénticos a los del repositorio, sin archivos
de secretos del entorno. Usó puertos 3100/3101 y dejó intacto el servidor habitual.

Logs locales de evidencia:

```text
%TEMP%\unifood-fix-backend-verify.log
%TEMP%\unifood-fix-web-tests.log
%TEMP%\unifood-fix-web-build.log
%TEMP%\unifood-fix-e2e.log
%TEMP%\unifood-fix-cookie-repeat.log
```

## 15. Riesgos y condiciones pendientes para desplegar

- La base remota no fue auditada. Antes de desplegar, ejecutar el preflight de
  solo lectura con una conexión administrativa y resolver incompatibilidades
  mediante decisiones explícitas. 009/011 bloquearán la instalación si existen.
- Auditar permisos efectivos, membresías heredadas y objetos de otros
  propietarios. ALTER DEFAULT PRIVILEGES solo afecta al propietario que aplica
  la migración. Confirmar que Spring usa un rol de servidor con los permisos
  necesarios; no se concedieron privilegios nuevos a ese rol.
- Pausar escrituras del backend anterior al aplicar 008–011 y desplegar la
  versión nueva. No mezclar versiones JPA antiguas y nuevas durante el cambio.
- La coordinación global de perfiles reduce el paralelismo de aprovisionamiento
  y realiza validaciones globales. No serializa procesamiento de pedidos ni
  lecturas de catálogo, pero deberá revisarse si crece el volumen administrativo.
  Las transacciones administrativas con SQLSTATE 40001 requieren reintento completo.
- La prioridad de cancelación tiene el límite de arbitraje documentado en el
  punto 3. No equivale a prioridad absoluta basada en la llegada de peticiones HTTP.
- Las cancelaciones históricas no contienen un actor CLIENT recuperable de forma
  fiable: el indicador nuevo no inventa ese dato y el mensaje específico se
  garantiza para cancelaciones CLIENT registradas por la implementación nueva.
- Los constraints de items no certifican por sí solos el precio de catálogo en
  una creación futura. Ese caso de uso debe calcularlo en Spring y conservarlo
  como snapshot, según el punto 10.

Estos pendientes corresponden al despliegue y a funcionalidad futura expresamente
excluida; no se ejecutó ningún cambio en un entorno remoto.

## 16. Trabajo deliberadamente no implementado

No se añadió endpoint de creación de pedidos, checkout, cálculo de precios para
un caso de creación inexistente, catálogo nuevo, inventario cuantitativo ni
reparación automática de datos. No se cambiaron decisiones de roles ni de acceso
a las pantallas. No se hicieron merge, push, rebase, reset ni cambios en main.
No se prepararon cambios con git add ni se hizo commit.

## 17. Confirmación de Disponibilidad

Disponibilidad no fue implementada. No hay nuevas migraciones de disponibilidad,
estados por producto/día, apertura/cierre diario ni reutilización de stock como
disponibilidad. is_active conserva su significado administrativo. Las decisiones
futuras de disponibilidad binaria, ausencia equivalente a no disponible/cerrado
y cierre que bloquea pedidos nuevos permanecen fuera del alcance.

READY FOR HUMAN REVIEW — NO COMMIT MADE
