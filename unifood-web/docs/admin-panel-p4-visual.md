# Panel ADMIN — refinamiento visual P4

> **Histórico.** Registro de esta iteración, superada por las siguientes. El
> estado vigente del panel se describe en [P4.2](admin-panel-p42.md).

## 1. Rama y punto de partida

Trabajo realizado en `feature/admin-dashboard`, sobre HEAD
`618d47c149c31cbd01cd9e593053b0b8f16ed645`. Antes de editar se confirmó que existían
los cinco commits de P1–P3:

| Commit    | Responsabilidad                  |
| --------- | -------------------------------- |
| `1b41d7a` | Backend y pruebas unitarias      |
| `78e3f60` | BFF y pruebas                    |
| `3a13af7` | PostgreSQL y contrato compartido |
| `3a64736` | Frontend integrado               |
| `618d47c` | Informe P3                       |

El estado inicial solo contenía los tres archivos protegidos sin seguimiento.
Se guardó una línea base SHA-256 de los archivos versionados y protegidos en el
directorio temporal del sistema para comprobar el alcance al terminar.
No se realizó staging, commit, push, PR ni cambio de rama.
El estado final tiene cinco archivos versionados modificados y este informe nuevo;
los otros tres archivos sin seguimiento son los protegidos preexistentes.

## 2. Archivos de esta fase

- `features/admin/components/Admin.module.css`: tokens, sidebar, drawer, header,
  tipografía, Perfil y respuesta visual de controles.
- `features/admin/components/AdminSidebar.tsx`: selección del logo transparente
  existente; enlaces y comportamiento de navegación conservados.
- `features/admin-dashboard/components/AdminDashboard.module.css`: composición,
  filtros, KPIs, gráfico, tablas y estados visuales.
- `features/admin-catalog/components/AdminCatalog.module.css`: superficies de las
  tarjetas coherentes con el resto del panel y contraste de textos secundarios,
  placeholder de búsqueda y estado sin imagen.
- `tests/e2e/admin-dashboard.spec.ts`: contraste del shell y regresiones visuales
  de navegación, branding, foco y movimiento reducido.
- Este informe.

Las rutas anteriores son relativas a `unifood-web`.

## 3. Sistema visual

Se conserva la estructura existente con una paleta acotada: azul profundo
`#102D58`, acción corporativa `#1957A6`, selección de navegación `#1B467D`,
superficies claras `#EAF2FF`, fondo `#F5F8FC` y blanco. El ámbar queda reservado
al seguimiento de no recogidos y a los estados existentes.

Los tokens compartidos de color, bordes, texto secundario y sombra viven en el
CSS Module del shell. Tarjetas de Dashboard, Catálogo y Perfil comparten bordes,
radios y profundidad moderada. Se mantiene la familia tipográfica instalada,
sin dependencias ni fuentes nuevas. No se añadieron gradientes ni efectos de blur.

## 4. Logo UniFood

La inspección visual y de metadatos confirmó:

- `public/unifood-logo.png`: 1254 × 1254, RGB, opaco y con fondo claro incrustado.
- `public/unifood-pantalla.png`: 771 × 778, RGBA, con transparencia real y el
  símbolo original de UniFood, adecuado sobre azul profundo.

Se reutiliza el segundo recurso sin editar ninguno de los dos originales. Se
presenta en un área de 56 × 56 con `object-fit: contain`, conservando sus
proporciones, colores y geometría. El nombre sigue siendo texto legible junto
al símbolo; el subtítulo Administración utiliza un tono claro de alto contraste.
No hay filtros de color, recortes, nuevas imágenes ni generación de otra identidad.

## 5. Sidebar y header

Sidebar de escritorio de 232 px, frente a 244 px anteriores, con fondo azul
profundo. Dashboard, Catálogo y Mi perfil mantienen sus rutas. El estado actual
combina superficie azul más clara, borde, peso tipográfico, indicador lateral y
`aria-current`. Hover y foco tienen tratamiento propio sobre fondo oscuro.

El drawer móvil conserva dialog nativo, cierre con Escape, contención de foco,
devolución al botón de apertura y cierre al navegar. Su color y branding coinciden
con el sidebar. No se cambió la lógica del shell.

El header reduce su mínimo de escritorio de 90 a 80 px y mantiene el nombre de
cafetería como primer nivel de lectura. Subtítulo, botón de sesión y menú conservan
su contenido y comportamiento. El CSS mejora alineación, contraste y separación.

## 6. Dashboard

- Encabezado más compacto y botón Actualizar con borde corporativo y feedback.
- Selector segmentado con superficie activa elevada y subrayado, además de
  `aria-pressed`, para identificar la selección sin depender solo del color.
- KPIs con cifras más destacadas, números tabulares, etiquetas legibles, borde
  superior discreto y sombra moderada. Importes extensos siguen pudiendo partirse.
- Leyendas del gráfico en superficies ligeras, ejes con mayor contraste y espacio
  más equilibrado. Se conservan SVG, escala, trazos diferenciados, títulos nativos
  existentes y tabla diaria alternativa; no se añadieron tooltips interactivos.
- Rankings con encabezados más legibles, columnas numéricas alineadas a la derecha,
  contorno de tabla, estado hover discreto y posiciones más reconocibles.
