# UniFood ADMIN — P4.2: identidad visual y carga

> **Documento vigente** del panel ADMIN. Las iteraciones anteriores
> ([P4](admin-panel-p4-visual.md), [alineación con WORKER](admin-panel-worker-alignment.md)
> y [P4.1](admin-panel-p41.md)) se conservan como registro histórico.

## 1. Rama y estado inicial de Git

Rama `feature/admin-dashboard`, HEAD `618d47c149c31cbd01cd9e593053b0b8f16ed645`.
Al comenzar había 15 archivos versionados modificados y ocho sin seguimiento:
tres protegidos, tres informes anteriores y dos componentes de P4.1. El índice
estaba vacío. Se conservaron P4 y P4.1; no se restauraron versiones anteriores.

Antes de editar se registraron hashes SHA-256 de 641 archivos versionados o sin
seguimiento no ignorados. La comparación final limita P4.2 a los archivos indicados
abajo; otros 635 conservan su contenido inicial.

## 2. Archivos modificados y nuevos

Rutas relativas a `unifood-web`:

| Estado P4.2 | Archivo                                                         | Cambio                                                  |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Modificado  | `features/admin/components/Admin.module.css`                    | Degradado, anchura, branding, navegación y espaciado    |
| Modificado  | `features/admin/components/AdminSidebar.tsx`                    | Reutiliza el icono oficial azul                         |
| Modificado  | `features/admin-dashboard/components/AdminDashboard.tsx`        | Presentación de carga mediante componente               |
| Modificado  | `features/admin-dashboard/components/AdminDashboard.module.css` | Skeletons estáticos responsive y mensaje compacto       |
| Modificado  | `tests/admin-dashboard-ui.test.mjs`                             | Anuncio, placeholders sin cifras y errores sin skeleton |
| Modificado  | `tests/e2e/admin-dashboard.spec.ts`                             | Contraste del degradado, branding, carga y drawer corto |
| Nuevo       | `features/admin-dashboard/components/DashboardLoading.tsx`      | Estructura visual de carga, sin datos ni estado propio  |
| Nuevo       | `docs/admin-panel-p42.md`                                       | Este informe                                            |

Son seis archivos existentes y dos nuevos en esta fase. Backend, BFF, contratos,
SQL, filtros, cálculos, seguridad, sesiones, WORKER y recursos originales mantienen
sus hashes. No se editaron `.env`, datos reales ni archivos protegidos.

## 3. Recursos de marca inspeccionados

Se revisaron visualmente `public/unifood-logo.png` y
`public/unifood-pantalla.png`. El primero contiene el icono original azul con el
símbolo blanco; el segundo contiene únicamente el símbolo transparente. P4.2 usa
el primero, sin generar, recortar ni modificar imágenes.

El recurso azul existente incluye márgenes blancos dentro de su lienzo original.
Se muestran como parte del archivo; no se agregó una tarjeta, borde o sombra al
contenedor. No se encontró una exportación del icono azul sin esos márgenes.

## 4. Degradado y proporciones del sidebar

Fondo compartido por sidebar y drawer:

```css
linear-gradient(180deg, #0b5fff 0%, #0b2d6b 100%)
```

Se mantiene un color de respaldo `#0B2D6B`. El sidebar de escritorio pasa de
232 a 272 px, dentro del intervalo solicitado, con padding horizontal de 20 px.
La estructura existente conserva la navegación fija y el scroll de contenido;
el drawer mantiene su tamaño responsive y scroll interno en alturas reducidas.
No se añaden otros degradados decorativos.

## 5. Integración del icono

`next/image` presenta `/unifood-logo.png` a 52 × 52 px, con `object-fit: contain`
y separación de 12 px respecto al texto. No se distorsiona la proporción ni se
reconstruye el símbolo. El radio exterior de 12 px suaviza el lienzo de la imagen,
sin envoltorio visual adicional. El texto adyacente identifica la marca; el icono
conserva `alt=""` para evitar un anuncio duplicado.

## 6. Wordmark

