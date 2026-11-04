# UniFood ADMIN — P4.1: presentación compacta y UX

> **Histórico.** Registro de esta iteración, superada por las siguientes. El
> estado vigente del panel se describe en [P4.2](admin-panel-p42.md).

## 1. Rama y estado inicial

Rama `feature/admin-dashboard`; HEAD `618d47c149c31cbd01cd9e593053b0b8f16ed645`.
Al iniciar había 14 archivos versionados modificados, los dos informes visuales
anteriores nuevos y tres archivos protegidos sin seguimiento. Se conservaron los
cambios P4, refinándolos sobre su estado actual. Índice vacío; sin commits, push,
PR, merge, rebase ni cambios de rama.

Se tomó una línea base SHA-256 de 638 archivos, incluidos los pendientes anteriores
y los protegidos, antes de editar.

## 2. Archivos de P4.1

Rutas relativas a `unifood-web`:

| Área               | Archivos                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell              | `features/admin/components/AdminSidebar.tsx`, `AdminHeader.tsx`, `Admin.module.css`                                                                                              |
| Dashboard          | `features/admin-dashboard/components/AdminDashboard.tsx`, `AdminDashboard.module.css`, `DashboardSummary.tsx`, `DashboardCoverage.tsx`, `OrdersTrend.tsx`, `ProductsRanking.tsx` |
| Presentación       | `features/admin-dashboard/presentation.ts`: formato de fechas; sin cambios monetarios o comerciales                                                                              |
| Componentes nuevos | `features/admin-dashboard/components/DashboardInfo.tsx`, `DashboardPeriodLabel.tsx`                                                                                              |
| Pruebas            | `tests/admin-dashboard-ui.test.mjs`, `tests/admin-profile.test.mjs`, `tests/e2e/admin-dashboard.spec.ts`                                                                         |
| Informe            | Este archivo                                                                                                                                                                     |

Son 13 archivos de la línea base modificados y tres nuevos. Los otros 625 archivos
conservan su hash, incluidos backend, BFF, contratos, lógica de filtros, sesión,
autorización, módulos WORKER y recursos originales de marca. El CSS de Catálogo,
el componente NotCollectedProducts y los informes anteriores ya estaban pendientes
y no se modificaron en P4.1.

`REPORTE_CAMBIOS.md`, `admin-foundation-staging-backup.patch` y
`flow-develop-check.ts` permanecen intactos y fuera del índice. No se editaron `.env`
ni datos reales.

## 3. Sidebar: color exacto

Se extrajo `#0868E9` del estado activo anterior y de
`components/worker/BottomNav.module.css`. Ahora es el fondo del sidebar y drawer;
reemplaza al azul marino como superficie principal. No se modifica WORKER.

## 4. Selección translúcida

El ítem activo utiliza blanco al 4 %, borde blanco sutil, indicador lateral blanco
y peso tipográfico mayor. El hover utiliza blanco al 3 %. No hay un segundo
rectángulo azul sólido, blur ni sombra intensa. El foco es blanco y explícito.

La opacidad baja preserva contraste: el blanco sobre el fondo activo compuesto
alcanza aproximadamente 4,73:1, y sobre el sidebar base, 5,04:1. La medición E2E
compone capas alfa antes de calcular la relación; no trata RGBA como un fondo opaco.

## 5. Orden final de navegación

Dashboard → Catálogo → Asistente IA → separador → Mi perfil.
Los tres enlaces existentes conservan sus rutas y autorización. IA es información
visible con «Próximamente», sin enlace, acción ni chat simulado; no introduce una
parada de tabulación que aparente funcionalidad.

## 6. Configuración y tarjeta inferior

Se elimina el placeholder Configuración del menú. La inspección de las rutas y
componentes ADMIN no encontró una pantalla funcional de Configuración que debiera
preservarse. Mi perfil continúa accesible.

Se retira completamente la tarjeta «TU ESPACIO UNIFOOD / Tu cafetería, en un solo
lugar», sin sustituirla por otra promoción. Esto libera altura para la navegación.

## 7. Marca

UniFood completo en blanco, con Administración en un blanco ligeramente suavizado
y menor tamaño. Se conserva `unifood-pantalla.png`, transparente, y su presentación
con `object-fit: contain`. No se editan ni generan imágenes.

## 8. Header

Superficie blanca compacta: icono sutil, cafetería real, sede e institución a la
izquierda; Cerrar sesión a la derecha. Se retiran ADMINISTRACIÓN, Tu espacio de
trabajo y la etiqueta repetitiva Cafetería actual. No queda una card gigante dentro
del header. En móvil la acción se presenta con su icono y conserva el nombre
accesible del botón existente. La lógica de sesión permanece intacta.

## 9. Espacio vertical

Header con mínimo de 76 px; márgenes de contenido, título y bloques reducidos.
Se elimina TU CAFETERÍA EN CIFRAS y se utiliza «Dashboard / Resumen de pedidos y
productos», junto a Actualizar. La E2E de 1440 × 640 comprueba que la etiqueta del
primer KPI aparece antes de 380 px y que Mi perfil sigue dentro del viewport.

## 10. Períodos

Se conserva el selector segmentado con los cuatro rangos y sus handlers originales.
Se elimina el contenedor blanco grande: el selector ajusta su ancho al contenido,
se alinea con la fecha en escritorio y se adapta a dos filas en móvil. Los controles
personalizados conservan validación, límites y semántica existentes.

## 11. Fecha aplicada

