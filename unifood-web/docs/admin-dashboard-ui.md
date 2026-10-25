# Dashboard ADMIN — frontend P2-B

`/admin` reemplaza Próximamente por el dashboard real, manteniendo requireAdmin,
AdminShell, header, navegación, perfil compartido y aviso de cafetería inactiva.
No cambia el backend P1 ni los contratos, filtros, cliente HTTP o BFF P2-A.

## Interfaz y datos

Componentes en features/admin-dashboard/components: AdminDashboard,
DashboardPeriodFilter, DashboardSummary, OrdersTrend, ProductsRanking,
DeliveredProductsRanking, NotCollectedProducts y DashboardCoverage. CSS Modules
limita los estilos a esta feature: tarjetas blancas, bordes suaves, azul del shell
y acentos ámbar para seguimiento de no recogidos; sin gradientes ni framework nuevo.

El resumen muestra los cuatro conteos solicitados, ambos valores nominales y la
tasa proporcionada por Spring. El denominador y la explicación de la tasa son
visibles. Se utilizan las fuentes de cabecera y de líneas por separado; no se
presentan ventas, ingresos cobrados o pérdidas económicas.

No recogidos tiene una sección prioritaria con pedidos, unidades, valor de
cabecera, Top de productos, participación sobre todo el universo y explicación
de diferencias con subtotales históricos. Ambos rankings conservan el orden y
los nombres históricos del backend; muestran totales y omitidos cuando corresponde.

## Gráfico y precisión

No había librería de gráficos instalada. Para tres series diarias (máximo 366
puntos por serie) se eligió SVG nativo con React, evitando una dependencia y
ofreciendo control directo de accesibilidad. No se añadieron paquetes ni cambios
de lockfile. Las líneas son rectas, sin suavizado, y consumen trend sin agregación.

La escala empieza en cero y usa enteros BigInt para máximos y marcas. Solo se
convierte a Number una proporción acotada para coordenadas de pantalla; ningún
conteo ni importe financiero pierde dígitos. Los ejes muy grandes se abrevian con
un indicador aproximado; los valores exactos permanecen en la tabla accesible.
ResizeObserver adapta el viewBox al ancho real para mantener legibles los textos
en móvil. La leyenda usa colores y patrones distintos. SVG tiene título/descripción;
una tabla desplegable permite consultar todas las fechas y cantidades con teclado.

presentation.ts formatea conteos con puntos de miles y COP con centavos exactos,
sin convertir los strings a float. Los porcentajes se muestran tal como llegan,
con coma decimal. null se presenta como No calculable o Sin base de cálculo,
según el indicador. Cero conserva su significado propio.

## Filtros y solicitudes

Los presets envían range y rankingLimit=10. No construyen límites diarios con la
zona horaria del navegador. El personalizado utiliza fechas explícitas del usuario,
valida formato/orden/máximo 366 días y usa la última referencia asOf del backend
para su fecha máxima. BFF y Spring conservan su validación independiente. Sin una
referencia inicial, no se inventa una fecha de negocio; el servidor valida la petición.

La pantalla muestra el período efectivo, corte y condición parcial de la respuesta,
con hora de Colombia. Al editar fechas personalizadas, el texto indica que deben
aplicarse antes de actualizar los resultados.

AdminDashboardStore utiliza exclusivamente adminDashboardApi.get(filters,signal).
Cada lectura aborta la anterior y elimina los datos previos mientras carga.
Solo la solicitud vigente puede publicar resultados o errores. Un fallo no restaura
datos de otro período. Dispose invalida respuestas pendientes y soporta remonte
de Strict Mode. Se consulta al entrar, al recuperar foco/visibilidad y mediante
Actualizar; no hay polling ni métricas recalculadas en el navegador.

401 ofrece login y 403 retira el contenido sin ofrecer reintento de permisos.
Ambos bloquean relecturas automáticas de esa instancia. 400/500/502/503 muestran
error seguro y permiten reintentar. Los filtros siguen utilizables durante carga,
permitiendo sustituir una petición lenta. No se borra la sesión por errores temporales.

