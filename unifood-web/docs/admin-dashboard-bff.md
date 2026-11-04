# Dashboard ADMIN — BFF P2-A

`GET /api/admin/dashboard` en Next.js conecta al navegador con el endpoint homónimo
de Spring. No modifica la UI, `/admin/page.tsx`, el backend ni sus datos. Las
definiciones comerciales permanecen en [la documentación P1](../../unifood-backend/docs/admin-dashboard.md).

## Autenticación y transporte

Browser → Route Handler → `getVerifiedAuthIdentity()` → `current_auth_profile`
→ Spring → validación/proyección del DTO → Browser.

Se reutilizan los mecanismos de sesión existentes. `getUser()` verifica la
identidad y el helper existente obtiene el bearer de la sesión correspondiente.
La RPC debe devolver el mismo usuario, activo y con rol exclusivamente ADMIN.
No se admiten claims comerciales, cookies sin verificar ni bearer del caller
como autoridad. Spring vuelve a verificar permisos y resuelve la cafetería desde
sus asignaciones actuales. Las cafeterías inactivas siguen siendo consultables.

Solo `server/forward.ts` importa identidad, cliente Auth y configuración privada;
lleva `import "server-only"`. El cliente `api.ts` consulta únicamente una URL
relativa del BFF, con `credentials: same-origin`, sin tokens ni acceso directo a
Spring o tablas business. `current_auth_profile` es la RPC de admisión existente,
no una consulta administrativa de tablas desde el navegador.

La URL upstream usa la configuración privada `API_URL`, la ruta fija y una query
reconstruida. No se reenvían host, cookies, authorization, headers de tenant ni
otros encabezados del navegador. Solo se añade el bearer verificado y Accept JSON.
Los redirects upstream se rechazan y el timeout de transporte es 15 segundos,
incluida lectura del cuerpo. El consumidor de navegador tiene timeout de 30 segundos.

## Filtros

`range` es obligatorio: TODAY, LAST_7_DAYS, LAST_30_DAYS o CUSTOM. CUSTOM exige
from/to ISO estrictas, inclusivas, ordenadas, no futuras según America/Bogota y
máximo 366 fechas. Otros rangos rechazan from/to. rankingLimit tiene predeterminado
10 y admite enteros 1–50. Se rechazan vacíos, repetidos y parámetros desconocidos,
incluidos cafeteriaId, userId, timezone, asOf y alias de selección de tenant.

```http
GET /api/admin/dashboard?range=TODAY
GET /api/admin/dashboard?range=CUSTOM&from=2024-01-01&to=2024-01-31&rankingLimit=10
```

La validación BFF es adicional: Spring conserva su propia validación y el reloj
autoritativo de las métricas. El BFF no transforma presets en fechas calculadas
por el navegador. `api.ts` admite filtros tipados y límite opcional; el BFF sigue
validando cualquier solicitud recibida directamente.

## Contrato y validación

`types.ts` refleja AdminDashboardResponse, AdminDashboardPeriod y los modelos
Scope/Warning de P1. `contracts.ts` valida todos los campos necesarios y devuelve
una proyección nueva con únicamente campos publicados, también en objetos anidados.
Los extras no forman parte del contrato público y no se propagan.

Se conservan period, basis=EVENT_DATE, currency=COP, summary, trend,
topDeliveredProducts, notCollectedProducts y coverage. Conteos/unidades permanecen
strings enteros; importes, strings exactos de dos decimales, sin convertir a Number
ni aplicar el máximo de un precio individual. Porcentajes son strings de dos
decimales en 0–100 o null. Fechas ISO e instantes UTC admiten hasta nueve decimales.
Las comparaciones de instantes usan precisión de nanosegundos.

Se comprueban forma y límites del período, continuidad diaria, coincidencia con
filtros solicitados, límites de rankings, UUID únicos y estados de disponibilidad.
No se suman ni recalculan indicadores, rankings, valores, porcentajes o denominadores.
El orden y los snapshots históricos recibidos se conservan.

AVAILABLE vacío se distingue de UNAVAILABLE_INCOMPLETE_ITEMS: este último conserva
totales/omitidos null e items vacío. No se convierte null en cero ni en un ranking
disponible. El porcentaje de entregados permanece null, tal como lo serializa P1.

Coverage conserva LIMITED, UNKNOWN, PASS, WARN y NOT_CHECKED, sus scopes/eventTypes,
poblaciones y advertencias. Se validan los quince checks actualmente emitidos por P1,
sin duplicados ni ausencia de campos. La auditoría global no ejecutada permanece
NOT_CHECKED con conteos y límites null. Un WARN requiere su advertencia correspondiente.

