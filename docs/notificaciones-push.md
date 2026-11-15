# Notificaciones push (Web Push)

Avisos al teléfono con la app cerrada, mediante Web Push (PWA + VAPID). Se suman al aviso
dentro de la app (§7 de `docs/decisiones.md`), que sigue siendo el canal principal: si el push
falla, no está configurado o el navegador no lo admite, el cliente y el worker siguen viendo
el aviso en pantalla.

## Eventos

| Evento                            | Destinatario                    | Título                                   | TTL / urgencia |
| --------------------------------- | ------------------------------- | ---------------------------------------- | -------------- |
| Pedido nuevo (PENDING)            | Workers activos de la cafetería | «Nuevo pedido #A41B2C3D»                 | corto / alta   |
| PREPARING                         | Cliente del pedido              | «Tu pedido está en preparación»          | normal         |
| READY                             | Cliente del pedido              | «¡Tu pedido está listo!»                 | corto / alta   |
| CALLED                            | Cliente del pedido              | «Te están llamando, pasa a recoger»      | corto / alta   |
| Recordatorio (1, 2 y 3)           | Cliente del pedido              | «Recuerda recoger tu pedido»             | corto / alta   |
| Rechazado por la cafetería        | Cliente del pedido              | «La cafetería no pudo aceptar tu pedido» | normal         |
| NOT_COLLECTED (acción del worker) | Cliente del pedido              | «Tu pedido no fue recogido»              | normal         |

**No envían push** (decisión del 2026-11-15): la cancelación hecha por el propio cliente y el
cierre diario automático (`DailyCloseService`), para no avisar de madrugada por pedidos de
otro día. La referencia `#A41B2C3D` son los 8 primeros caracteres del id del pedido, la misma
que el cliente ve en la confirmación; es provisional hasta que exista un código corto.

El payload es mínimo y sin datos personales: `title`, `body`, `tag` (uno por pedido, de modo que
el aviso nuevo reemplaza al anterior en lugar de apilarse) y `url` (`/cuenta/pedido` o
`/worker`). Nunca incluye nombre, productos, total ni el motivo del rechazo.

## Arquitectura

- `PushNotificationPort` (`domain/port/out`) recibe un `OrderPushEvent` con identificadores.
  `OrderService` y `ClientOrderCreationService` lo publican después de guardar.
- `PushNotificationDispatcher` lo registra para **después del commit** (un rollback no envía
  nada) y lo entrega en un executor acotado: 2 hilos y cola de 500. Si la cola se llena, el
  aviso se descarta con una línea de log. Nunca lanza excepciones ni bloquea la transacción.
  Además, los servicios capturan cualquier excepción del puerto.
- Destinatarios, resueltos de la base al enviar:
  - El cliente del pedido, si su cuenta está activa.
  - Los workers activos, exclusivos y todavía asignados a la cafetería del pedido.
- Canales: `PushChannelSender` con un adaptador por canal. Hoy solo existe
  `WebPushChannelSender` (`WEB_PUSH`). Un adaptador `FCM` para una futura app nativa se
  registra igual y usa la misma tabla (`channel = 'FCM'`, token en `endpoint`, sin `p256dh` ni
  `auth`), así que no necesita otra migración de estructura.
- Errores del servicio de push:

| Respuesta             | Qué hace UniFood                                  |
| --------------------- | ------------------------------------------------- |
| 404 / 410             | Marca la suscripción con `revoked_at`             |
| 429, 5xx o timeout    | Hasta 2 reintentos, con espera de 1 s y luego 2 s |
| Cualquier otro código | Se registra en el log y no se reintenta           |

- Seguridad del envío:
  - Solo se envía a los servicios de push de los navegadores admitidos: `fcm.googleapis.com`,
    Mozilla, Apple (`*.push.apple.com`) y WNS (`*.notify.windows.com`), siempre por HTTPS y
    puerto 443.
  - La lista se comprueba al registrar y otra vez antes de cada envío.
  - Nunca se siguen redirecciones.

### Librería

Se usa `com.zerodeplibs:zerodep-web-push-java:2.1.5`. Evidencia recogida el 2026-11-15:

| Criterio                 | Dato                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fecha de publicación     | 31-12-2025 en Maven Central                                                                                                                      |
| Historial                | 2.0.1 → 2.1.5                                                                                                                                    |
| Licencia                 | MIT                                                                                                                                              |
| Compatibilidad           | Bytecode Java 11 (major 55), `Java-Version: 11`; funciona en Java 21                                                                             |
| Dependencias             | Ninguna de compilación; okhttp, httpclient5, jetty y vert.x son `optional`                                                                       |
| Encaje con Spring Boot 4 | Usa `java.net.http.HttpClient`; no añade nada al classpath de Spring                                                                             |
| Protocolo                | RFC 8291 (`Aes128GcmMessageEncryption`, `Content-Encoding: aes128gcm`) y VAPID ES256 integrado (`DefaultVAPIDJWTGenerator`), sin extensiones JWT |
| sha1 del jar             | `02fa1d9e72a281c25eac128b3a7a0633cc0d1395` (coincide con el `.sha1` de Central)                                                                  |
| sha256 del jar           | `1337acba24004f2a702275b676eb3862e402c8775d3031b26464f0b18d3ba989` (coincide con el `.sha256` de Central)                                        |
| Firma                    | `.asc` PGP publicado                                                                                                                             |

Descartadas:

- `nl.martijndwars:web-push` 5.1.2: depende de BouncyCastle y de Apache HttpAsyncClient 4.
- `com.interaso:webpush`: arrastra el runtime de Kotlin.

## Base de datos: migración 027

`push_subscriptions` tiene una fila por navegador o dispositivo, con `endpoint` único:

- RLS activado y sin privilegios para `anon`, `authenticated` ni `service_role`. Solo el
  backend la lee.
- CHECKs de canal, rol (un worker siempre lleva cafetería y un cliente nunca), formato y
  longitud del endpoint, formato de las claves y fechas.
- Idempotente y en transacción, con la reversa comentada al final.
- Se aplica con `scripts/supabase/apply-migrations.ps1`: primero en una base temporal local,
  después en `unifood-staging` y nunca directamente en el proyecto real.

## API

| Método y ruta                                                        | Uso                                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/me/push/public-key`, `GET /api/worker/push/public-key`     | Clave pública VAPID; 503 `PUSH_DISABLED` si no está configurada                   |
| `POST /api/me/push/subscribe`                                        | Cliente: `{endpoint, keys: {p256dh, auth}, userAgent}`                            |
| `POST /api/worker/push/subscribe`                                    | Worker: el mismo cuerpo; la cafetería sale de la base                             |
| `DELETE /api/me/push/subscribe`, `DELETE /api/worker/push/subscribe` | `{endpoint}` o `{subscriptionId}`; responde siempre 204 y solo toca filas propias |

- El usuario sale siempre del token. Se ignora cualquier `userId` del cuerpo y los claims de
  rol o cafetería del JWT.
- Registrar de nuevo el mismo endpoint lo reactiva. Si ese endpoint pertenecía a otra cuenta
  del mismo navegador, pasa a la cuenta actual.
- Límites:
  - Como máximo 5 dispositivos activos por usuario; el sexto revoca el de uso más antiguo.
  - Como máximo 10 altas o bajas por usuario y minuto; al pasarse, 429 `PUSH_RATE_LIMITED`
    con `Retry-After: 60`.
  - Como máximo 20 avisos por usuario cada 10 minutos.
  - Un solo aviso por pedido, evento y número de recordatorio en una ventana de 6 horas.
- Cierre de sesión: la web llama a `DELETE` con el endpoint antes de salir y anula la
  suscripción del navegador. El BFF lo refuerza en servidor revocando el `subscriptionId`
  guardado en una cookie httpOnly, de modo que un navegador compartido no reciba avisos de la
  cuenta anterior.

## Varias instancias del backend (limitación conocida)

La deduplicación y los límites de envío viven **en la memoria de cada instancia**. Con una
sola instancia funcionan como se describe arriba. Con varias:

- La misma transición ocurre una sola vez (la confirma una sola transacción), así que en la
  práctica cada aviso sale de una sola instancia. El riesgo aparece solo si un reintento del
  mismo evento llega a otra instancia.
- Aun así, un duplicado no se apila en el teléfono: el `tag` por pedido reemplaza la
  notificación anterior y el `Topic` hace que el servicio de push sustituya la que aún no se
  ha entregado.
- El límite de 20 avisos por usuario y el de 10 altas o bajas por minuto se multiplican por el
  número de instancias.

Si se despliegan varias instancias, la solución es mover la deduplicación y los límites a la
base de datos (por ejemplo, una tabla `push_deliveries` con clave única por evento) o a un
almacén compartido. Hoy no se necesita.

## Variables de entorno (backend)

| Variable                   | Valor                                                               | Por defecto             |
| -------------------------- | ------------------------------------------------------------------- | ----------------------- |
| `VAPID_PUBLIC_KEY`         | Clave pública base64url (65 bytes sin comprimir)                    | vacía: push desactivado |
| `VAPID_PRIVATE_KEY`        | Clave privada base64url (32 bytes). **Secreta**, solo en el backend | vacía                   |
| `VAPID_SUBJECT`            | `mailto:...` o `https://...`                                        | vacía                   |
| `PUSH_URGENT_TTL_SECONDS`  | TTL de READY, CALLED, recordatorios y pedido nuevo (60–3600)        | 900 (15 min)            |
| `PUSH_DEFAULT_TTL_SECONDS` | TTL del resto (60–86400)                                            | 3600                    |
| `PUSH_URGENT_URGENCY`      | `very-low`, `low`, `normal` o `high`                                | `high`                  |
| `PUSH_DEFAULT_URGENCY`     | Igual                                                               | `normal`                |
| `SERVER_PORT`              | Puerto local del backend (opcional)                                 | 8080                    |