## Cobertura

La advertencia resumida de cobertura limitada siempre está presente. Los detalles
permanecen plegados cuando solo hay limitaciones generales y se abren al detectar
WARN. Se muestran todas las advertencias mediante mensajes comprensibles y los
quince checks con alcance, población examinada/afectada y estado interpretado.
No se publican códigos técnicos, SQL ni información personal.

- UNKNOWN: procedencia real/de prueba no certificada.
- NOT_CHECKED: revisión no ejecutada; sin inventar cero incidencias.
- PASS con población cero: sin pedidos examinables en ese alcance.
- UNAVAILABLE_INCOMPLETE_ITEMS: explicación de ranking no disponible, sin tabla
  falsamente vacía ni un Top parcial.
- AVAILABLE vacío: sin unidades verificables en el período.
- NO_VERIFIABLE_EVENTS: mensaje explícito de que la cobertura limitada no confirma
  ausencia total de actividad.

## Responsive y accesibilidad

Grids adaptativos, foco visible, etiquetas de fechas, fieldset/legend, botones con
aria-pressed, estados de carga role=status y errores role=alert. Tablas con caption
y encabezados scope, regiones desplazables enfocables y nombres históricos alternativos.
El scroll horizontal se limita a tablas locales; no se amplía el viewport global.
Los importes y nombres extensos pueden partir línea. No se depende solo del color.

## Pruebas y preservación

Pruebas nuevas: admin-dashboard-state.test.mjs, admin-dashboard-ui.test.mjs y
tests/e2e/admin-dashboard.spec.ts. El helper nuevo admin-dashboard-ui-fixture.mjs
solo es usado por el servidor de pruebas loopback, que ahora simula ese endpoint.
No hay datos simulados en el runtime de la aplicación.

Se ajustaron únicamente las expectativas obsoletas de Próximamente en las pruebas
de navegación ADMIN y el mock de página de las pruebas de roles. El servidor de
fixtures mantiene su aislamiento en 3101; Next de pruebas usa 3100. No se interviene
el servidor habitual de 3000 ni Supabase Production.

Resultados ejecutados:

| Verificación                                                              | Resultado                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Estado, presentación y renderizado nuevos                                 | 23 pruebas aprobadas                                         |
| Suites Node seleccionadas (incluidas las nuevas, P2-A y ADMIN existentes) | 217 aprobadas, 0 fallos, 0 omitidas                          |
| E2E Dashboard nuevas                                                      | 11 aprobadas                                                 |
| E2E Dashboard + navegación/perfil ADMIN + Catálogo                        | 46 aprobadas, 0 fallos, 0 omitidas                           |
| TypeScript y build Next.js                                                | Aprobados con configuración ficticia loopback                |
| ESLint de archivos de esta fase                                           | Aprobado con cero advertencias                               |
| Visual y teclado                                                          | 390, 768 y 1440 px; navegación ADMIN adicional hasta 1920 px |

Se revisaron capturas de móvil y escritorio en el directorio temporal
unifood-admin-dashboard-visual. Se corrigieron una advertencia de React por títulos
SVG con varios nodos y un error de lint en el nombre de una variable de prueba.
La escala gráfica se adapta al ancho real para que sus etiquetas no se reduzcan
al escalar todo el SVG en móvil. Las pruebas cubren errores 401/403/503, reintento,
respuestas lentas/obsoletas, fechas personalizadas, ceros/nulos, detalle incompleto
y números grandes. No equivalen a una auditoría WCAG ni a validación manual con
todos los lectores de pantalla.

Los 37 archivos
previos (21 P1, 13 P2-A y tres protegidos) se comparan mediante SHA-256 contra la
línea base inicial. No se modifica .env ni se realiza staging/commit.

No se certifican procedencia comercial, integridad del histórico completo ni pagos.
Las E2E integrales con Auth y Spring desplegados siguen requiriendo un entorno de
staging autorizado y datos controlados; no deben generar pedidos en producción.
