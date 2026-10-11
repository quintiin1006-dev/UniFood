# Frontend del estudiante: análisis y primera etapa

El estado más reciente está descrito en [carrusel, desayunos y carrito inicial](client-shopping.md).
Las secciones de implementación de este documento corresponden a la primera
entrega, anterior a la ampliación acordada con el usuario.

Revisión del repositorio realizada el 6 de octubre de 2026 en `feature/client-frontend`.
Este documento distingue los contratos implementados de la propuesta futura. No se
consultaron datos privados ni se modificaron servicios remotos.

## 1. Estructura actual

El monorepo contiene `unifood-web` y `unifood-backend`; los scripts raíz delegan
al frontend. Spring Boot 4.0.8 / Java 21 separa dominio, aplicación (casos de uso,
puertos y servicios), adaptadores web/persistencia y configuración de seguridad.
PostgreSQL se describe en siete migraciones de Supabase.

El frontend usa Next.js 16.3.8, React 19.2.8 y TypeScript estricto, alias `@/*`
y resolución `bundler`. App Router combina páginas de servidor con componentes
interactivos. `next.config.ts` valida el entorno, define el root de Turbopack y
permite orígenes locales/LAN. No hay una capa general `services/`, `utils/`,
`hooks/` o `styles/`: esas responsabilidades viven dentro de los módulos.

```text
unifood-web/
├── app/                  # Rutas, layouts y BFF mediante Route Handlers
├── components/worker/    # Header, BottomNav, Kanban, tarjetas, detalle y llamadas
├── features/
│   ├── auth/             # Formularios, validación y sesión Supabase del servidor
│   └── orders/           # API, hook con polling, DTO y mapper del trabajador
├── config/               # Variables de entorno y configuración server-only
├── lib/                  # Flujo de estados y formato de tiempos de pedidos
├── types/                # Modelo visual de pedidos
├── public/               # Logo, marca de agua y recurso gráfico del login
├── docs/                 # Autenticación y entornos
└── tests/                # Node, PostgreSQL de prueba y E2E con Playwright
```

Dependencias existentes aprovechables: Supabase SSR/JS, Lucide, `server-only`.
Playwright, ESLint, Prettier y PGlite ya están instalados como herramientas de
desarrollo. Tailwind 4 y su plugin PostCSS están declarados, pero las pantallas
inspeccionadas se construyen con CSS Modules, CSS global y algunos estilos inline.
No hace falta agregar paquetes.

## 2. Identidad visual y reutilización

El login usa texto `#090f52`, acento `#0064ff`, blancos y azules muy claros,
inputs redondeados de 14 px y botones de altura aproximada de 54 px. El trabajador
usa superficies blancas translúcidas, bordes suaves, tarjetas de 16 px y modales
de 24 px. La tipografía global es Inter con fallbacks del sistema; no se carga
una fuente externa mediante `next/font`. Lucide es la iconografía común.

La primera etapa conserva logo, tipografía, colores de marca y bordes suaves;
usa azul principalmente en acentos, fondo neutro, texto secundario de mayor
contraste y controles de al menos 44 px. Las superficies claras y la navegación usan translucidez suave.

- Reutilizar `requireAuth`, `isClient`, `destination` y `LogoutButton` sin cambiar
  sus contratos; el logo se toma del mismo archivo de `public/`.
- `Brand` está acoplado al layout y al destino del login. La cabecera del cliente
  utiliza el mismo recurso gráfico con un enlace a `/cuenta`, sin modificarlo.
- Los tipos/estados y formatos de pedidos podrán aprovecharse en seguimiento,
  revisando qué campos realmente devuelve la futura consulta CLIENT.
- `useOrders`, `orderApi`, `BottomNav`, `OrderCard` y `OrderDetail` del trabajador
  contienen acciones o navegación operativa. No se conectan al estudiante.
- El detalle existente tiene cierre con Escape, control/restauración del foco
  y semántica de diálogo: sirve de referencia para futuros modales, no de
  dependencia que arrastre acciones de trabajador.
- `globals.css` limita el scroll del body y escala el panel. Se conserva intacto:
  el shell del cliente administra su propio scroll dentro de `100dvh`.

## 3. Rutas y funciones anteriores a esta etapa

| Ruta                     | Comportamiento encontrado                                              |
| ------------------------ | ---------------------------------------------------------------------- |
| `/`                      | Redirigía a `/panel/login`, en discrepancia con el AGENTS.md raíz      |
| `/login`                 | Entrada CLIENT, enlace a registro estudiantil                          |
| `/registro`              | Registro institucional, contraseña y verificación OTP                  |
| `/recuperar-contrasena`  | Recuperación compartida, contexto client/panel                         |
| `/panel/login`           | Entrada WORKER/ADMIN/SUPER_ADMIN                                       |
| `/cuenta`                | CLIENT verificado: saludo, correo y logout; menú anunciado como futuro |
| `/worker`                | Kanban, búsqueda, detalle, llamadas y transiciones reales              |
| `/admin`, `/super-admin` | Placeholders protegidos por rol                                        |

