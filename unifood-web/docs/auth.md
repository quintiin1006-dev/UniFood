# Autenticación de UniFood

## Estructura

- `app/login`, `app/registro`, `app/recuperar-contrasena`: entradas públicas, con interfaz compartida en `features/auth/components`.
- `app/api/auth/[action]`: login, registro, dominio institucional, verificación, reenvío, recuperación y cierre de sesión. Comprueba el origen y valida los datos antes de contactar Supabase.
- `features/auth/server`: cliente Supabase exclusivamente en el servidor y consulta del usuario/perfil real. El navegador no recibe tokens por JSON ni los guarda en localStorage.
- `proxy.ts`: renueva la sesión antes de acceder al panel, cuenta y proxy de pedidos.
- `app/worker/page.tsx`: comprueba la sesión y los roles antes de renderizar `components/worker/WorkerDashboard.tsx`.
- `app/cuenta`: destino de estudiantes con cuenta verificada. El módulo de pedidos de estudiantes todavía no existe.
- Spring conserva los casos de uso y verifica JWT, usuario activo, rol y asignación a cafetería antes de cada lectura o mutación de pedidos.

## Configuración local

Copiar `.env.example` a `.env.local` y completar:

```dotenv
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-key-o-anon-key>
AUTH_USERNAME_DOMAIN=ustavillavo.edu.co
API_URL=http://localhost:8080
NEXT_PUBLIC_CAFETERIA_ID=<cafeteria-id>
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

Las cuentas existentes deben tener su correspondiente registro en `public.users`. La migración no modifica ni asigna automáticamente roles a usuarios anteriores. Los trabajadores se aprovisionan administrativamente en `user_roles` y `cafeteria_users`; el registro público nunca asigna WORKER, ADMIN ni SUPER_ADMIN. Una cuenta sin perfil o deshabilitada no obtiene acceso. Confirmar que la cafetería de `NEXT_PUBLIC_CAFETERIA_ID` coincide con la asignada al trabajador.

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

Los destinos son `/cuenta` para CLIENT, `/worker` para WORKER, `/admin` para ADMIN y `/super-admin` para SUPER_ADMIN. Los dos destinos administrativos son placeholders protegidos, sin funciones administrativas ni acceso al panel worker. En cuentas con varios roles, el destino da prioridad a SUPER_ADMIN, después ADMIN y después WORKER. Esta fase no impone un límite de cuentas WORKER por cafetería ni implementa el aprovisionamiento administrativo o la restricción de una única cafetería para ADMIN.

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

Las pruebas automatizadas de auth usan un proveedor simulado. Los tests HTTP backend usan los endpoints, guards y handlers reales con decisiones JDBC simuladas; la consulta SQL de producción de `OrderAuthorization` se ejecuta además en PostgreSQL en memoria para comprobar cada rol, asignaciones, inactividad, combinaciones administrativas con WORKER y revocación. Para validar la integración real, configurar el proyecto y comprobar: registro con documento nuevo, correo real, código inválido/vencido, reenvío, confirmación, login, recarga, cierre de sesión, recuperación y rechazo del estudiante al acceder a `/worker` y `/api/orders`. Con un trabajador, comprobar acceso a su cafetería y rechazo a otra. No asumir que las pruebas locales verifican SMTP o la aplicación remota de las migraciones.

`npm test` también ejecuta las migraciones completas en PostgreSQL en memoria (PGlite). Comprueba los dos dominios, conservación del correo, coincidencia exacta, rechazo de subdominios/sufijos falsos, institución inactiva, rollback de registros inválidos y asignación exclusiva del rol CLIENT. La API de registro se prueba contra esa validación SQL real; el envío de correo de Supabase sigue simulado.

Playwright inicia Next.js en el puerto 3100 y un proveedor/backend de prueba en `127.0.0.1:3101`; usa Edge en Windows o Chromium en otros sistemas (`npx playwright install chromium` si falta). Las pruebas de formularios simulan las respuestas de `/api/auth`; las pruebas de roles usan login, páginas y BFF reales con sesiones del proveedor local de prueba, sin relajar guards. Se comprueba también el dashboard y la preparación de un pedido. Estos fixtures no sustituyen la comprobación de Spring y SQL. Las capturas se guardan en `test-results/`. Ejecutar las pruebas de navegador sin una sesión previamente iniciada.

Si ya está corriendo el servidor de desarrollo, probarlo sin levantar otra instancia: en PowerShell, `$env:PLAYWRIGHT_BASE_URL='http://localhost:3000'` y después `npm run test:e2e`. En ese modo externo se omiten los tests de roles que requieren el proveedor local controlado; para la validación completa ejecutar sin `PLAYWRIGHT_BASE_URL`.

Referencias: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [plantillas de correo](https://supabase.com/docs/guides/auth/auth-email-templates), [Spring JWT resource server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html).
