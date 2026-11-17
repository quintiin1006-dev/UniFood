# Despliegue de staging de UniFood

Guía para quien tenga las cuentas de Render, Vercel y Supabase (staging) y vaya a publicar el entorno de pruebas con teléfonos reales.

Este documento no contiene valores reales. Cada valor se introduce en el panel del proveedor. El repositorio es público: **ningún secreto, contraseña, clave ni URL de proyecto de staging se versiona**.

## 0. Antes de empezar: estado del repositorio y bloqueos

| Tema | Estado en `develop` | Consecuencia |
| --- | --- | --- |
| Despliegue de backend y web | Listo con este PR. | Se puede publicar staging sin tocar código. |
| **Notificaciones push** | **No están en `develop`.** Están en la rama `jj/notificaciones-push` (backend, rutas BFF y migración `027_push_subscriptions.sql`). | Staging desplegado desde `develop` **no puede probar push**. Hasta mezclar esa rama (decisión del equipo) no hay push que probar. |
| **PWA (manifest, service worker)** | No encontrado en `develop` ni en `jj/notificaciones-push`. | La instalación «agregar a pantalla de inicio» funciona en iOS, pero no hay manifest propio ni modo app. Sin service worker no hay push web. |
| Variables de push (`VAPID_*`) | Sin uso en `develop`. | Se listan en la tabla de variables marcadas como pendientes. |

Antes de la prueba de push hay que decidir si se integra `jj/notificaciones-push` en staging, aplicar su migración en el proyecto **staging** y generar las claves VAPID (sección 6).

## 1. Arquitectura

```
Navegador / PWA ──HTTPS──► Vercel (unifood-web, Next.js, BFF)
                               │  API_URL (HTTPS)
                               ▼
                         Render (unifood-backend, Docker, Oregón)
                               │  pooler IPv4 (puerto 5432)      │ JWT (issuer)
                               ▼                                 ▼
                    Supabase STAGING: Postgres, Auth, Storage ◄──┘
```

- El navegador **nunca** llama al backend directamente: todo pasa por el BFF de Next.js en Vercel. Por eso el backend no necesita CORS para el navegador.
- Render usa IPv4. La conexión a Postgres va por el **pooler** de Supabase (`aws-1-us-west-2.pooler.supabase.com:5432`), no por el host directo `db.<ref>.supabase.co`, que es IPv6.
- Regiones: Render en **Oregón**; Vercel con funciones en **pdx1** (Portland, Oregón), configurado en `unifood-web/vercel.json`.
- Supabase staging debe ser un proyecto distinto del real. El backend se niega a arrancar con el perfil `staging` si la base no pertenece al proyecto indicado (sección 3).

## 2. Backend en Render

### 2.1 Crear el servicio

Opción recomendada: **Blueprint** desde `render.yaml` en la raíz del repositorio.

1. En Render: *New → Blueprint*, conectar el repositorio `quintiin1006-dev/UniFood` y elegir la rama `develop`.
2. Revisar la vista previa del Blueprint. Render mostrará las variables con `sync: false` pidiendo valor.
3. Completar las variables de la sección 4 y crear el servicio.

Opción manual, si el Blueprint no es válido en la vista previa:

- *New → Web Service*, repositorio `UniFood`, rama `develop`.
- **Runtime:** Docker.
- **Región:** Oregon (US West).
- **Root Directory:** vacío (la raíz del repositorio).
- **Dockerfile Path:** `./unifood-backend/Dockerfile`.
- **Docker Build Context:** `./unifood-backend`.
- **Health Check Path:** `/actuator/health`.
- **Auto-Deploy:** Yes, en la rama `develop`.

### 2.2 Comandos de build y de arranque

No hay comandos de Render separados: la imagen Docker define ambos.

- **Build** (dentro del `Dockerfile`, etapa 1): `./mvnw -B -DskipTests package`, con JDK 21. Compila y empaqueta el JAR. Los tests no se ejecutan en el despliegue: los corre la CI.
- **Arranque** (`ENTRYPOINT` del `Dockerfile`):
  `java -XX:MaxRAMPercentage=70 -XX:+UseSerialGC -XX:+ExitOnOutOfMemoryError -jar /app/app.jar`
- El proceso escucha en `$PORT`, que Render inyecta (`server.port=${PORT:8080}`).
- **Ruta de salud:** `/actuator/health`. Responde `{"status":"UP"}` sin detalles (`show-details=never`).