No había home comercial, catálogo, detalle de almuerzo, carrito, creación,
seguimiento, historial ni edición del perfil de estudiante.

## 4. Autenticación, datos y contratos existentes

Supabase se usa desde el servidor. `getAuth()` verifica `auth.getUser()`, correo
confirmado y `current_auth_profile`; exige actividad y exactamente un rol de
negocio válido antes de obtener la sesión. Las cookies son HttpOnly y SameSite
Lax (Secure en producción). `proxy.ts` renueva cookies, pero no autoriza roles.
Las páginas y BFF autorizan por separado; Spring valida JWT y las reglas de negocio.
No se transmite el access token a los componentes del navegador.

| Servicio comprobado                                                                         | Alcance                                                                             |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `POST /api/auth/[action]`                                                                   | login, register, institution, verify, resend, recover, reset, logout                |
| RPC `current_auth_profile`                                                                  | id, email, fullName, active, roles; no incluye institución/sede                     |
| RPC `is_institutional_email`                                                                | Admisión del correo; no es un catálogo                                              |
| Spring `GET /api/institutions/by-domain?domain=…` y `GET /api/institutions/{institutionId}` | Consulta con autenticación; sin BFF de catálogo actualmente                         |
| `GET /api/orders` en Next                                                                   | Solo WORKER; resuelve cafetería mediante contexto del backend                       |
| Spring `GET /api/worker/context`                                                            | Cafetería asignada al WORKER activo                                                 |
| Spring `GET /api/orders?cafeteriaId=…`                                                      | Listado autorizado de la cafetería, no listado CLIENT                               |
| `PATCH /api/orders/{id}/{prepare,ready,call,deliver,cancel}`                                | Operaciones WORKER, expuestas mediante BFF                                          |
| `PATCH /api/me/orders/{orderId}/cancel`                                                     | CLIENT activo, pedido propio y PENDING; BFF devuelve solo `{id,status:"CANCELLED"}` |

La cancelación CLIENT devuelve 401/403/404/409 según sesión, elegibilidad,
propiedad y estado. No aplica el plazo adicional de cancelación del trabajador.
Su UI espera una consulta real de pedidos propios; no debe pedir IDs manuales
ni reutilizar el listado de otro rol. El locking frente a preparación concurrente
sigue siendo una limitación documentada del backend existente.

El dominio SQL es institución → sede → cafetería → almuerzo. `cafeterias` tiene
nombre, sede, actividad, habilitación de servicio y horario de pedidos;
`lunches` tiene nombre, descripción, precio, imagen, stock y actividad. Hay RLS
para catálogo de la institución del cliente y pedidos propios. Eso demuestra
soporte en el esquema, no que las migraciones estén desplegadas ni que existan
endpoints Spring de catálogo. La integración de catálogo espera un contrato
explícito. La lectura del perfil propio sí utiliza PostgREST desde el servidor
con el cliente Supabase y las políticas RLS existentes; se detalla a continuación.

`order_items` admite cantidad, bebida y nota, pero no existe catálogo de opciones
ni validación de creación expuesta. No hay categorías, valoraciones, popularidad
o promociones en el modelo revisado. Hay tabla de pagos, sin API de checkout.

