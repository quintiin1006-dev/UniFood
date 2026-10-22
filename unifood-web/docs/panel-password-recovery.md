# Recuperación de contraseña del panel

## Alcance y rutas

WORKER, ADMIN y SUPER_ADMIN solicitan recuperación desde `/panel/recuperar`,
enlazada desde `/panel/login`. La ruta antigua
`/recuperar-contrasena?entrypoint=panel` redirige a esa pantalla y descarta destinos
arbitrarios. CLIENT mantiene su recuperación OTP existente.

El correo contiene un enlace Supabase que termina en
`/panel/nueva-contrasena?code=…`. La pantalla intercambia el código y elimina query
y fragmento del historial antes de mostrar el formulario. Tras actualizar y cerrar
las sesiones, vuelve a `/panel/login?password=updated`. Ese parámetro solo muestra
un aviso de éxito; nunca habilita recuperación ni concede acceso.

## Autoridad y seguridad

```text
Browser → Supabase Auth
```

Se usa `@supabase/supabase-js` con `flowType: 'pkce'`, `resetPasswordForEmail`,
`exchangeCodeForSession`, el evento público `PASSWORD_RECOVERY`, `getUser` y
`updateUser`. No hay endpoint Spring, consulta business, resolución de rol ni
service role en el navegador. La configuración enviada a los componentes acepta
únicamente una clave publishable o una clave legacy cuyo rol sea anon.

El `redirectTo` se construye con el origen real de la página y el path fijo
`/panel/nueva-contrasena`. No procede de `returnTo`, email, rol ni query del usuario.
El SDK vincula el código al verificador PKCE que originó la solicitud. La aplicación
exige el evento de recuperación del SDK y una identidad verificada coincidente;
un evento `SIGNED_IN` o una sesión normal no habilitan el formulario. Antes de
actualizar se vuelve a verificar la identidad con Supabase.

El cliente de recuperación tiene almacenamiento separado del login HttpOnly.
Solo los verificadores PKCE del SDK se guardan en localStorage para permitir abrir
el correo en otra pestaña del mismo navegador/origen. Los access/refresh tokens
temporales permanecen en memoria. No se escriben cookies de login ni se envían
tokens temporales a Spring.

El formulario validado debe completarse en la pestaña actual: recargarla después
de consumir el código pierde el estado en memoria y requiere un enlace nuevo.
Abrir el enlace en otro navegador, otro origen o un dispositivo distinto tampoco
dispone del verificador. Estos casos fallan de forma segura, con acceso para
solicitar otro enlace. No se aceptan tokens arbitrarios en fragmentos como fallback.

El password se envía únicamente a Supabase Auth, fuera de URLs, logs y snapshots.
Las reglas locales son las existentes: 8–128 caracteres, mayúscula, minúscula y
número. Supabase mantiene la validación final, incluidas políticas más estrictas.
Los errores `weak_password` y `same_password` se traducen a mensajes seguros.

Después de actualizar se intenta signOut global del cliente de recuperación y se
utiliza `POST /api/auth/logout` existente para limpiar la sesión normal y remember.
Si falla la finalización, el reintento solo repite esa limpieza; no reenvía el
password. Las acciones OTP/reset antiguas con `entrypoint: panel` se rechazan antes
de llamar a Auth. Las acciones CLIENT y los logins por rol conservan su contrato.

## Solicitud y errores

Un email válido recibe una respuesta neutral sobre instrucciones, sin consultar
si existe o cuál es su rol. Los rechazos 4xx específicos de cuenta también se
normalizan, salvo rate limit. Nunca se muestran mensajes raw del proveedor.
Rate limit y fallos temporales tienen mensajes neutrales y recuperables. Los
enlaces vencidos, inválidos o reutilizados no muestran campos de contraseña.

El estado inicial de formulario es determinista durante SSR e hidratación, usando
el mismo guard de hidratación del login. El envío tiene bloqueo inmediato contra
doble submit. Los errores son accesibles y reciben foco; los campos conservan
autocompletado semántico y mostrar/ocultar contraseña.

## Configuración manual de Supabase