### 2.3 Plan e instancia

- **El plan gratuito se duerme** tras unos 15 minutos sin tráfico. La primera petición tarda más de un minuto mientras arranca el JVM, y el cierre diario y las notificaciones push no se ejecutan mientras está dormido. **No es válido para probar con teléfonos reales.**
- **Plan recomendado:** de pago (*Starter*) para evitar el sueño. Revisar el precio actual en la página de precios de Render; no está verificado aquí.
- **Memoria:** el JVM usa como máximo el 70 % del límite del contenedor (`MaxRAMPercentage=70`), GC serial y salida ante `OutOfMemoryError` para que Render lo reinicie. Con 512 MB el margen es estrecho (heap, metaspace y hilos de Spring Boot y Hikari). Si aparecen reinicios por memoria en los logs, subir a una instancia con 2 GB.
- **Instancias:** una sola. El cierre diario y el reparto de trabajos no están pensados para varias réplicas a la vez.

### 2.4 Cómo se valida el backend al arrancar

- Con `SPRING_PROFILES_ACTIVE=staging`, `UNIFOOD_EXPECTED_PROJECT_REF` es obligatoria. Si la base (`SUPABASE_DB_URL`, `SPRING_DATASOURCE_URL` o el usuario `postgres.<ref>`) no coincide, el proceso sale con `UniFood: el perfil staging no arranca: ...` en los logs. Ningún valor se imprime.
- Esa regla se prueba en `StagingProjectGuardTest` (CI y local). No se prueba levantando el servicio con otro proyecto.

## 3. Web en Vercel

1. *Add New → Project*, importar `quintiin1006-dev/UniFood`.
2. **Root Directory:** `unifood-web`. Framework: Next.js (detectado automáticamente).
3. **Production Branch:** `develop` (*Settings → Git*). Para este entorno, «production» de Vercel significa **staging**; el proyecto real de Supabase no debe aparecer aquí.
4. **Node.js:** 24, igual que `.nvmrc`.
5. **Build Command:** `npm run build` (valor por defecto). Este build valida la configuración y falla sin variables.
6. **Región de funciones:** `pdx1` desde `unifood-web/vercel.json`. Confirmar en *Settings → Functions* que aparece esa región.
7. Variables de entorno (sección 4). Cargarlas en el entorno **Production**. Si se quieren previews de otras ramas, cargarlas también en Preview con los mismos valores de staging; si no, el build de preview fallará, y ese fallo es intencionado.

Nunca definir `NODE_ENV`: Vercel lo fija a `production`, lo que activa cookies `Secure` (sección 7).

## 4. Variables de entorno

Leyenda: **S** = secreta (marcar como *Sensitive* en Vercel o usar `sync: false` en Render); **No** = identificador o configuración no secreta, pero específica del entorno, por eso no se versiona. Todas se introducen en el panel.

### 4.1 Backend (Render, servicio `unifood-backend-staging`)

