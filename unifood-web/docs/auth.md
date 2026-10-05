# Autenticación de UniFood

## Estructura

- `/` redirige a `/panel/login`. `/login` es la entrada CLIENT y `/panel/login` la entrada WORKER/ADMIN/SUPER_ADMIN; ambas reutilizan `AuthScreen` con variantes explícitas.
- `app/registro` sigue siendo exclusivamente CLIENT. `app/recuperar-contrasena` es compartida y admite el contexto cerrado `?entrypoint=client|panel`.
- `app/api/auth/[action]`: login, registro, dominio institucional, verificación, reenvío, recuperación y cierre de sesión. Comprueba el origen y valida los datos antes de contactar Supabase.
- `features/auth/server`: cliente Supabase exclusivamente en el servidor y consulta del usuario/perfil real. El navegador no recibe tokens por JSON ni los guarda en localStorage.
- `proxy.ts`: renueva la sesión en las páginas públicas que la consultan, panel, cuenta y proxy de pedidos; no autoriza roles.
- `app/worker/page.tsx`: comprueba la sesión y los roles antes de renderizar `components/worker/WorkerDashboard.tsx`.
- `app/cuenta`: exclusivamente CLIENT con cuenta verificada. WORKER/ADMIN/SUPER_ADMIN se redirigen a su destino.
- Spring conserva los casos de uso y verifica JWT, usuario activo, rol y asignación a cafetería antes de cada lectura o mutación de pedidos.

## Configuración local

Copiar `.env.example` a `.env.local` y completar:

```dotenv
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-key-o-anon-key>
AUTH_USERNAME_DOMAIN=ustavillavo.edu.co
API_URL=http://localhost:8080
```

Usar la clave pública del proyecto, **nunca service_role**. Estos valores se leen en el servidor. Reiniciar Next.js después de cambiarlos. Sin configuración, las pantallas siguen siendo visibles y los formularios muestran un error de servicio no configurado; no hay autenticación simulada.

La comprobación de origen deriva el origen esperado de los encabezados `Host` y `x-forwarded-host`, no de `request.url`. Next construye `request.url` con el hostname del bind, de modo que con `--hostname ::` vale `http://[::]:3000` y no coincide nunca con el `Origin` que envía el navegador. Comparar contra `request.url` rechazaría todos los formularios en localhost, `127.0.0.1` y la IP de LAN. Los encabezados `X-Forwarded-*` son de uso restringido para el navegador, así que un atacante de otro origen no puede manipularlos.

Un usuario corto como `maria` se interpreta como `maria@AUTH_USERNAME_DOMAIN`. Para otras instituciones se escribe el correo completo. Los dominios admitidos se consultan en `public.institutions` y deben estar activos; no basta con terminar en `.edu.co`.

Santo Tomás acepta **`@ustavillavo.edu.co` y `@ustavillavicencio.edu.co`**. La migración `006_institution_email_alias.sql` resuelve ambos al mismo registro institucional, cuyo dominio principal es `ustavillavo.edu.co`. No crea otra universidad ni cambia el destinatario del código. El registro exige el correo completo; la opción de usuario corto aplica al login. Para iniciar sesión con el segundo dominio, escribir el correo completo.

En Spring, configurar explícitamente `SUPABASE_DB_URL` y `SUPABASE_AUTH_ISSUER=https://<project-ref>.supabase.co/auth/v1` del mismo proyecto. Ambas son obligatorias en todos los entornos; no se selecciona un perfil ni un proyecto predeterminados. El backend valida la audiencia `authenticated`. Usar las claves de firma asimétricas de Supabase (ES256 o RS256/JWKS); si el proyecto conserva exclusivamente la clave legacy HS256, migrar las claves de firma antes de conectar este resource server. Ver [configuración de entornos](environments.md).

## Base de datos

Aplicar las migraciones existentes en orden y después `unifood-backend/supabase/migrations/005_auth_profiles.sql` desde el SQL Editor o el proceso habitual de migraciones. Esta implementación no ejecuta migraciones remotamente.

Después de `005`, aplicar **`006_institution_email_alias.sql`**. Esta actualización es necesaria tanto para la comprobación del dominio como para el trigger que crea el estudiante y la consulta de instituciones del backend. Deshabilitar la institución bloquea el registro con ambos dominios.

La migración:

- Crea un perfil `public.users` al crearse una identidad en Supabase.
- Para registros de estudiantes, valida el dominio, nombre y documento; crea `clients` y asigna exclusivamente `CLIENT` en la misma transacción. El documento es único.
- Hace opcional el teléfono, que no forma parte de las pantallas solicitadas.
- Evita que un estudiante cambie su institución mediante la política existente de actualización de perfil.
- Expone dos RPC con privilegios acotados: `is_institutional_email` y `current_auth_profile`.

