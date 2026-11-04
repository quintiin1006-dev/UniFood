# ADMIN — segunda iteración visual, alineada con WORKER

> **Histórico.** Registro de esta iteración, superada por las siguientes. El
> estado vigente del panel se describe en [P4.2](admin-panel-p42.md).

## Rama y alcance

Se mantiene `feature/admin-dashboard`, con HEAD `618d47c`. La P4 anterior ya
contenía cambios sin commit; se tomó una nueva línea base de 637 archivos para
distinguir esta iteración de ese trabajo previo. No se realizó staging, commit,
push, PR ni cambio de rama.
El estado acumulado de Git contiene 14 archivos versionados modificados y dos
informes nuevos, incluyendo los pendientes de P4. Los tres archivos protegidos
preexistentes siguen sin seguimiento y fuera del índice.

Solo se modifica presentación del panel ADMIN, sus pruebas y este informe. Los
archivos WORKER se utilizan como referencia de lectura, sin modificarlos.

## Referencia visual

Los tonos proceden de `components/worker/Header.module.css`,
`components/worker/BottomNav.module.css` y las superficies de Perfil e Historial
WORKER:

| Uso                                            | Color reutilizado |
| ---------------------------------------------- | ----------------- |
| Azul profundo y títulos                        | `#102D68`         |
| Navegación activa, foco y barras de entregados | `#0868E9`         |
| Botones y enlaces                              | `#1455AD`         |
| Superficies de controles                       | `#EAF2FF`         |
| Fondo de trabajo                               | `#F3F6FB`         |

Se conservan los tonos ámbar existentes para no recogidos y estados operativos.
No se trasladan los efectos de blur, gradientes de fondo o animaciones de WORKER.
Los tokens son locales al shell ADMIN para evitar efectos sobre otros roles.

## Navegación y branding

Dashboard, Catálogo y Mi perfil conservan sus tres enlaces originales y su estado
activo. Se añade un grupo semántico «Próximos módulos» con Asistente IA y
Configuración, ambos acompañados de «Próximamente». Son elementos informativos:
sin enlaces, botones, rutas nuevas ni acciones que simulen funcionalidad.

UniFood se presenta en un solo color claro. Se mantiene el PNG transparente
`unifood-pantalla.png`, sin editar los recursos de marca. El bloque «Tu cafetería,
en un solo lugar» pasa a ser una card blanca al pie del sidebar, con borde y
sombra discreta. El drawer comparte esa composición.

## Header

El nombre de la cafetería se destaca en una card blanca central, con etiqueta
«Cafetería actual», símbolo de establecimiento y contexto institucional. Todos
los datos proceden del mismo perfil existente. En escritorio la composición
equilibra el contexto del panel, la cafetería y Cerrar sesión; en tablet se adapta
a menú, card y acción; en móvil la card ocupa una fila completa.

Actualizar permanece junto al título del Dashboard: actúa sobre sus métricas,
sin introducir dependencias nuevas en el header ni duplicar peticiones.

## Nueva gráfica

Se sustituyen las líneas por dos barras agrupadas para cada día: entregados en
azul sólido y no recogidos con contorno y trama ámbar. La leyenda utiliza las mismas
formas, evitando depender solo del color. El SVG tiene título, descripción y
títulos nativos por barra con fecha, serie y conteo exacto.

La escala visual parte de cero y utiliza únicamente esas dos series. La función
de geometría acepta las claves visibles; su comportamiento predeterminado sigue
siendo compatible con las tres series anteriores. Esto solo cambia coordenadas
y escala del dibujo: no recalcula ni agrega métricas.

Los recibidos permanecen en sus KPIs y en la tabla diaria, que conserva las tres
columnas originales. Los conteos se mantienen como strings; el cálculo de escala
continúa usando BigInt y solo convierte una proporción acotada en píxeles.

Cada fecha conserva sus dos barras, incluso con rangos de 366 días. Para evitar
barras ilegibles, el gráfico permite desplazamiento local cuando el período no
cabe. La región es enfocable y se puede desplazar con teclado. No hay scroll
horizontal global, muestreo, datos sintéticos ni agrupaciones por semana.
El estado sin finalizaciones utiliza alturas cero y un mensaje explícito.

## Reducción de ruido

La fórmula de la tasa se conserva dentro de «Cómo se calcula la tasa». Las
explicaciones de importes históricos y participación también pasan a detalles
plegables. Permanecen visibles las aclaraciones breves sobre valores registrados
y cobros no confirmados. No se renombran importes como pérdidas o ingresos.

El texto introductorio se acorta. Las tarjetas evitan acentos repetidos en su
borde superior y mantienen cifras tabulares. La cobertura se sitúa al final de
la lectura; conserva todos los checks, advertencias y apertura automática ante
anomalías. El aviso de ausencia de eventos verificables sigue antes del resumen.
Los rankings no cambian datos, orden, nombres, totales ni criterios.