UniFood completo en blanco, 28 px y peso 750. Administración utiliza 13 px y blanco
al 94 %, con una separación corta. El icono se centra respecto al bloque completo
de nombre y subtítulo. No se diferencia Food ni se aplica un degradado al texto.

## 7. Navegación

La navegación vigente es Dashboard → Catálogo → separador → Mi perfil: el aviso
«Asistente IA · Próximamente» de esta fase se retiró después. No hay Configuración
ni tarjeta inferior. Rutas, `aria-current` y lógica del drawer no
cambian. Se elimina la línea adicional debajo de la marca y se reduce la separación
antes de Mi perfil, manteniendo el único separador funcional solicitado.

El activo utiliza blanco al 6 %, borde blanco al 24 %, peso mayor e indicador
lateral blanco. El hover permanece suave y el foco es visible. Se ajustó el 16 %
sugerido porque, sobre el extremo eléctrico, produciría aproximadamente 3,95:1
para texto blanco; el 6 % mantiene aproximadamente 4,66:1 incluso sobre ese extremo.

## 8. Estados de carga

`DashboardLoading` sustituye la tarjeta grande por un mensaje compacto con
`role="status"` y placeholders de cinco KPI, un bloque monetario, área de gráfica
y filas de ranking.
La estructura decorativa está oculta a tecnologías de asistencia mediante
`aria-hidden="true"`, carece de controles y no contiene números, importes o pedidos.

Son superficies estáticas en `#EAF4FF`, sin shimmer, pulsaciones ni animaciones.
Por tanto, también respetan movimiento reducido. Se muestran tanto en carga inicial
como al cambiar de período y desaparecen al resolverse la solicitud. No se modifican
el hook, el store, las solicitudes, la cancelación ni la lógica de errores.

## 9. Coherencia con WORKER y conservación de P4.1

Se inspeccionaron `components/worker/BottomNav.module.css`, `Header.module.css` y
`WorkerDashboard.module.css`. Se conserva la tipografía heredada, superficies claras,
espaciado, radios y controles del sistema existente. La identidad específica del
sidebar utiliza exclusivamente el degradado oficial solicitado. Ningún archivo
WORKER cambia.

El header compacto, fechas del BFF, filtros, KPI, tres series de barras agrupadas,
rankings, advertencias y estados de error de P4.1 permanecen conservados. No se
modifican valores, contratos ni semántica financiera.

## 10. Accesibilidad

Las pruebas cubren foco visible, navegación y retorno de foco al cerrar con Escape,
estado activo con indicador además del color, nombre accesible de los controles,
tabla diaria y detalles mediante teclado. Los placeholders no añaden paradas de
tabulación ni anuncios repetidos.

La comprobación de contraste ahora reconoce el degradado y compone transparencias
de fondo y texto. Usa el extremo de mayor luminancia como límite conservador para
todo el sidebar, también al aplicar hover y selección. El texto normal cumple el
umbral 4,5:1 en los casos ejecutados. No equivale a una certificación WCAG completa
con lectores de pantalla reales.

## 11. Responsive

Validación automatizada y visual en 390, 768 y 1440 px; prueba y captura adicional
en 1440 × 640 px. El drawer también se prueba a 360 px de altura: se desplaza para
alcanzar Mi perfil y mantiene cierre con Escape y retorno de foco. Que contenido
quede fuera de la vista al desplazarse es scroll normal, no un recorte permanente.

Se comprueba la proporción del logo, centrado del bloque de marca, ausencia de
overflow horizontal global, filtros, estados de carga, gráfica y navegación en
Dashboard, Catálogo y Perfil. El primer KPI sigue apareciendo antes de 380 px en
el escritorio de poca altura.

## 12. Pruebas ejecutadas

| Validación          | Resultado                                                                               |
| ------------------- | --------------------------------------------------------------------------------------- |
| Suite Node completa | 519 aprobadas; cero fallos u omitidas en la ejecución final                             |
| E2E ADMIN           | 86 casos distintos aprobados: 83 en la ejecución completa y tres en repetición dirigida |
| TypeScript          | Aprobado con `tsc --noEmit`                                                             |
| ESLint              | Suite completa aprobada sin advertencias; repetido sobre la E2E ajustada                |
| Prettier            | Aprobado para archivos de P4.2                                                          |
| Build Next.js       | Aprobado con configuración ficticia local                                               |