| Variable | Qué es | De dónde sale | Secreta | Servicio |
| --- | --- | --- | --- | --- |
| `SPRING_PROFILES_ACTIVE` | Perfil. Con `staging` activa la guarda de proyecto. | Valor fijo: `staging`. | No | Render |
| `UNIFOOD_EXPECTED_PROJECT_REF` | Referencia del proyecto Supabase **staging** que debe usar la base. | Supabase staging → *Project Settings → General → Reference ID*. | No (no publicar) | Render |
| `SUPABASE_DB_URL` | URL JDBC del pooler de Postgres, sin usuario ni contraseña. | `jdbc:postgresql://aws-1-us-west-2.pooler.supabase.com:5432/postgres`, según *Connect* del proyecto staging. | **S** | Render |
| `SPRING_DATASOURCE_USERNAME` | Usuario de la base, formato `postgres.<ref>` (el `<ref>` debe coincidir con la guarda). | Supabase staging → *Connect*. | **S** | Render |
| `SPRING_DATASOURCE_PASSWORD` | Contraseña de la base staging. | Supabase staging → *Database settings* (restablecer si hace falta). | **S** | Render |
| `SUPABASE_AUTH_ISSUER` | Issuer de los JWT de Auth: `https://<ref>.supabase.co/auth/v1`. Spring valida firma y audiencia `authenticated`. | URL del proyecto staging + `/auth/v1`. | No | Render |
| `SUPABASE_STORAGE_URL` | URL de Storage: `https://<ref>.supabase.co/storage/v1`. | Supabase staging → *API*. | No | Render |
| `SUPABASE_STORAGE_SECRET_KEY` | Clave secreta para subir imágenes de producto. **Solo backend.** | Supabase staging → *API keys* (clave secreta de servicio). | **S** | Render |
| `SUPABASE_PRODUCT_IMAGES_BUCKET` | Bucket de imágenes. | `product-images`. | No | Render |
| `PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS` | Timeout de conexión a Storage. | `5`. | No | Render |
| `PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS` | Timeout por operación de Storage. | `20`. | No | Render |
| `PRODUCT_IMAGES_CLEANUP_ENABLED` | Limpieza de imágenes huérfanas. | `false` en la primera puesta en marcha (indicación de `.env.example`). | No | Render |
| `DAILY_CLOSE_ENABLED` | Cierre diario automático. Opcional. | Por defecto `true`. | No | Render |
| `DAILY_CLOSE_INTERVAL` | Intervalo del cierre. Opcional. | Por defecto `PT1H`. | No | Render |
| `VAPID_PUBLIC_KEY` | Clave pública Web Push. **Pendiente de `jj/notificaciones-push`.** | `npx web-push generate-vapid-keys` (sección 6). | No | Render |
| `VAPID_PRIVATE_KEY` | Clave privada Web Push. **Pendiente de `jj/notificaciones-push`.** | Misma generación. | **S** | Render |
| `VAPID_SUBJECT` | Contacto VAPID: `mailto:` o `https://`. Usar una dirección de equipo, no personal. **Pendiente de la rama de push.** | Dirección de contacto del equipo. | No | Render |
| `PUSH_URGENT_TTL_SECONDS`, `PUSH_DEFAULT_TTL_SECONDS`, `PUSH_URGENT_URGENCY`, `PUSH_DEFAULT_URGENCY` | Caducidad y urgencia de los avisos push. **Pendientes de la rama de push;** valores en su `.env.example` y `docs/notificaciones-push.md`. | Documentación de esa rama. | No | Render |
| `PORT` | Puerto de escucha. **No configurar:** Render lo inyecta. | Render. | No | Render |

No usar `SERVER_PORT` en Render (el backend lee `PORT`). `SPRING_DATASOURCE_URL` no se define: si existe, la guarda también la valida.

### 4.2 Web (Vercel, proyecto `unifood-web`)

| Variable | Qué es | De dónde sale | Secreta | Servicio |
| --- | --- | --- | --- | --- |
| `API_URL` | URL pública HTTPS del backend, sin barra final. El BFF la usa en el servidor. **Nunca `NEXT_PUBLIC_API_URL`.** | URL del servicio en Render (`https://<servicio>.onrender.com`). | No (server-only) | Vercel |
| `SUPABASE_URL` | URL del proyecto Supabase staging. | Supabase staging → *API*: `https://<ref>.supabase.co`. | No | Vercel |
| `SUPABASE_PUBLISHABLE_KEY` | Clave **publicable** (`sb_publishable_…` o JWT anon). **Nunca la clave secreta ni `service_role`.** | Supabase staging → *API keys*. | No (pública, pero server-only por decisión del proyecto) | Vercel |
| `AUTH_USERNAME_DOMAIN` | Dominio institucional para usuarios cortos. | `ustavillavo.edu.co`. | No | Vercel |

`API_URL`, `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` son obligatorias al construir y al arrancar; `next build` falla si faltan (`config/environment.ts`). No hay variables `NEXT_PUBLIC_*`.

### 4.3 Sin variable: Supabase y Resend

- **Correo (Resend):** se configura en Supabase staging → *Authentication → Emails → SMTP Settings*, no en el repositorio. Servidor SMTP y remitente según la documentación de Resend (dominio verificado). La contraseña SMTP es la clave de API de Resend: **secreta**, solo en Supabase. Documentado en `unifood-web/docs/auth.md` (sección de correo).
- **Clave del servicio de Supabase** (`service_role`): la web no la usa ni debe tenerla. El backend usa la clave secreta de Storage, distinta.

## 5. Supabase staging: URLs y autenticación

En *Authentication → URL Configuration* del proyecto **staging**:

1. **Site URL:** `https://<dominio-vercel>` (el dominio de producción de Vercel del proyecto, sin barra final).
2. **Redirect URLs:** añadir `https://<dominio-vercel>/**`. Se usan en la recuperación de contraseña (`window.location.origin` en `features/panel-recovery`) y en el flujo de correo. Si se usan previews, añadir su patrón de dominio, o no añadirlos.
3. Quitar `localhost` de la lista en staging, salvo que se quiera probar en local contra este proyecto (no recomendado).
4. Plantillas de correo: seguir `unifood-backend/supabase/templates/README.md` (código de 6 dígitos en el asunto y cuerpo con `{{ .Token }}`). Sin plantilla, la verificación del registro no funciona como espera la app.
5. SMTP propio (Resend) antes de invitar a estudiantes. El remitente de prueba de Supabase tiene límites de destinatarios.
6. Verificar que el proyecto staging no comparte ningún ajuste con el real (`unifood-web/docs/auth.md`, sección de correo).

## 6. Claves VAPID (solo cuando se integre push)

Las claves las genera **la persona responsable del entorno**, no un agente ni el repositorio:

```sh
npx web-push generate-vapid-keys
```

- Copiar `Public Key` en `VAPID_PUBLIC_KEY` y `Private Key` en `VAPID_PRIVATE_KEY`, en Render.
- Un par distinto por entorno. Nunca reutilizar el par de producción.
- Guardar la clave privada en el gestor de contraseñas del equipo. No escribirla en archivos del repositorio ni en el chat.
- Rotar la clave invalida todas las suscripciones: los teléfonos deberán volver a activar las notificaciones.
- `VAPID_SUBJECT` identifica al equipo ante los servicios de push. Usar una dirección del equipo.

## 7. Cookies y sesión en HTTPS

Verificado leyendo el código (no hay cambios necesarios):

- `features/auth/server/config.ts` → `sessionCookieOptions`: `httpOnly: true`, `secure: NODE_ENV === "production"`, `sameSite: "lax"`, `path: "/"`, sin atributo `Domain` (cookie *host-only*).
- En Vercel `NODE_ENV` es `production`, así que las cookies llevan `Secure` y solo viajan por HTTPS. Vercel sirve HTTPS.
- El nombre de la cookie de sesión es `sb-<ref>-auth-token`, donde `<ref>` sale de `SUPABASE_URL`. Cambiar de proyecto de Supabase cierra las sesiones existentes.
- Las cookies son por host. Un dominio de Vercel distinto (preview, dominio propio) pide iniciar sesión otra vez.
- `proxy.ts` renueva la sesión en las rutas protegidas y, si falla, borra las cookies de sesión.

**Comprobación manual tras el primer login:** en las herramientas del navegador (*Application → Cookies*) la cookie `sb-…-auth-token` debe tener **Secure**, **HttpOnly** y **SameSite=Lax**. Si falta Secure, la variable `NODE_ENV` no es `production` en ese despliegue.

**Para revisar, no es un fallo:** `sameOrigin` (`features/auth/validation.ts`) compara el encabezado `Origin` con `x-forwarded-host` y `x-forwarded-proto`. Vercel fija esos encabezados en el borde. Si cambia la forma de entrada (proxy propio o CDN delante), revisar este punto antes.

## 8. Despliegue automático y rollback

- **Despliegue:** cada cambio que llega a `develop` despliega el backend (Render, por *Auto-Deploy*) y la web (Vercel, rama de producción). **Fusionar un PR en `develop` es desplegar staging.** Hacerlo con cuidado y con el equipo avisado.
- **Rollback del backend:** Render → servicio → *Deploys* → elegir el último despliegue correcto → *Rollback*.
- **Rollback de la web:** Vercel → proyecto → *Deployments* → elegir el despliegue anterior → *Promote to Production* (o *Instant Rollback* si aparece en el panel).
- **Rollback del código:** revertir el commit en `develop` con un PR. Es el camino que deja trazabilidad; los rollbacks de panel son de emergencia.
- **Límite:** revertir un despliegue **no deshace migraciones SQL**. Las migraciones de `unifood-backend/supabase/` se aplican a mano, con su propio plan de reversión.

## 9. Checklist de verificación

Ejecutar en orden tras cada despliegue:

1. **Salud del backend:** `https://<render>/actuator/health` responde `{"status":"UP"}`. Logs de Render sin errores de arranque.
2. **Salud de la web:** `node scripts/smoke-staging.mjs https://<dominio-vercel> https://<render>` (solo lectura) debe terminar en «0 FALLO».
3. **Login:** registro o inicio de sesión con una cuenta de prueba de staging. Confirmar la cookie (sección 7).
4. **Flujo de pedido:** cliente crea pedido → worker lo ve y lo cambia de estado → cliente ve el estado actualizado.
5. **PWA en Android:** en Chrome, abrir la web → menú ⋮ → *Instalar aplicación* (o *Añadir a la pantalla de inicio*). Abrir desde el icono y comprobar que la sesión se mantiene.
6. **PWA en iPhone:** iOS 16.4 o posterior. Safari → Compartir → **«Agregar a pantalla de inicio»**. Abrir desde el icono (no desde Safari). Sin esa instalación, iOS no permite push web.
7. **Prueba de push** (solo con la rama de push integrada y las VAPID configuradas): activar avisos desde el teléfono, cambiar un pedido a `READY` y comprobar la notificación con la app cerrada. Revisar en los logs del backend «Push notifications disabled» si no llega.
8. **Seguridad básica:** `GET https://<render>/api/...` sin token responde 401; `/actuator/env`, `/actuator/beans` y otros endpoints responden 404.

## 10. Seguridad

- **Repositorio público:** nada de claves, contraseñas, URLs de proyecto de producción ni tokens. Los valores van solo a los paneles de Render y Vercel y a Supabase. Si un valor llega por error a git, **rotarlo**: borrar el commit no basta.
- **Backend:** `SecurityConfig` exige JWT válido en todas las rutas salvo `/actuator/health` y las peticiones `OPTIONS`. Sesiones sin estado.
- **Actuator:** solo `health`, sin detalles ni JMX (`application.properties`). No hay Swagger ni consolas expuestas en el backend.
- **Puertos:** Render expone solo el puerto HTTP del servicio. No abrir la base de datos ni el puerto de Actuator fuera de lo necesario.
- **Consolas:** restringir el acceso a los dashboards de Render, Vercel y Supabase a los miembros del equipo que los necesiten. No crear *Render Shell* en producción.
- **Proyecto real:** nunca conectar staging al proyecto real. La guarda de proyecto (sección 2.4) es la red de seguridad; la comprobación humana es ver que `UNIFOOD_EXPECTED_PROJECT_REF` coincide con el Reference ID del proyecto staging.

## 11. Riesgos y pendientes

| Riesgo o pendiente | Qué hacer |
| --- | --- |
| Push no está en `develop` | Decidir integrar `jj/notificaciones-push` y aplicar su migración `027` en staging. |
| No hay manifest ni service worker en `develop` | Crear manifest y worker en una tarea propia antes de la prueba de push y de instalar la PWA con normalidad. |
| `unifood-backend/.env.example` apunta a un proyecto Supabase concreto (`SUPABASE_STORAGE_URL`, con la referencia `qcdxkmow…`) | Confirmar que es el proyecto **real** o un desarrollo, y sustituir el ejemplo por un marcador (`<ref>`) si es real. No se modificó en este PR. |
| CORS del backend fijado a `localhost:3000` y `localhost:3001` (`SecurityConfig`) | Sin efecto hoy: el navegador no llama al backend. Hacerlo configurable si algún día se llama directo. No se modificó. |
| Memoria de la instancia | Con 512 MB, vigilar reinicios por OOM; subir a 2 GB si ocurren. |
| `render.yaml` no validado en Render | Revisar la vista previa del Blueprint antes de aplicar; si falla, usar la configuración manual de la sección 2.1. |
| La imagen Docker no se ha construido en esta preparación | El primer build real será el de Render. La CI actual solo ejecuta tests y Spotless del backend. |
| Región `pdx1` de Vercel | Confirmar en *Settings → Functions* que la opción está disponible en el plan. |
| Dominio `*.vercel.app` y dominio propio | Cambiar de dominio cierra las sesiones y obliga a actualizar Site URL y Redirect URLs. |
| Plan gratuito de Render | No usar para pruebas con teléfonos (sueño de 15 min). |

## 12. Lo que este PR no hace

- No despliega nada, no crea servicios, no aplica migraciones y no toca Supabase, Render ni Vercel remotos.
- No genera claves VAPID ni escribe valores.
- No integra `jj/notificaciones-push` ni crea manifest o service worker.