## Archivos modificados en esta iteración

Rutas relativas a `unifood-web`:

- `features/admin/components/AdminHeader.tsx`
- `features/admin/components/AdminSidebar.tsx`
- `features/admin/components/Admin.module.css`
- `features/admin-dashboard/components/AdminDashboard.tsx`
- `features/admin-dashboard/components/AdminDashboard.module.css`
- `features/admin-dashboard/components/DashboardSummary.tsx`
- `features/admin-dashboard/components/NotCollectedProducts.tsx`
- `features/admin-dashboard/components/OrdersTrend.tsx`
- `features/admin-dashboard/components/ProductsRanking.tsx`
- `features/admin-dashboard/presentation.ts`, solo parametrización de escala visual.
- `tests/admin-dashboard-ui.test.mjs`
- `tests/admin-profile.test.mjs`
- `tests/e2e/admin-dashboard.spec.ts`
- Este informe nuevo.

El CSS de Catálogo y el informe P4 anterior ya estaban pendientes al iniciar y
se conservan. Catálogo y Perfil reciben los tokens nuevos por el shell compartido.

## Accesibilidad y validación

Se conservan foco visible, navegación con teclado, drawer con Escape y devolución
del foco, tablas con caption/scope y estados anunciados. Las transiciones discretas
siguen condicionadas a `prefers-reduced-motion: no-preference`.

| Comprobación                   | Resultado                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Suite Node completa            | 518 aprobadas, 0 fallos, 0 omitidas                                                            |
| TypeScript                     | Aprobado                                                                                       |
| ESLint                         | Aprobado, cero advertencias                                                                    |
| Prettier                       | Aprobado                                                                                       |
| Build Next.js                  | Aprobado, API/Auth ficticios en loopback                                                       |
| E2E ADMIN completas            | 81 aprobadas, 0 fallos, 0 omitidas: Dashboard, navegación/Perfil, Catálogo, gestión e imágenes |
| E2E tras el ajuste móvil final | 11 aprobadas: barras frente al JSON, responsive, contraste, teclado, placeholders y 366 días   |

Las repeticiones no se suman como pruebas distintas. El build y los controles
estáticos se verificaron también tras el ajuste final. Logs en el directorio
temporal con prefijo `unifood-admin-worker-alignment-`; resultados de navegador
ignorados por Git en `test-results/admin-worker-alignment` y su variante `-final`.

Las dos pruebas Node nuevas comprueban la escala de las dos series, la conservación
de recibidos en tabla, precisión de conteos grandes y 732 barras para 366 días.
Las E2E comparan fecha, serie y conteo de cada barra con el JSON recibido del BFF,
verifican los placeholders sin rutas, el contexto de cafetería y el desplazamiento
del gráfico con teclado, incluido el rango máximo.

Las E2E ejecutan Edge y Next real en 3100 con Auth/backend simulados en 3101.
No representan una integración desplegada con Supabase ni pruebas con datos reales.
El backend no se vuelve a ejecutar, dado que esta fase no cambia sus fuentes.

## Responsive, capturas y preservación

Se verifican 390, 768 y 1440 px; las regresiones de Catálogo y Perfil también
incluyen otros anchos existentes. Las capturas se actualizan en los directorios
temporales `unifood-admin-p4-visual`, `unifood-admin-dashboard-visual` y los de
Catálogo/Perfil. Se inspeccionaron la vista inicial de Dashboard en 390 y 1440 px,
el gráfico en 390, 768 y 1440 px, el drawer de 390 px, Catálogo en 1440 px y Perfil
en 768 px. Las capturas finales muestran la semana completa en móvil sin scroll
y las explicaciones plegadas. Las capturas de teclado anteriores también muestran
el contorno de foco; no es un borde permanente del gráfico.

La comparación SHA-256 final conserva 624 de los 637 archivos iniciales: los
únicos 13 distintos son los archivos de frontend y pruebas enumerados arriba.
Se preservan backend, BFF, contratos, autorización, lógica de filtros, módulos
WORKER, recursos de marca y los tres archivos protegidos. No se editaron `.env`
ni datos reales. Los importes, conteos, porcentajes y orden de rankings siguen
correspondiendo al BFF; solo se cambian su presentación y la geometría del SVG.

## Pendientes

IA y Configuración son módulos futuros y carecen de comportamiento funcional.
Los tooltips SVG son nativos; el acceso completo con teclado está en la tabla.
Los períodos extensos requieren desplazamiento dentro del gráfico. Quedan fuera
de esta revisión dispositivos físicos, lectores de pantalla reales, otros motores
de navegador y la validación desplegada de staging descrita en P3.