La cápsula de calendario usa exclusivamente `period.from` y `period.to` del BFF.
Admite formatos como «25 oct 2026», «19–25 oct 2026» y rangos que cruzan mes o
año; estos son ejemplos de formato, no valores fijados en la aplicación.

No hay líneas permanentes de Actualizado, Hora de Colombia, Valores en COP o Período
aplicado. El instante de consulta sigue en la información del botón Actualizar y en
un disclosure accesible de la fecha. Un punto discreto con nombre accesible conserva
la semántica de período en curso; sus detalles explican el corte real.

## 12. Explicaciones

La fórmula de la tasa y su denominador se consultan mediante el icono informativo
de la tarjeta, con click, teclado y Escape. El subtítulo queda en «Sobre pedidos
finalizados»; la explicación precisa sigue excluyendo activos y cancelados.
Se conservan las aclaraciones breves de importes registrados y cobros no confirmados.
Los detalles históricos y de participación continúan accesibles bajo demanda.

## 13. Advertencias

El vacío se resume en «Sin eventos verificables · Cobertura limitada», con detalle
expandible que explica que no certifica ausencia total de actividad. La cobertura
tiene una fila compacta «Cobertura limitada · Ver detalles», conservando warnings,
checks y su apertura ante anomalías.

No calculable, ranking no disponible y errores de carga/autorización siguen visibles
con sus acciones existentes. Se mantiene la distinción entre cero, null, no
comprobado, procedencia desconocida y ranking incompleto, sin mostrar códigos internos.

## 14. Barras agrupadas

Tres barras por cada fecha de `trend[]`: recibidos, entregados y no recogidos.
Nunca se apilan ni se suman categorías que pueden superponerse. Escala entera desde
cero, SVG nativo, leyenda sencilla y tabla diaria accesible con las tres series.
La trama distingue no recogidos además del color. Los rangos largos se desplazan
dentro del gráfico, sin agregación o eliminación de fechas.

Un punto de foco por día se recorre con flechas/Home/End; el gráfico desplaza el
grupo consultado a la vista. El tooltip muestra los tres conteos y se cierra con
Escape. Ratón y toque también permiten consultar el día. Solo un grupo está en el
orden de tabulación; no se crean 1098 paradas para el rango de 366 días.
Los conteos grandes siguen usando BigInt para coordenadas y strings para mostrarse.

## 15. KPI y rankings

Cifras protagonistas, etiquetas cortas, números tabulares y acentos compartidos.
Se mantiene la prioridad de no recogidos. Sus tablas añaden una barra de participación
discreta cuya anchura utiliza el porcentaje ya recibido; no recalcula participaciones.
Los porcentajes textuales siguen accesibles. Valores, unidades, nombres históricos,
orden y totales de los rankings se conservan. El estado incompleto explica la
limitación sin presentar un Top parcial como fiable.

## 16. Accesibilidad y responsive

Verificación en 390, 768 y 1440 px, más escritorio de 640 px de altura. Foco visible,
drawer con Escape/retorno del foco, fechas etiquetadas, tablas con caption/scope,
información contextual de teclado y movimiento reducido. Sin overflow horizontal
global. El contraste de texto incluye sidebar, transparencias y las tres vistas
principales. No constituye una certificación WCAG completa con lectores reales.

## 17. Pruebas

| Comprobación        | Resultado P4.1                               |
| ------------------- | -------------------------------------------- |
| Suite Node completa | 519 aprobadas, 0 fallos, 0 omitidas          |
| E2E ADMIN           | 83 aprobadas, 0 fallos, 0 omitidas           |
| TypeScript          | Aprobado                                     |
| ESLint              | Aprobado, cero advertencias                  |
| Prettier            | Aprobado                                     |
| Build Next.js       | Aprobado con servicios ficticios en loopback |

La primera ejecución Node encontró una aserción que contaba la aparición de Cerrar
sesión en un atributo title como si fuera otro botón; se ajustó para comprobar el
control real y se repitió la suite completa. No fue un cambio de lógica de sesión.

Las E2E cubren Dashboard, navegación/Perfil, Catálogo, gestión e imágenes. Comparan
cada barra con el JSON del BFF y comprueban fechas compactas, rangos largos,
warnings, estados desconocidos, errores, teclado, tooltips, contraste y poca altura.
Usan Edge, Next real en 3100 y Auth/backend simulados en 3101. Las operaciones
de gestión actúan sobre fixtures. No se valida un entorno Supabase desplegado.
El backend no se repitió: no cambia en esta fase.

Logs temporales `unifood-admin-p41-*`; artefactos ignorados por Git en
`test-results/admin-p41`.

## 18. Capturas revisadas

Se inspeccionaron las capturas actualizadas de Dashboard inicial en 390 y 1440 px,
drawer móvil en 390 px y gráfico/indicadores en 768 px. Están en los directorios
temporales `unifood-admin-dashboard-visual` y `unifood-admin-p4-visual`, reutilizados
por las pruebas. Las imágenes muestran el estado real renderizado con fixtures;
la inspección visual es manual y las interacciones se validan mediante E2E.

## 19. Riesgos y pendientes

Asistente IA sigue sin implementación y se anuncia como futuro. Rangos extensos
requieren scroll local. Dispositivos físicos, lectores de pantalla reales y otros
motores de navegador quedan pendientes, junto a las validaciones de staging de P3.
No se encontraron defectos funcionales pendientes en el alcance ejecutado.
No se crearon commits ni se modificaron datos reales.