La ejecución E2E completa incluyó Dashboard, navegación/Perfil, Catálogo, gestión
e imágenes. Sus tres casos nuevos fallaron inicialmente en una aserción geométrica
del test; los otros 83 pasaron. Tras corregir únicamente esa aserción se repitieron
los tres, que pasaron, incluyendo las comprobaciones posteriores de scroll del
drawer. No se declara una segunda ejecución completa de los 86.

Las E2E utilizan Edge y Next de producción local en 3100, con Auth/backend simulados
en 3101. Las operaciones del Catálogo usan fixtures; no acceden a Supabase real.
Las comparaciones con el JSON del BFF validan la integración bajo esos fixtures.
No se declara integración real con un backend desplegado. No se repitió Spring Boot:
esta fase no cambia backend.

Logs temporales: `unifood-admin-p42-node.log`, `unifood-admin-p42-build.log`,
`unifood-admin-p42-e2e.log` y `unifood-admin-p42-e2e-final.log`. Artefactos de pruebas
ignorados por Git en `test-results/admin-p42` y `test-results/admin-p42-final`.

## 13. Capturas revisadas

Se inspeccionaron manualmente las capturas generadas por las E2E, no mockups:

- `%TEMP%/unifood-admin-p4-visual/1440-dashboard.png`
- `%TEMP%/unifood-admin-p4-visual/390-dashboard-drawer.png`
- `%TEMP%/unifood-admin-p4-visual/768-dashboard.png`
- `%TEMP%/unifood-admin-p42-visual/390-initial-loading.png`
- `%TEMP%/unifood-admin-p42-visual/390-loading.png`
- `%TEMP%/unifood-admin-p42-visual/1440-initial-loading.png`
- `%TEMP%/unifood-admin-p42-visual/768-loading.png`
- `%TEMP%/unifood-admin-p42-visual/390-short-drawer.png`
- `%TEMP%/unifood-admin-p42-visual/1440x640-dashboard.png`

Las rutas que contienen p4 fueron actualizadas por esta ejecución. Las capturas
usan datos de fixtures. La inspección visual es manual; las interacciones y
mediciones descritas son automatizadas.

## 14. Problemas encontrados y corregidos

El 16 % de blanco sugerido para el activo no preservaba suficiente contraste sobre
el extremo claro: se adoptó 6 %. La prueba de contraste anterior ignoraba imágenes
de fondo: se amplió para verificar el degradado de forma conservadora.

Dos aserciones nuevas se corrigieron durante validación. Una confundía coordenadas
SVG con cifras visibles; ahora inspecciona el texto de los placeholders. Otra
exigía que solo UniFood quedara dentro de la altura del icono; ahora verifica el
centrado del bloque UniFood/Administración completo. No se alteró el diseño para
satisfacer esas expectativas incorrectas. Después pasaron las suites indicadas.

No se encontraron regresiones funcionales pendientes en el alcance ejecutado.

## 15. Pendientes y límites

Dispositivos físicos, otros motores de navegador,
lectores de pantalla reales y staging quedan pendientes. Una exportación oficial
del icono azul sin márgenes blancos permitiría eliminar ese espacio intrínseco;
no se inventó ni se editó el recurso para sustituirla. Los skeletons son estáticos
intencionadamente y no representan datos.

## 16. Estado final de Git

La rama y HEAD permanecen iguales. En el conjunto acumulado de P4/P4.1/P4.2 hay
15 archivos versionados modificados y diez sin seguimiento; dos de esos archivos
sin seguimiento son los añadidos en P4.2. No hay staging, commits, push, PR, merge,
rebase ni cambio de rama.

`REPORTE_CAMBIOS.md`, `admin-foundation-staging-backup.patch` y
`flow-develop-check.ts` mantienen su hash inicial y siguen fuera del índice. Los
informes anteriores y los demás cambios visuales previos se preservan.
