# Autenticación de UniFood

## Estructura

Estado posterior a 008–011: ver [integridad y despliegue](../../unifood-backend/supabase/README.md).
La DB exige ahora también la asignación WORKER/ADMIN y el ADMIN de cafeterías activas;
aprovisionar usuario inactivo → rol → cafetería → activación válida. El acceso directo a
tablas de negocio está cerrado para anon/authenticated: identidad mediante RPC y negocio
mediante Spring/BFF. `setup_auth.sql` no sustituye esas migraciones ni concede UPDATE de perfil.
El proxy conserva todas las escrituras de cookies y envía su limpieza en la propia
redirección contextual o respuesta 401 cuando la sesión es inválida.
Los rechazos definitivos (sesión inexistente/revocada o token inválido) eliminan las
cookies del proyecto, chunks, PKCE y remember. Un timeout, error de red, 502/503 u otro
fallo reintentable conserva las cookies y bloquea el acceso con un 503 seguro y no-store.
Las páginas mantienen su URL y ofrecen un reintento explícito, sin redirección a login
ni recarga automática. Si falla la comprobación posterior del perfil, las API devuelven
el mismo error temporal y las páginas muestran una pantalla segura con reintento.

- `/` redirige a `/login`, con acceso a registro estudiantil. `/login` es la entrada CLIENT y `/panel/login` la entrada WORKER/ADMIN/SUPER_ADMIN; ambas reutilizan `AuthScreen` con variantes explícitas.
- `app/registro` sigue siendo exclusivamente CLIENT y es el paso 1 del registro en dos pasos; `app/registro/completar` es el paso 2 (ver [Registro en dos pasos](#registro-en-dos-pasos)). `app/privacidad` es un borrador pendiente de revisión legal. `app/recuperar-contrasena` conserva OTP para CLIENT y redirige `?entrypoint=panel` a `/panel/recuperar`. El panel usa enlaces PKCE y `/panel/nueva-contrasena`; ver [recuperación del panel](panel-password-recovery.md).
- `app/api/auth/[action]`: login, reglas del dominio (`rules`), registro (`register`), paso 2 (`complete`), verificación, reenvío, recuperación y cierre de sesión. Comprueba el origen y valida los datos antes de contactar Supabase.
- `features/auth/server`: cliente Supabase del login y consulta del usuario/perfil real. Sus tokens permanecen en cookies HttpOnly. La recuperación del panel usa un cliente Supabase browser separado: verificador PKCE en localStorage y sesión temporal solo en memoria, sin escribir cookies de login.
- `proxy.ts`: renueva la sesión en las páginas públicas que la consultan, panel, cuenta y proxy de pedidos; no autoriza roles.
- `app/worker/page.tsx`: comprueba la sesión y los roles antes de renderizar `components/worker/WorkerDashboard.tsx`.
- `app/cuenta`: Inicio móvil exclusivamente CLIENT con cuenta verificada; `/cuenta/perfil` muestra nombre/correo del contrato de identidad y datos propios leídos mediante Spring; conserva logout y enlaza la recuperación por correo desde `/cuenta/perfil/contrasena`. Layout y páginas comprueban el rol en el servidor; `proxy.ts` renueva la sesión en `/cuenta/:path*`. WORKER/ADMIN/SUPER_ADMIN se redirigen a su destino. El catálogo es una vista previa identificada con datos de ejemplo; ver [frontend del estudiante](client-frontend.md).
- Spring conserva los casos de uso y verifica JWT, usuario activo, rol y asignación a cafetería antes de cada lectura o mutación de pedidos.

## Configuración local

Copiar `.env.example` a `.env.local` y completar:

```dotenv
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-key-o-anon-key>
AUTH_USERNAME_DOMAIN=ustavillavo.edu.co
API_URL=http://localhost:8080
```

Usar la clave pública del proyecto, **nunca service_role**. Estos valores se leen en el servidor; las páginas de recuperación del panel comparten únicamente URL y clave publishable/anon con el cliente browser. Reiniciar Next.js después de cambiarlos. Sin configuración, las pantallas siguen siendo visibles y los formularios muestran un error seguro; no hay autenticación simulada.

La comprobación de origen deriva el origen esperado de los encabezados `Host` y `x-forwarded-host`, no de `request.url`. Next construye `request.url` con el hostname del bind, de modo que con `--hostname ::` vale `http://[::]:3000` y no coincide nunca con el `Origin` que envía el navegador. Comparar contra `request.url` rechazaría todos los formularios en localhost, `127.0.0.1` y la IP de LAN. Los encabezados `X-Forwarded-*` son de uso restringido para el navegador, así que un atacante de otro origen no puede manipularlos.

Un usuario corto como `maria` se interpreta como `maria@AUTH_USERNAME_DOMAIN`. Para otras instituciones se escribe el correo completo. Los dominios admitidos se consultan en `public.institutions` y deben estar activos; no basta con terminar en `.edu.co`.

Santo Tomás acepta **`@ustavillavo.edu.co` y `@ustavillavicencio.edu.co`**. La migración `006_institution_email_alias.sql` resuelve ambos al mismo registro institucional, cuyo dominio principal es `ustavillavo.edu.co`. No crea otra universidad ni cambia el destinatario del código. El registro exige el correo completo; la opción de usuario corto aplica al login. Para iniciar sesión con el segundo dominio, escribir el correo completo.

En Spring, configurar explícitamente `SUPABASE_DB_URL` y `SUPABASE_AUTH_ISSUER=https://<project-ref>.supabase.co/auth/v1` del mismo proyecto. Ambas son obligatorias en todos los entornos; no se selecciona un perfil ni un proyecto predeterminados. El backend valida la audiencia `authenticated`. Usar las claves de firma asimétricas de Supabase (ES256 o RS256/JWKS); si el proyecto conserva exclusivamente la clave legacy HS256, migrar las claves de firma antes de conectar este resource server. Ver [configuración de entornos](environments.md).

## Base de datos

Aplicar las migraciones existentes en orden y después `unifood-backend/supabase/migrations/005_auth_profiles.sql` desde el SQL Editor o el proceso habitual de migraciones. Esta implementación no ejecuta migraciones remotamente.

Después de `005`, aplicar **`006_institution_email_alias.sql`**. Esta actualización es necesaria tanto para la comprobación del dominio como para el trigger que crea el estudiante y la consulta de instituciones del backend. Deshabilitar la institución bloquea el registro con ambos dominios.

La migración:

- Crea un perfil `public.users` al crearse una identidad en Supabase.
- Para registros de estudiantes, valida el dominio, nombre y documento; crea `clients` y asigna exclusivamente `CLIENT` en la misma transacción. El documento es único. **Desde la 018 esto cambia:** ver [Registro en dos pasos](#registro-en-dos-pasos).
- Hace opcional el teléfono, que no forma parte de las pantallas solicitadas.
- Evita que un estudiante cambie su institución mediante la política existente de actualización de perfil.
- Expone dos RPC con privilegios acotados: `is_institutional_email` y `current_auth_profile`.

Las cuentas existentes deben tener su correspondiente registro en `public.users`. Las migraciones no asignan automáticamente roles a usuarios anteriores. Los trabajadores se aprovisionan administrativamente en `user_roles` y `cafeteria_users`; el registro público nunca asigna WORKER, ADMIN ni SUPER_ADMIN. Una cuenta sin perfil o deshabilitada no obtiene acceso. Cada WORKER operativo debe tener exactamente una fila de asignación en `cafeteria_users`; una cafetería puede tener varios WORKER. La migración 009 impone también estas reglas en DB, además de su comprobación en contexto y autorización.

Después de `006`, aplicar **`007_auth_role_cardinality.sql`**. Mantiene `user_roles` y añade `uq_user_roles_user UNIQUE(user_id)`: ninguna cuenta, activa o inactiva, puede tener dos roles. Los constraint triggers `trg_users_auth_role_cardinality` y `trg_user_roles_auth_role_cardinality` son `DEFERRABLE INITIALLY DEFERRED`; al commit cada usuario activo debe tener exactamente un rol CLIENT, WORKER, ADMIN o SUPER_ADMIN. La migración aborta si encuentra datos incompatibles y no elige ni asigna roles automáticamente. Las migraciones históricas permanecen intactas. `setup_auth.sql` consolida 005–007, funciona después de 001–004 y puede repetirse después de 007.

Desde la 018, el registro crea CLIENT y activa el perfil en el paso 2, en la misma transacción. Una identidad no estudiantil empieza inactiva y sin rol, aunque sus metadatos soliciten privilegios. Para WORKER/ADMIN, insertar un único rol, asignar una cafetería y activar únicamente con el perfil completo; se permite construir ese estado en una transacción. SUPER_ADMIN no tiene asignación. Para revocar el último rol, desactivar el usuario y ajustar sus asignaciones en la misma transacción. Sustituir un ADMIN de cafetería activa requiere completar su reemplazo atómicamente o desactivar administrativamente la cafetería. Una eliminación de identidad sigue sujeta a FK e invariantes. `TRUNCATE` se rechaza porque omite los triggers por fila; usar `DELETE`.

La migración 007, considerada aisladamente, usa los triggers `trg_users_auth_role_lock` y `trg_user_roles_auth_role_lock` para adquirir `pg_advisory_xact_lock` por usuario antes de las escrituras relevantes. La clave es `hashtextextended('unifood:auth-role-cardinality:' || user_id::text, 0)`, un entero firmado de 64 bits derivado del UUID completo con un namespace propio. No se trunca el UUID ni se usa un hash de 32 bits. Estos locks de 007 no son globales. Un hash finito admite colisiones, aproximadamente 2⁻⁶⁴ por pareja: una colisión solo introduce espera entre esos usuarios, nunca permite un estado inválido. Las claves se calculan en el mismo servidor y no se persisten; no se requiere estabilidad entre versiones mayores de PostgreSQL.

Cada cambio en `user_roles` también escribe `users.is_active = users.is_active` del mismo usuario, sin cambiar su actividad. Esto actualiza `users.updated_at` mediante su trigger existente y hace que escritores con snapshots antiguos en REPEATABLE READ/SERIALIZABLE aborten con 40001. Los locks duran hasta finalizar la transacción. Las transacciones administrativas pueden requerir reintento completo ante 40001 o deadlock 40P01. La instalación toma locks de tabla temporalmente para impedir escrituras entre el pre-audit y la creación de restricciones.

La migración 009 añade una fila compartida de coordinación sobre users, user_roles, roles,
cafeteria_users y cafeterias antes de los locks de 007. Comprueba al commit la cafetería
de WORKER/ADMIN, la ausencia de asignaciones CLIENT/SUPER_ADMIN y el ADMIN de cafeterías
administrativamente activas. Puede serializar escrituras de usuarios distintos, incluidas
altas de estudiantes y aprovisionamiento, y provocar reintentos completos bajo snapshots
antiguos. No define disponibilidad diaria. La protección de pedidos de 008 y del servicio
es independiente: reserva de orden, reserva de cola por cafetería y versión JPA/DB.

## Registro en dos pasos

Migración 018 y `docs/decisiones.md` §3. Toda llamada a Supabase del registro pasa por el BFF con la clave publicable; el navegador no recibe tokens fuera de las cookies HttpOnly ni la contraseña del paso 1.

**Paso 1, `/registro`.** El correo se valida en cliente y en servidor con la misma regla que la base: dominio exacto, sin `+`, espacios ni puntos sueltos. Mientras se escribe, `POST /api/auth/rules` llama a `registration_rules(email)` y devuelve solo `{ allowed, clientType }`, nunca si la cuenta existe. `POST /api/auth/register` genera en el servidor una contraseña con `crypto.randomBytes(32)` y llama a `signUp` solo con correo y esa contraseña, sin metadatos. La contraseña no se devuelve, no se registra en logs ni en errores, y la respuesta es `{ ok: true }` exista o no la cuenta (también ante `user_already_exists` o `email_exists`).

**Código.** El correo trae 6 dígitos que vencen a los 15 minutos, igual que los 900 s de Auth. El reenvío espera 60 s y se limita a 3 por pantalla; el `429` de Supabase muestra «Demasiados intentos». `verifyOtp` de tipo `signup` deja la sesión en las cookies existentes. Esa sesión lleva `amr` con `otp`, que `complete_registration()` exige tras un signup público.

**Campo del código.** Registro, confirmación desde el login y recuperación comparten un solo campo en `AuthScreen`, en lugar de las seis cajas anteriores. Lleva `autoComplete="one-time-code"`, `inputMode="numeric"`, `pattern="[0-9]{6}"` y `name="one-time-code"`, para que iOS y Android lo autocompleten entero. `normalizeOtp` deja solo dígitos, hasta seis, al escribir, pegar o autocompletar, así que «123 456», «123-456» o el asunto completo del correo valen. Al completar los seis dígitos el formulario se envía solo, por el mismo manejador que el botón «Verificar». No se envía dos veces: hay un candado mientras la petición está en curso, y el mismo código no se reenvía solo tras un rechazo. El campo recibe el foco al aparecer, queda de solo lectura mientras se envía para no cerrar el teclado, y tras un error queda seleccionado y enlazado al mensaje, que se anuncia con `role="alert"`.

**Paso 2, `/registro/completar`.** La página lee `pending_registration()` en el servidor y pasa al formulario el tipo de cuenta y las longitudes del código; el cliente no las fija. `POST /api/auth/complete` valida nombre, código, privacidad y contraseña, y luego, en este orden:

1. `updateUser({ password })` con la sesión del usuario. En un reintento Auth responde `same_password`, que aquí no es error: el hash ya cambió en el intento anterior.
2. `signOut({ scope: "others" })`.
3. `rpc("complete_registration", { full_name, institutional_code, privacy_accepted })`.

Si falla el 1 o el 2, no se llama al 3. Si falla el 3, la sesión se conserva y el usuario reintenta sin un código nuevo. Al terminar, la cuenta entra a `/cuenta`.

**Reanudar.** Login, verificación y recuperación consultan `pending_registration()` cuando la cuenta aún no tiene rol: si está pendiente, conservan la sesión y llevan a `/registro/completar`. `requireAuth`, `/login` y `/registro` hacen lo mismo, así que una cuenta pendiente no llega a ninguna pantalla del cliente. Un error al leer el registro pendiente niega el acceso, nunca lo concede. Sin sesión, «¿Olvidaste tu contraseña?» da una sesión `otp` y continúa en el paso 2. Pasadas 24 horas la limpieza de la 018 borra la cuenta y hay que registrarse de nuevo.

**Errores.** Los `REGISTRATION_*` de la base se traducen en `features/auth/server/registration.ts` a mensajes en español sin detalles internos. Solo `REGISTRATION_CODE_UNAVAILABLE` habla de un código existente, y solo aparece dentro del paso 2 de quien lo intenta. Un error desconocido devuelve `REGISTRATION_FAILED` con un mensaje genérico.

## Correo y contraseñas en Supabase

En Authentication:

1. Activar el proveedor Email y **Confirm email**.
2. Configurar OTP de **6 dígitos**, con expiración y límites de frecuencia de Supabase habilitados.
3. En **Confirm signup** y **Reset password**, conservar `{{ .Token }}` para registro y recuperación OTP de CLIENT. En **Reset password**, incluir también un enlace con `{{ .ConfirmationURL }}` para el flujo PKCE del panel. Ver la [configuración y plantilla compatible](panel-password-recovery.md).
4. Configurar SMTP para entregar correos a estudiantes reales. El remitente de pruebas de Supabase tiene restricciones de destinatarios.
5. Configurar también en Supabase una longitud mínima de 8 caracteres, mayúscula, minúscula y número. La aplicación valida estas reglas, pero el proveedor debe aplicarlas también para impedir que se omitan llamando directamente a su API.
6. Configurar Site URL con la URL real del frontend. La aplicación no necesita una clave administrativa para enviar los correos.

El reenvío tiene una espera visual de 60 segundos; el límite efectivo y el control de intentos son responsabilidad de Supabase, también entre pestañas o instancias. La recuperación muestra un mensaje neutro para no revelar la existencia de una cuenta. Después de cambiar la contraseña se invalidan las sesiones de actualización con cierre global y se vuelve al login. Como ocurre con JWT, los access tokens ya emitidos pueden permanecer válidos hasta su vencimiento; configurar una vida corta en Supabase.

### Si el registro envía un enlace en lugar del código

El registro usa `signUp`, el reenvío usa `resend({ type: "signup" })` y la verificación acepta exactamente seis dígitos mediante `verifyOtp`. El contenido del correo se configura en el proyecto de Supabase: cambiar `.env.local` o reiniciar Next.js no sustituye la plantilla remota.

1. Abrir en el panel de Supabase el proyecto correspondiente a `SUPABASE_URL`.
2. En **Authentication → Email Templates** (o **Emails → Templates**), abrir **Confirm sign up**.
3. Usar el asunto `Tu código UniFood: {{ .Token }}`, recomendado en el [README de plantillas](../../unifood-backend/supabase/templates/README.md), y reemplazar **todo** el cuerpo con el contenido de [`confirmation.html`](../../unifood-backend/supabase/templates/confirmation.html). La plantilla muestra `{{ .Token }}` y no contiene enlaces ni `{{ .ConfirmationURL }}`. Guardar los cambios. Editar únicamente **Magic Link** no cambia los correos de registro con contraseña.
4. En la configuración del proveedor **Email**, mantener **Confirm email** activado y establecer **Email OTP Length** en **6**. Conservar la expiración y los límites de envío habilitados.
5. Desde la pantalla de verificación de UniFood, solicitar **Reenviar código** cuando termine la espera. Comprobar el correo nuevo: debe mostrar seis dígitos, sin botón de confirmación. Introducir ese código en UniFood y verificar el acceso a `/cuenta`.

Guardar el HTML en este repositorio no lo publica automáticamente en Supabase. La clave `SUPABASE_PUBLISHABLE_KEY` permite el registro, pero no administrar plantillas; este ajuste requiere acceso al panel del proyecto. No hace falta agregar claves administrativas a `.env.local`.

Los correos ya entregados no cambian. Para probar el registro completo, usar una cuenta nueva; una cuenta que ya se confirmó al pulsar el enlace debe iniciar sesión normalmente.

## Sesiones y permisos

Las cookies de sesión son `HttpOnly`, `SameSite=Lax` y `Secure` en producción. “Mantener sesión iniciada” usa una cookie persistente de 30 días; desmarcarlo usa cookies de sesión del navegador. Un navegador configurado para restaurar sesiones puede conservar estas últimas. Supabase sigue controlando expiración y revocación.

El proxy de pedidos toma el access token de la sesión verificada; ignora cualquier Authorization enviado por el navegador. Spring valida firma, emisor y audiencia y consulta los permisos vigentes en la base de datos. Solo WORKER activo y asignado a la cafetería puede listar u operar pedidos. CLIENT, ADMIN y SUPER_ADMIN no tienen permisos operativos. Una cuenta con ADMIN o SUPER_ADMIN se bloquea también si tiene WORKER. Los roles nunca se toman de `user_metadata`.

`GET /api/worker/context` es un endpoint Spring autenticado que devuelve únicamente `{ "cafeteriaId": "<uuid>" }`, con `Cache-Control: no-store`. La identidad procede del subject JWT; `config.OrderAuthorization` adapta Spring Security a un UUID y delega en `application.service.OrderAuthorizationService`. El servicio aplica la política usando hechos actuales del puerto `AuthorizationQueryPort`, implementado por `AuthorizationPersistenceAdapter`. El adaptador consulta actividad, roles y asignaciones en una sola sentencia por usuario; lee como máximo dos asignaciones, suficientes para detectar cardinalidad inválida. El SQL vive en `src/main/resources/sql/authorization/`, compartido con las pruebas PostgreSQL/PGlite sin extraer código Java. No hay caché ni reglas de permisos en el SQL. Falta de asignación, múltiples asignaciones, rol no operativo e inactividad producen el mismo 403 mediante `ApiErrorResponse`, sin revelar detalles de asignaciones. El endpoint no acepta un ID de usuario ni una cafetería como fuente de autoridad.

El navegador solo pide `GET /api/orders`. El BFF consulta primero el contexto y después llama al GET Spring existente con la cafetería resuelta; ignora las queries del cliente. Solo hay una resolución de contexto por listado, sin fetch adicional del dashboard ni caché, cookies o localStorage de asignación. Las acciones PATCH siguen autorizándose contra la cafetería real del pedido en Spring y no dependen de un contexto obtenido anteriormente. `current_auth_profile()` conserva su contrato de identidad/roles; no se añaden RPC ni SQL duplicado.

Ante errores de contexto, el BFF no consulta pedidos ni usa cafeterías predeterminadas. Devuelve mensajes genéricos sin copiar cuerpos internos del backend; conserva 401/403 y usa 502 para otros fallos o respuestas malformadas. El dashboard muestra su estado de error existente sin rediseño.

El acceso exige una cuenta activa con exactamente un rol de negocio conocido: CLIENT, WORKER, ADMIN o SUPER_ADMIN. Login, verificación, carga de sesión y predicados de autorización rechazan cero roles, roles múltiples o desconocidos. La carga de sesión no obtiene un access token para perfiles inválidos. Las combinaciones mixtas se conservan únicamente en pruebas adversariales.

Los destinos son `/cuenta` para CLIENT, `/worker` para WORKER, `/admin` para ADMIN y `/super-admin` para SUPER_ADMIN. Una sesión válida que visite cualquiera de los dos logins o `/registro` se redirige al destino de su rol actual. Anónimos y perfiles inválidos vuelven a `/login` desde `/cuenta`, y a `/panel/login` desde las páginas del panel. Los dos destinos administrativos siguen siendo placeholders protegidos, sin aprovisionamiento.

`/api/auth/[action]` acepta únicamente `entrypoint: "client" | "panel"`; su ausencia equivale a CLIENT por compatibilidad y otros valores se rechazan antes de contactar al proveedor. Después de autenticar o confirmar el correo, consulta `current_auth_profile()`, exige actividad y un único rol conocido y comprueba compatibilidad con la entrada. CLIENT en panel y roles del panel en entrada CLIENT reciben 403 y signOut local. El contexto solo configura navegación y presentación: no crea roles, no sustituye PostgreSQL y no se persiste como permiso.

`rememberCookie` se establece después de aceptar el perfil y la entrada. El login no confirmado puede continuar por OTP en su misma variante; remember se aplica después de esa confirmación, no antes. En un rechazo o fallo de lectura del perfil se intenta signOut local, se borra remember y se eliminan exactamente las cookies que escribió el SDK durante el intento, incluso si signOut falla. El cliente comunica únicamente sus nombres; no se interpretan formatos de cookies ni se exponen sus valores.

Brand, logout y la navegación de AuthScreen reciben contexto explícito. La variante panel presenta una composición desktop y no ofrece registro estudiantil. CLIENT conserva su sesión temporal durante OTP/reset y vuelve al login contextual en la misma pantalla. El panel solicita un enlace, valida PKCE y `PASSWORD_RECOVERY`, actualiza directamente en Supabase y vuelve a `/panel/login?password=updated` tras finalizar la sesión. Ninguna recuperación admite returnTo arbitrario ni redirige automáticamente por una sesión normal. La comprobación del rol se repite al iniciar sesión. `PanelAuthHero`, `AuthField` y el guard de hidratación se comparten sin cambiar la política del login.

`InstitutionController` (`/api/institutions/*`) se eliminó el 2026-11-10: ningún código de la web, del registro ni de los paneles lo consumía, y sus consultas no filtraban por rol ni institución. Spring responde 404 a esas rutas. Si un panel SUPER_ADMIN necesita instituciones, tendrá su propio contrato con rol exigido.

## Perfil CLIENT y autoridad de negocio

`GET /api/me/profile` devuelve únicamente `document`, `phone` e `institution` (nombre).
Spring toma el UUID del subject JWT verificado y aplica la misma política CLIENT que
la cancelación propia: usuario activo y rol exclusivo CLIENT, leídos de PostgreSQL.
Los IDs de usuario, cliente o institución enviados por navegador no seleccionan datos.
Nombre y correo continúan usando el contrato aprobado de `current_auth_profile()`;
no se amplía esa RPC para consultar más datos de negocio.

La página `/cuenta/perfil` ya se renderiza en Next servidor. Su helper `server-only`
consulta Spring con el token de la sesión verificada, `no-store`, timeout y sin seguir
redirecciones. No necesita un endpoint Next adicional ni consulta PostgREST de negocio.
Spring devuelve 401 para identidad no autenticada, 403 para un usuario no elegible,
404 `CLIENT_PROFILE_NOT_FOUND` si falta el registro CLIENT y 503 seguro para un fallo
temporal de persistencia. Las respuestas del perfil son `no-store`.

El teléfono nulo conserva «Sin registrar». Una institución inactiva conserva documento
y teléfono y devuelve su nombre como nulo, manteniendo el fallback previo. Ante errores
del backend, la página conserva nombre/correo y ofrece recargar sin borrar cookies,
cerrar sesión ni mostrar mensajes internos. La recuperación posterior reutiliza la sesión.
Las migraciones y grants de 010 permanecen intactos.

Los tests HTTP del perfil ejecutan los adaptadores JDBC y el caso de uso sobre PostgreSQL
nativo con 001–011, incluyendo permisos de tabla/columna cerrados, subject frente a IDs
manipulados, roles y revocación. El proveedor E2E rechaza las lecturas directas de
`clients`/`institutions` y registra que la pantalla usa el endpoint de negocio.

## Verificación

```sh
npm test
npm run lint
npm run build
npm run test:e2e
```

En el backend, con Java 21:

```sh
./mvnw -Dtest=OrderTest,OrderServiceTest,ClientTest,SecurityConfigTest test
```

Las pruebas automatizadas de auth usan un proveedor simulado. La política de autorización tiene tests de aplicación sin MVC ni JDBC. Los tests HTTP backend usan los endpoints, guards, servicio y handlers reales con hechos simulados detrás del puerto; los tests directos del adaptador verifican el mapeo JDBC y los recursos SQL. Esos mismos recursos se ejecutan en PostgreSQL/PGlite con las migraciones reales para comprobar roles, asignaciones, inactividad y revocación, sin reproducir la política de permisos en JavaScript ni extraer SQL mediante regex. Para validar la integración real, configurar el proyecto y comprobar: registro en dos pasos con correo real, código inválido/vencido, reenvío, confirmación, login, recarga, cierre de sesión, recuperación y rechazo del estudiante al acceder a `/worker` y `/api/orders`. Con un trabajador, comprobar acceso a su cafetería y rechazo a otra. No asumir que las pruebas locales verifican SMTP o la aplicación remota de las migraciones.

`npm test` también ejecuta las migraciones completas en PostgreSQL en memoria (PGlite). Comprueba los dos dominios, conservación del correo, coincidencia exacta, rechazo de subdominios/sufijos falsos, institución inactiva, rollback de registros inválidos y asignación exclusiva del rol CLIENT. La acción `rules` se prueba contra `registration_rules()` real con el rol `anon`; el envío de correo de Supabase sigue simulado. El paso 2 tiene un e2e contra el proveedor local con la cuenta `pendingclient`.

Los tests de cardinalidad PGlite comprueban commits, rollback, sustitución/revocación de roles, traslado de asignaciones, cascadas, datos históricos incompatibles y repetición de `setup_auth.sql`. Los tests específicos de 007 fijan esa versión para aislar su invariante; allí se comprueba independencia entre usuarios y ese test legado puede omitirse si faltan binarios. Eso no representa el esquema combinado posterior a 009.

Las pruebas actuales de integridad combinada y de órdenes exigen PostgreSQL nativo
(directorio de instalación en Windows o pg_config en PATH): fallan si falta, no se omiten.
El backend exige además Java 21, Node y las dependencias web para su bootstrap aislado.
Las bases se crean en loopback, sin URLs externas ni variables de conexión del desarrollador,
y se detienen al terminar. Las carreras SQL prueban READ COMMITTED, REPEATABLE READ y
SERIALIZABLE con evidencia de espera real; las de JPA prueban FIFO entre órdenes distintas,
recordatorios y ambas transiciones terminales. PGlite complementa integridad y pre-audits,
pero no sustituye esas pruebas concurrentes nativas.

Playwright inicia Next.js en el puerto 3100 y un proveedor/backend de prueba en `127.0.0.1:3101`; usa Edge en Windows o Chromium en otros sistemas (`npx playwright install chromium` si falta). Las pruebas de formularios simulan las respuestas de `/api/auth`; las pruebas de roles usan login, páginas y BFF reales con sesiones del proveedor local de prueba, sin relajar guards. Se comprueba también el dashboard y la preparación de un pedido. Estos fixtures no sustituyen la comprobación de Spring y SQL. Las capturas se guardan en `test-results/`. Ejecutar las pruebas de navegador sin una sesión previamente iniciada.

Si ya está corriendo el servidor de desarrollo, probarlo sin levantar otra instancia: en PowerShell, `$env:PLAYWRIGHT_BASE_URL='http://localhost:3000'` y después `npm run test:e2e`. En ese modo externo se omiten los tests de roles que requieren el proveedor local controlado; para la validación completa ejecutar sin `PLAYWRIGHT_BASE_URL`.

Referencias: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [plantillas de correo](https://supabase.com/docs/guides/auth/auth-email-templates), [Spring JWT resource server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html).