Las cuentas existentes deben tener su correspondiente registro en `public.users`. La migración no modifica ni asigna automáticamente roles a usuarios anteriores. Los trabajadores se aprovisionan administrativamente en `user_roles` y `cafeteria_users`; el registro público nunca asigna WORKER, ADMIN ni SUPER_ADMIN. Una cuenta sin perfil o deshabilitada no obtiene acceso. Cada WORKER operativo debe tener exactamente una fila de asignación en `cafeteria_users`; una cafetería puede tener varios WORKER. Esta cardinalidad se comprueba en cada consulta de contexto y autorización de pedidos, sin introducir una migración de aprovisionamiento.

Después de `006`, aplicar **`007_auth_role_cardinality.sql`**. Mantiene `user_roles` y añade `uq_user_roles_user UNIQUE(user_id)`: ninguna cuenta, activa o inactiva, puede tener dos roles. Los constraint triggers `trg_users_auth_role_cardinality` y `trg_user_roles_auth_role_cardinality` son `DEFERRABLE INITIALLY DEFERRED`; al commit cada usuario activo debe tener exactamente un rol CLIENT, WORKER, ADMIN o SUPER_ADMIN. La migración aborta si encuentra datos incompatibles y no elige ni asigna roles automáticamente. Las migraciones históricas permanecen intactas. `setup_auth.sql` consolida 005–007, funciona después de 001–004 y puede repetirse después de 007.

El registro de estudiantes crea CLIENT y activa el perfil en la misma transacción. Una identidad no estudiantil empieza inactiva y sin rol, aunque sus metadatos soliciten privilegios. El aprovisionamiento administrativo debe insertar un único rol y activar el usuario; también puede hacerlo en una transacción que active primero y asigne después. Para revocar el último rol, desactivar el usuario en esa misma transacción o antes de eliminarlo. Para sustituir el rol de una cuenta activa, eliminar el anterior e insertar el nuevo dentro de una sola transacción. Una actualización que traslade la asignación a otro usuario valida ambos usuarios. La eliminación en cascada de una identidad sigue permitida. `TRUNCATE user_roles` se rechaza porque omite los triggers por fila; usar `DELETE`.

Los triggers inmediatos `trg_users_auth_role_lock` y `trg_user_roles_auth_role_lock` adquieren `pg_advisory_xact_lock` antes de las escrituras relevantes. La clave es `hashtextextended('unifood:auth-role-cardinality:' || user_id::text, 0)`, un entero firmado de 64 bits derivado del UUID completo con un namespace propio. No se trunca el UUID ni se usa un hash de 32 bits. Las claves distinguen usuarios incluso si comparten prefijo; no hay un lock global. Un hash finito admite colisiones, aproximadamente 2⁻⁶⁴ por pareja: una colisión solo introduce espera entre esos usuarios, nunca permite un estado inválido. Las claves se calculan en el mismo servidor y no se persisten; no se requiere estabilidad entre versiones mayores de PostgreSQL.