Para READY y CALLED se recomienda un TTL de entre 10 y 30 minutos: un aviso que llega tarde ya
no sirve.

Si falta alguna de las tres variables VAPID, o no son válidas (por ejemplo, la pública no
corresponde a la privada), el backend arranca igual y escribe una sola línea en el log:
`Push notifications disabled: VAPID configuration <MOTIVO>`. La clave privada nunca aparece en
los logs, y los endpoints se registran truncados a su host (`https://fcm.googleapis.com/...`).
Hay pruebas que lo comprueban (`WebPushChannelSenderTest` y `PushConfigurationTest`).

### Generar las claves VAPID

Lo hace la persona responsable del entorno, nunca un agente, y las claves no se versionan:

```sh
npx web-push generate-vapid-keys
```

- Copia `Public Key` en `VAPID_PUBLIC_KEY` y `Private Key` en `VAPID_PRIVATE_KEY` del entorno
  del backend (el `.env` local o las variables de Render).
- Usa un par distinto por entorno (local, staging y producción).
- Si cambias el par, todas las suscripciones existentes dejan de funcionar. El servicio de push
  responderá 403 o 410, y cada navegador se suscribirá de nuevo la próxima vez que abra la app.

## Probar con un teléfono real

1. **HTTPS obligatorio.** Los service workers y Web Push solo funcionan en `https://` o en
   `localhost`. El teléfono no puede usar el `localhost` del portátil, así que hace falta
   `unifood-staging` con HTTPS o un túnel HTTPS hacia el puerto de la web (por ejemplo,
   `cloudflared tunnel --url http://localhost:3400`). El túnel lo crea la persona responsable,
   no un agente.
2. Configura las tres variables VAPID en el backend y reinícialo. En el log debe aparecer
   `Push notifications enabled (Web Push)`.
3. Construye y arranca la web en modo producción (`npm run build` y `npm run start`).
   `next dev` no sirve para probar el service worker.
4. **Android (Chrome):**
   1. Abre la URL HTTPS e inicia sesión como cliente.
   2. Haz un pedido y pulsa «Activar avisos» en la tarjeta o en Perfil.
   3. Acepta el permiso.
   4. Cierra Chrome y cambia el estado del pedido desde el panel del worker. El aviso debe
      llegar con la app cerrada.
5. **iPhone (iOS 16.4 o superior):** Safari no permite push en una pestaña normal; hay que
   instalar la app.
   1. Abre la URL en **Safari**.
   2. Toca **Compartir** y luego **Agregar a pantalla de inicio**.
   3. Abre UniFood **desde el ícono** de la pantalla de inicio, no desde Safari.
   4. Inicia sesión y activa los avisos. El permiso solo aparece tras tocar el botón.
   5. Comprueba que los avisos llegan con la app cerrada.

   En iOS 16.3 o anterior no hay Web Push: la app muestra un mensaje breve y conserva el aviso
   dentro de la app.

6. **Worker:** activa el interruptor del panel y crea un pedido desde otro dispositivo. Debe
   llegar «Nuevo pedido #…».
7. **Cierre de sesión:** cierra sesión y cambia el estado de un pedido de esa cuenta. Ese
   navegador no debe recibir nada.

Si el permiso quedó denegado, hay que reactivarlo en los ajustes del navegador o del sistema:

- **Android:** ajustes del sitio en Chrome.
- **iPhone:** Ajustes › Notificaciones › UniFood.

## Qué no se verifica sin un teléfono real

Las pruebas automáticas usan un servicio de push simulado. No comprueban:

- La entrega real a través de FCM, Mozilla o Apple.
- La aparición de la notificación con la app cerrada, ni la vibración.
- El comportamiento de iOS instalado como PWA.
- La re-suscripción después de que el navegador rote o anule la suscripción.
