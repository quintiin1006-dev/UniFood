# Perfil ADMIN y base del panel

## Alcance

El panel web `/admin` contiene un shell administrativo con navegación a Dashboard,
Catálogo y Mi perfil. Dashboard y Catálogo son superficies explícitas de
«Próximamente»; el perfil es de solo lectura. No hay operaciones de catálogo,
métricas, asistente, almacenamiento de imágenes ni cambios de esquema.

El acceso se realiza desde `/panel/login`. CLIENT, WORKER y SUPER_ADMIN conservan
sus destinos existentes. El cierre de sesión utiliza el `LogoutButton` del panel:
`POST /api/auth/logout` y regreso a `/panel/login`.

## Autoridad y contrato

```text
Browser → Next/BFF → identidad Supabase Auth verificada + Spring → PostgreSQL
```

Spring expone `GET /api/admin/profile`. La única identidad aceptada es el subject
del JWT verificado por Spring Security. Los parámetros de consulta, claims de rol,
cabeceras e IDs del navegador no seleccionan usuario ni cafetería.

La política consulta hechos business actuales mediante `AuthorizationQueryPort`:
usuario activo, rol exclusivamente ADMIN y exactamente una asignación. La política
es independiente de autorización de órdenes; ADMIN no recibe permisos WORKER.
La cardinalidad persistente sigue protegida por las migraciones existentes.

Respuesta Spring:

```json
{
  "role": "ADMIN",
  "cafeteria": { "name": "Cafetería Principal", "active": true },
  "site": { "name": "Sede Principal" },
  "institution": { "name": "Universidad" }
}
```

La consulta de autorización y el JOIN de contexto usan una misma transacción
`REPEATABLE_READ`, de solo lectura y con timeout de 15 segundos. Son dos consultas
parametrizadas, sin N+1, consultas a clientes ni lecturas de tablas Auth. El contexto
obligatorio incompleto produce un error seguro; no se inventan valores personales.

El BFF `GET /api/admin/profile` añade exclusivamente `email` obtenido mediante
`getVerifiedAuthIdentity()`. El email business y metadata Auth no son autoridad.
La admisión utiliza la RPC de identidad existente `current_auth_profile`; Spring
vuelve a validar rol, actividad y asignación en PostgreSQL. `getAuth()` y sus
consumidores mantienen su contrato.

`forwardPanelProfile` comparte con WORKER la verificación/admisión y transporte
HTTP. Los predicados, endpoints, parsers y códigos de error siguen siendo explícitos
por rol. Se bloquean redirects, se aplica timeout de 15 segundos hacia Spring y
se descartan campos extra y cabeceras privadas. No hay acceso frontend directo a
tablas business de Supabase ni caché de aplicación; las respuestas usan `no-store`.

## Estados y errores

| Estado | Comportamiento |
| --- | --- |
| 200 | Contexto propio válido, incluida cafetería administrativamente inactiva |
| 401 | Identidad ausente o inválida |
| 403 | Usuario inactivo, rol no ADMIN o asignación no admitida |
| 503 | Dependencia temporal no disponible; `Retry-After: 5` desde Spring |
| 500 | Error inesperado sanitizado |

Los códigos Spring son `ADMIN_PROFILE_FORBIDDEN`,
`ADMIN_PROFILE_TEMPORARILY_UNAVAILABLE` y `ADMIN_PROFILE_INTERNAL_ERROR`.
El advice está limitado a `AdminProfileController`.

El BFF conserva 401/403/500/503, devuelve 502 ante contratos upstream inválidos y
503 ante fallos de transporte. Solo acepta `Retry-After` positivo de hasta 300
segundos; usa 5 por defecto. Los errores temporales no borran cookies ni sesión.
La UI ofrece login ante 401, denegación sin reintento ante 403 y reintento para
errores recuperables. No muestra un perfil parcial o anterior durante un fallo.

## Panel y cafetería inactiva

`/admin`, `/admin/catalogo` y `/admin/perfil` comprueban el rol en servidor; el layout
también está protegido. `AdminShell`, `AdminSidebar`, `AdminHeader` y
`AdminProfilePanel` separan navegación, contexto y presentación.

El shell obtiene un único contexto para header, perfil y aviso de estado. Lo
actualiza al entrar, navegar, recuperar foco o visibilidad. Cancela solicitudes
anteriores y descarta respuestas obsoletas. El estado inicial es determinista
durante SSR e hidratación.

Una cafetería administrativamente inactiva permite consultar el panel y perfil.
Un aviso accesible permanece visible en todas las superficies mientras el contexto
esté cargado. La actividad del usuario se evalúa separadamente: un ADMIN business
inactivo sigue rechazado. Las futuras escrituras de catálogo deberán comprobar
actividad en backend; el banner no sustituye esa autorización.

El perfil muestra correo Auth verificado, rol «Administrador», cafetería, estado,
sede e institución. No incluye IDs, documento, teléfono, nombre inventado,
metadata, edición, contraseña, avatar ni un segundo logout.

Desktop usa sidebar visible; tablet y móvil usan un drawer modal nativo con
teclado, cierre con Escape, foco contenido y retorno al activador. La navegación
usa enlaces reales y `aria-current`; el contenido principal dispone de enlace de
salto. No se restringe el acceso por viewport.

## Validación

Las pruebas ADMIN cubren política, subject verificado, claims manipulados,
aislamiento por cafetería, proyección sin PII y errores. La integración usa un
PostgreSQL temporal con las migraciones existentes hasta 015; no modifica Supabase.
También verifica transacción de solo lectura, ausencia de N+1 y grants cerrados.

Frontend cubre BFF, contratos, recuperación, respuestas obsoletas, shell, roles y
navegación. Los E2E usan el proveedor local controlado para login/logout, cafetería
inactiva, errores, teclado y viewports 390, 768, 1366 y 1920 px. Las pruebas de
WORKER Profile y Auth/roles protegen la extracción compartida del transporte.