Variables utilizadas: `API_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`AUTH_USERNAME_DOMAIN`; Spring requiere `SUPABASE_DB_URL` y `SUPABASE_AUTH_ISSUER`.
Se revisaron nombres, no se copiaron valores. La variable local heredada
`NEXT_PUBLIC_CAFETERIA_ID` no es usada por el flujo actual. No se cambia `.env.local`.

## 5. Implementación adaptada a las referencias (7 de octubre de 2026)

El usuario pidió selección de sede, inicio con imágenes de comida y perfil similares
al diseño suministrado, dejando pedidos para después. Se conserva la arquitectura;
no hay dependencias nuevas, cambios de backend ni modificaciones del flujo compartido
de autenticación en esta adaptación.

| Ruta                                              | Contenido                                                       |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `/cuenta`                                         | Selector de dos sedes ilustrativas                              |
| `/cuenta?sede=principal`                          | Saludo real, cafetería de ejemplo, hero y categorías            |
| `/cuenta?sede=aguas-claras`                       | El mismo recorrido para la segunda sede ilustrativa             |
| `/cuenta/menu?sede=principal&categoria=corriente` | Lista de platos de ejemplo y búsqueda local                     |
| `/cuenta/perfil`                                  | Nombre/correo reales, documento, institución y teléfono propios |
| `/cuenta/perfil/contrasena`                       | Explicación y acceso al cambio de contraseña por correo         |

La navegación inferior contiene **Inicio y Perfil**. No hay carrito, pedidos,
notificaciones inventadas ni botones para agregar productos. No se indica que una
cafetería está abierta sin una fuente real. Las categorías son `corriente`,
`ejecutivos` y `especiales`, únicamente para demostrar la interfaz.

Los mocks se concentran en `features/client/mocks/catalog.ts`: no representan DTOs
reales, una asignación institucional ni disponibilidad comprobada. El aviso visible
identifica sedes, fotos, menús y precios como ilustrativos. Ambas sedes comparten el
catálogo de ejemplo; su selección se conserva en los enlaces mediante query params.
No se persiste información entre cuentas. Un menú con parámetros ausentes,
desconocidos o duplicados vuelve al selector.

`server/profile.ts` consulta `clients` con `user_id` del perfil verificado y después
la institución referenciada. Usa `authClient()` con la sesión y RLS existentes
(`clients_select_own`, `institutions_select_active`); no usa service role ni modifica
filas. El teléfono puede ser nulo: se muestra «Sin registrar». Ante errores o datos
inaccesibles se mantiene nombre/correo y se muestra un aviso, sin exponer errores
internos. El perfil es de lectura: editar teléfono y subir avatar quedan pendientes.

El cambio de contraseña reutiliza `/recuperar-contrasena?entrypoint=client` y sus
acciones existentes `recover`, `verify` y `reset`. No se añadió un formulario de
contraseña actual que implicara otro contrato de reautenticación. Tampoco se simula
un cambio exitoso. Al terminar el flujo existente, se vuelve a iniciar sesión.

La pantalla de bienvenida aparece durante carga real, sin un temporizador artificial.
Todas las páginas comprueban sesión y rol CLIENT en el servidor, además del layout.

## 6. Árbol actual del módulo

```text
unifood-web/
├── app/cuenta/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── loading.tsx
│   ├── error.tsx
│   ├── menu/page.tsx
│   └── perfil/
│       ├── page.tsx
│       └── contrasena/page.tsx
├── features/client/
│   ├── components/
│   │   ├── ClientShell.tsx + ClientShell.module.css
│   │   ├── ClientBottomNav.tsx
│   │   ├── SiteSelection.tsx
│   │   ├── CafeteriaSelector.tsx
│   │   ├── ClientHome.tsx
│   │   ├── ClientMenu.tsx
│   │   ├── DemoNotice.tsx
│   │   ├── ClientCatalog.module.css
│   │   ├── ClientHome.module.css       # Carga y error
│   │   ├── ClientProfile.tsx
│   │   ├── ClientPassword.tsx
│   │   └── ClientProfile.module.css
│   ├── mocks/catalog.ts
│   ├── server/profile.ts
│   └── types.ts
├── public/images/client/               # Cinco PNG ilustrativos generados
├── tests/client-profile.test.mjs
├── tests/e2e/client-home.spec.ts
└── docs/client-images.md               # Procedencia y prompts de imágenes
```

Los CSS Modules propios aíslan estos cambios del login y el panel. El shell reserva
una fila real para la navegación y las safe areas, con scroll en `main` y altura
`100dvh`. La columna crece hasta 680 px en pantallas grandes. La búsqueda usa input
de 16 px, botones táctiles, resultados anunciados y restauración de foco al limpiar.
No se añadieron modales en este bloque.

## 7. Próximos bloques, por orden

1. Revisar estas pantallas con el usuario y sustituir fotos/mocks por contenido oficial.
2. Acordar e integrar catálogo autorizado por institución, sede y cafetería; resolver
   categorías reales, stock, horarios y disponibilidad. Añadir API, tipos y mappers
   siguiendo `features/orders` cuando exista un contrato comprobado.
3. Detalle de almuerzo, cantidad y carrito cuando se acuerden sus reglas. La
   personalización requiere catálogo y validación reales.
4. Creación/confirmación con backend transaccional que valide precio, stock,
   horarios, propiedad e idempotencia.
5. Lectura de pedidos propios, seguimiento/cancelación e historial. La cancelación
   existente se conectará después de disponer de consulta CLIENT.
6. Edición de teléfono/avatar según permisos y almacenamiento acordados.

## 8. Validación y commits sugeridos

Las pruebas del módulo cubren cinco anchos móviles (320, 375, 390, 412 y 430 px),
escritorio a 1280 px, imágenes cargadas, ausencia de overflow, navegación, búsqueda,
estado vacío, valores de perfil largos, viewport reducido y logout. También prueban
redirecciones por rol en todas las rutas, filtros de perfil propio y fallos de lectura.
El proveedor de E2E es local; estas pruebas no utilizan cuentas de Supabase reales
ni demuestran que los datos/migraciones de una instalación remota estén disponibles.

No se ejecutan commits ni push. Agrupación sugerida:

- `feat(client): add mobile client shell and protected profile` — shell, rutas base,
  lectura de perfil, navegación, protección de subrutas y pruebas asociadas.
- `feat(client): add campus selection and demo menu browsing` — selector, inicio,
  menú, búsqueda, mocks, imágenes y pruebas visuales del recorrido.
- `feat(client): connect profile to existing password recovery` — pantalla de acceso
  al flujo existente y pruebas de navegación/autorización.
- `fix(client): route app entry to student login` — cambio raíz de la etapa inicial
  según AGENTS.md; agrupar las pruebas correspondientes.
- `docs(client): document client architecture and demo assets` — este análisis,
  procedencia de imágenes y documentación actualizada.