No se modifica ninguna configuración remota desde esta feature.

1. En **Authentication → URL Configuration → Redirect URLs**, agregar exactamente
   `http://localhost:3000/panel/nueva-contrasena` para el inicio local habitual.
2. Si se utiliza `127.0.0.1` en lugar de localhost, agregar además
   `http://127.0.0.1:3000/panel/nueva-contrasena`. Cada origen necesita su propia
   autorización y almacenamiento PKCE. Para LAN se autoriza el origen real que
   se vaya a utilizar, sin inventar una IP ni usar comodines amplios.
3. Site URL debe apuntar al origen real de la aplicación. Para un proyecto dedicado
   a pruebas locales puede ser `http://localhost:3000`. No cambiar el Site URL de
   un proyecto productivo por localhost; este flujo proporciona un redirect explícito.
4. En producción, autorizar la URL HTTPS real terminada en
   `/panel/nueva-contrasena`; este repositorio no define un dominio productivo.
5. Revisar **Authentication → Email Templates → Reset Password**. El enlace debe
   usar `{{ .ConfirmationURL }}`. No hace falta cambiarlo si ya lo contiene. Si la
   plantilla actual solo muestra `{{ .Token }}`, añadir el enlace y conservar el
   código para la recuperación CLIENT existente. La plantilla remota no puede
   inspeccionarse con la clave pública; debe comprobarse en Dashboard.

Contenido compatible con ambos accesos:

```html
<h2>Restablece tu contraseña de UniFood</h2>
<p><a href="{{ .ConfirmationURL }}">Restablecer contraseña</a></p>
<p>Si solicitaste la recuperación desde el acceso de estudiantes,
   introduce este código en la pantalla de recuperación: {{ .Token }}</p>
<p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
```

No sustituir ConfirmationURL por un link arbitrario con email, ni por TokenHash
sin implementar un callback distinto. Confirm signup y otras plantillas no cambian.
Desactivar tracking que reescriba enlaces del proveedor SMTP.

El SMTP predeterminado de Supabase solo sirve para pruebas limitadas con correos
autorizados del equipo y tiene cuotas reducidas; no garantiza entrega productiva.
Para usuarios reales se necesita SMTP personalizado, remitente/dominio verificado,
configuración DNS del proveedor, cuotas apropiadas y revisión de Auth logs. El SMTP
y las plantillas actuales del proyecto no se deducen de `.env.local` ni de un 502.

## Diagnóstico del flujo anterior

El flujo anterior enviaba `POST /api/auth/recover`, llamaba a
`resetPasswordForEmail(email)` en servidor sin redirectTo y mostraba OTP de seis
dígitos. Solo era compatible con una plantilla Reset Password que mostrara Token;
no existía un callback de enlace/PKCE. Por tanto, no completaba el flujo por enlace
solicitado y dependía de la plantilla remota.

El 502 observado en esa petición se producía por un error reintentable/5xx del
proveedor o por un fallo de comunicación capturado por la ruta. Es distinto del
desajuste de callback: faltar el callback no explica por sí solo que falle el envío.
Para determinar si el rechazo remoto concreto fue SMTP u otra dependencia hacen
falta el código upstream o Auth logs. El código genérico no permite afirmarlo.

## Pruebas y límites de verificación

Las pruebas unitarias cubren autoridad, anti-enumeración, sanitización, SSR,
finalización y ausencia de reenvío de contraseña. Los E2E usan el SDK instalado y
un proveedor loopback que comprueba S256 contra el verificador real, consume cada
código una vez y simula expiración y errores. No reciben emails externos ni prueban
el SMTP o las plantillas remotas. Se comprueba el login posterior de los tres roles,
CLIENT, logout, responsive y regresión de hidratación.
La suite de recuperación desactiva traces, video y capturas automáticas de fallo
para no retener credenciales sintéticas en requests/DOM; sus capturas visuales
explícitas se toman con los campos de contraseña vacíos.

Referencias: [resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail),
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[plantillas](https://supabase.com/docs/guides/auth/auth-email-templates) y
[SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