Los códigos públicos de checks, warnings y affects pertenecen al vocabulario actual
de P1. Un código nuevo/desconocido invalida la respuesta completa con 502; no se
elimina silenciosamente. Una evolución de estos checks requiere actualizar contrato
y pruebas BFF junto al backend. No se certifica procedencia comercial ni pagos.

## Errores y caché

Todos los resultados, incluidos errores, llevan `Cache-Control: no-store`.
La ruta es force-dynamic y el fetch upstream usa no-store. Los métodos distintos
de GET se rechazan explícitamente con 405, Allow GET y no-store; esto evita que
HEAD/OPTIONS o el 405 automático de Next omitan la política de caché.

| Estado | Semántica pública                                                           |
| ------ | --------------------------------------------------------------------------- |
| 400    | Filtros inválidos; ADMIN_DASHBOARD_INVALID_REQUEST                          |
| 401    | Sesión ausente/inválida/expirada; UNAUTHORIZED                              |
| 403    | Admisión o autorización denegada; ADMIN_DASHBOARD_FORBIDDEN                 |
| 500    | Fallo interno/configuración o respuesta 500 de Spring                       |
| 502    | Contrato, JSON, Content-Type o respuesta inesperados; fallo de comunicación |
| 503    | Auth temporalmente no disponible, timeout o indisponibilidad upstream       |

400/401/403/500/502/503 upstream conservan estado. 408/429/504 se normalizan a 503;
otros estados inesperados a 502. Solo 503 publica Retry-After entero positivo ≤300,
con fallback 5. La indisponibilidad Auth usa AUTH_TEMPORARILY_UNAVAILABLE.

El JSON público de error contiene status, code y message procedentes del catálogo
local de mensajes. Nunca se devuelve el cuerpo de error upstream, URLs internas,
SQL, trazas, headers Authorization/Set-Cookie/Location ni mensajes de excepciones.
No se borran cookies por fallos temporales. El helper Auth existente conserva la
responsabilidad de refrescar o invalidar una sesión cuando corresponde.

## Archivos y pruebas

- Route Handler: `app/api/admin/dashboard/route.ts`.
- Feature: `types.ts`, `filters.ts`, `contracts.ts`, `errors.ts`, `api.ts`, `server/forward.ts`.
- Pruebas: admin-dashboard-filters, contracts, bff y api; fixture local coherente.

Las pruebas del BFF simulan Auth y Spring: no consultan Supabase ni escriben pedidos.
Cubren filtros, roles, expiración, headers forjados, DTO incompleto/malformado,
precisión, estados incompletos, cobertura, privacidad, errores, desconexión y timeout.
La prueba del Route Handler ejecuta su export GET y los rechazos de otros métodos.

Resultados ejecutados:

| Verificación                                                                            | Resultado                                                   |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Pruebas nuevas de filtros, contratos, BFF y cliente                                     | 155 aprobadas                                               |
| Regresión conjunta con Auth, roles, proxy, Perfil/Catálogo ADMIN e Historial WORKER BFF | 239 aprobadas en total; 0 fallos, 0 omitidas                |
| TypeScript (`tsc --noEmit --incremental false`)                                         | Aprobado                                                    |
| ESLint de archivos nuevos con `--max-warnings=0`                                        | Aprobado, sin advertencias                                  |
| Prettier de archivos nuevos                                                             | Aprobado                                                    |
| Build Next.js 16.3.8                                                                    | Aprobado; `/api/admin/dashboard` aparece como ruta dinámica |

Las pruebas se ejecutaron con mocks/fixtures y el build con URL de Auth/API en
loopback y clave pública ficticia. El ejecutor Node y el build requirieron
autorización fuera del sandbox por restricciones de procesos hijos; no se usaron
credenciales ni servicios de Supabase Production. No se ejecutó la suite frontend
completa ni E2E con proveedores reales: se seleccionaron las suites relevantes
para esta integración. Los archivos previos del backend P1 y los tres archivos
protegidos se verificaron mediante SHA-256.

## Límites y siguiente fase

No se implementaron componentes, gráficos, hooks de estado ni cambios de navegación.
La pantalla Dashboard conserva Próximamente. No se certificaron datos remotos ni
se realizó un flujo E2E con Supabase/Spring productivos. Las validaciones independientes
entre BFF y Spring pueden discrepar ante relojes desalineados; el error de Spring se conserva.
En P3 se retiró la comprobación de fechas futuras basada en el reloj del navegador:
el cliente valida la estructura y los servidores mantienen esa restricción temporal.

P2-B puede utilizar `adminDashboardApi.get(filters, signal)`, sin importar server/forward.
Debe mostrar coverage, tratar cero/null/no disponible como estados distintos,
cancelar y descartar respuestas obsoletas, retirar datos protegidos ante 401/403 y
permitir reintento ante 503 conservando la sesión. No interpretar valores como
ingresos cobrados ni pérdidas económicas.