Cada cambio en `user_roles` también escribe `users.is_active = users.is_active` del mismo usuario, sin cambiar su actividad. Esto actualiza `users.updated_at` mediante su trigger existente y hace que escritores con snapshots antiguos en REPEATABLE READ/SERIALIZABLE aborten con 40001. Los locks duran hasta finalizar la transacción. No se cambia el aislamiento global ni se añade locking a pedidos. Las transacciones administrativas que afecten varios usuarios pueden requerir reintento completo ante 40001 o deadlock 40P01. La instalación de la migración toma locks de tabla temporalmente para impedir escrituras entre la auditoría y la creación de restricciones; las operaciones normales se serializan por usuario. Ver [locks de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html) y [aislamiento transaccional](https://www.postgresql.org/docs/current/transaction-iso.html).

## Correo y contraseñas en Supabase

En Authentication:

1. Activar el proveedor Email y **Confirm email**.
2. Configurar OTP de **6 dígitos**, con expiración y límites de frecuencia de Supabase habilitados.
3. En **Confirm signup** y **Reset password**, incluir `{{ .Token }}` en la plantilla. Este flujo utiliza códigos, no enlaces de redirección. Ejemplo de contenido: `<p>Tu código de UniFood es: <strong>{{ .Token }}</strong></p>`.
4. Configurar SMTP para entregar correos a estudiantes reales. El remitente de pruebas de Supabase tiene restricciones de destinatarios.
5. Configurar también en Supabase una longitud mínima de 8 caracteres, mayúscula, minúscula y número. La aplicación valida estas reglas, pero el proveedor debe aplicarlas también para impedir que se omitan llamando directamente a su API.
6. Configurar Site URL con la URL real del frontend. La aplicación no necesita una clave administrativa para enviar los correos.

El reenvío tiene una espera visual de 60 segundos; el límite efectivo y el control de intentos son responsabilidad de Supabase, también entre pestañas o instancias. La recuperación muestra un mensaje neutro para no revelar la existencia de una cuenta. Después de cambiar la contraseña se invalidan las sesiones de actualización con cierre global y se vuelve al login. Como ocurre con JWT, los access tokens ya emitidos pueden permanecer válidos hasta su vencimiento; configurar una vida corta en Supabase.

### Si el registro envía un enlace en lugar del código

El registro usa `signUp`, el reenvío usa `resend({ type: "signup" })` y la verificación acepta exactamente seis dígitos mediante `verifyOtp`. El contenido del correo se configura en el proyecto de Supabase: cambiar `.env.local` o reiniciar Next.js no sustituye la plantilla remota.

1. Abrir en el panel de Supabase el proyecto correspondiente a `SUPABASE_URL`.
2. En **Authentication → Email Templates** (o **Emails → Templates**), abrir **Confirm sign up**.
3. Usar el asunto `Verifica tu correo en UniFood` y reemplazar **todo** el cuerpo con el contenido de [`confirmation.html`](../../unifood-backend/supabase/templates/confirmation.html). La plantilla muestra `{{ .Token }}` y no contiene enlaces ni `{{ .ConfirmationURL }}`. Guardar los cambios. Editar únicamente **Magic Link** no cambia los correos de registro con contraseña.
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

Brand, logout y la navegación de AuthScreen reciben contexto explícito. La variante panel presenta una composición desktop y no ofrece registro estudiantil. La recuperación conserva su sesión temporal durante OTP/reset, no tiene redirección automática por una sesión válida ni admite returnTo arbitrario. Tras reset mantiene el login contextual en la misma pantalla y conserva el aviso de éxito; logout y los enlaces de retorno usan el login correspondiente. La comprobación del rol se repite al iniciar sesión.

Hallazgo pendiente fuera de esta fase: `InstitutionController` exige autenticación, pero sus consultas por dominio o ID no filtran por rol ni pertenencia institucional. La política de visibilidad de instituciones debe definirse antes de cambiar esos endpoints.

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

Las pruebas automatizadas de auth usan un proveedor simulado. La política de autorización tiene tests de aplicación sin MVC ni JDBC. Los tests HTTP backend usan los endpoints, guards, servicio y handlers reales con hechos simulados detrás del puerto; los tests directos del adaptador verifican el mapeo JDBC y los recursos SQL. Esos mismos recursos se ejecutan en PostgreSQL/PGlite con las migraciones reales para comprobar roles, asignaciones, inactividad y revocación, sin reproducir la política de permisos en JavaScript ni extraer SQL mediante regex. Para validar la integración real, configurar el proyecto y comprobar: registro con documento nuevo, correo real, código inválido/vencido, reenvío, confirmación, login, recarga, cierre de sesión, recuperación y rechazo del estudiante al acceder a `/worker` y `/api/orders`. Con un trabajador, comprobar acceso a su cafetería y rechazo a otra. No asumir que las pruebas locales verifican SMTP o la aplicación remota de las migraciones.

`npm test` también ejecuta las migraciones completas en PostgreSQL en memoria (PGlite). Comprueba los dos dominios, conservación del correo, coincidencia exacta, rechazo de subdominios/sufijos falsos, institución inactiva, rollback de registros inválidos y asignación exclusiva del rol CLIENT. La API de registro se prueba contra esa validación SQL real; el envío de correo de Supabase sigue simulado.

Los tests de cardinalidad PGlite comprueban commits, rollback, sustitución/revocación de roles, traslado de asignaciones, cascadas, datos históricos incompatibles y repetición de `setup_auth.sql`. Si PostgreSQL nativo está instalado (directorio de instalación en Windows o `pg_config` en PATH), `npm test` también levanta un clúster temporal independiente en loopback, sin variables ni datos del desarrollador. Dos conexiones reales prueban ambos órdenes de activación/eliminación en READ COMMITTED, REPEATABLE READ y SERIALIZABLE; observan la espera en `pg_locks` y comprueban el rechazo de la transacción incompatible. Otra prueba demuestra que dos usuarios distintos pueden escribir simultáneamente. Sin binarios nativos, ese test se marca explícitamente como omitido; PGlite siempre se ejecuta. El servidor temporal se detiene al terminar y se conservan sus logs para diagnóstico.

Playwright inicia Next.js en el puerto 3100 y un proveedor/backend de prueba en `127.0.0.1:3101`; usa Edge en Windows o Chromium en otros sistemas (`npx playwright install chromium` si falta). Las pruebas de formularios simulan las respuestas de `/api/auth`; las pruebas de roles usan login, páginas y BFF reales con sesiones del proveedor local de prueba, sin relajar guards. Se comprueba también el dashboard y la preparación de un pedido. Estos fixtures no sustituyen la comprobación de Spring y SQL. Las capturas se guardan en `test-results/`. Ejecutar las pruebas de navegador sin una sesión previamente iniciada.

Si ya está corriendo el servidor de desarrollo, probarlo sin levantar otra instancia: en PowerShell, `$env:PLAYWRIGHT_BASE_URL='http://localhost:3000'` y después `npm run test:e2e`. En ese modo externo se omiten los tests de roles que requieren el proveedor local controlado; para la validación completa ejecutar sin `PLAYWRIGHT_BASE_URL`.

Referencias: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [plantillas de correo](https://supabase.com/docs/guides/auth/auth-email-templates), [Spring JWT resource server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html).