- No recogidos conserva prioridad y acento ámbar contenido. Los textos siguen
  distinguiendo valores de cabecera y subtotales, sin afirmar pérdidas económicas.
- Cobertura, vacío, no disponible, carga y error conservan su significado.

## 7. Responsive

Se mantienen los cortes existentes: sidebar fijo desde 1024 px; drawer por debajo;
KPIs en dos columnas en pantallas intermedias; valores y resumen de no recogidos
apilados en móvil. Los filtros se distribuyen en dos columnas en 390 px.
El scroll horizontal permitido permanece dentro de cada tabla, con región
enfocable y ayuda visible en móvil. Las pruebas verifican también que el contenido
principal no tenga overflow horizontal.

## 8. Accesibilidad y microinteracciones

Foco visible claro sobre navegación oscura y foco azul sobre superficies claras.
Etiquetas, botones, títulos, captions, encabezados scope y regiones accesibles se
conservan. Se amplió la medición de contraste al header y sidebar visibles, y al
texto de las tres vistas principales. El placeholder de búsqueda utiliza el
mismo tono secundario de mayor contraste.

Las únicas transiciones añadidas duran 140 ms y afectan colores, bordes y sombra
de controles. Están dentro de `prefers-reduced-motion: no-preference`; con movimiento
reducido no se aplican. No se añadieron desplazamientos, animaciones de tarjetas
ni efectos distractores.

## 9. Pruebas

| Verificación          | Resultado P4                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Suite Node completa   | 516 aprobadas; 0 fallos, 0 omitidas                                                                                                            |
| TypeScript            | Aprobado                                                                                                                                       |
| ESLint                | Aprobado, cero advertencias                                                                                                                    |
| Prettier              | Aprobado                                                                                                                                       |
| Build Next.js 16.3.8  | Aprobado con API/Auth ficticios en loopback                                                                                                    |
| E2E ADMIN ampliadas   | 80 aprobadas; 0 fallos u omitidas: 18 Dashboard, 15 navegación/Perfil, 20 Catálogo, 17 gestión y 10 imágenes                                   |
| E2E sobre build final | 53 aprobadas; 0 fallos u omitidas: Dashboard, navegación/Perfil y Catálogo, tras ajustar contraste y ampliar la comprobación a las tres vistas |

Las ejecuciones repetidas no se suman como pruebas distintas. El build y los
controles estáticos se volvieron a verificar después de los ajustes finales.
Los logs están en el directorio temporal con prefijo `unifood-admin-p4-`;
los artefactos de navegador quedan ignorados por Git en `test-results/admin-p4`
y `test-results/admin-p4-final`.

Las E2E utilizan Edge, Next real en 3100 y proveedor Auth/backend simulado en 3101. Las operaciones de gestión de Catálogo e imágenes actúan sobre fixtures,
sin modificar datos reales. No representan integración desplegada con Supabase.
No se repitió el backend: P4 no cambia sus fuentes, SQL ni contratos.

## 10. Capturas

Las pruebas guardan vistas de Dashboard, Catálogo, Perfil y drawers en
`unifood-admin-p4-visual`, dentro del directorio temporal del sistema. Las capturas
del gráfico y no recogidos están en `unifood-admin-dashboard-visual`.
Se inspeccionaron capturas reales de Edge: vista inicial de Dashboard en 390 y
1440 px; gráfico en 768 px; menú móvil abierto en 390 px; Catálogo en 1440 px;
Perfil en 768 y 1440 px; no recogidos en 390 y 1440 px. Las capturas corroboran
branding integrado, jerarquía, tablas legibles y desplazamiento limitado a tablas.
La inspección de imágenes es manual; navegación, foco, medidas de contraste y
overflow se comprobaron mediante automatización con fixtures.

## 11. Defectos atendidos y preservación

Se resuelve el fondo claro incrustado del logo seleccionando el recurso transparente
original existente. Se refuerzan contraste de textos secundarios, foco en el menú
oscuro y reconocimiento del filtro activo sin cambiar sus reglas.
La revisión visual también identificó contraste bajo en el estado sin imagen y
la nota de Catálogo: se utiliza el token secundario común y un fondo plano para
el estado sin imagen, eliminando su gradiente anterior.

Backend, BFF, contratos, SQL, métricas, lógica de filtros, cálculos monetarios,
rankings, cobertura, sesión, autorización y recursos originales quedan fuera de
los cambios. La comparación SHA-256 final conserva 631 de los 636 archivos de la
línea base: los únicos cinco distintos son los cuatro archivos visuales y la
prueba E2E enumerados. Esto incluye la preservación de ambos PNG originales y de
los tres archivos protegidos. No se editaron `.env` ni datos reales.

## 12. Límites y recomendaciones futuras

La revisión usa capturas y pruebas automatizadas locales; no certifica WCAG
completa ni uso con lectores de pantalla y dispositivos físicos. La validación
con Auth real, carga y configuración de staging sigue pendiente según P3.

No se implementaron tooltips interactivos ni barras de participación nuevas.
Una futura ampliación de esas interacciones requeriría diseño específico para
teclado y táctil. No se modificó el diseño de los otros roles de UniFood.
