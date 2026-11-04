# Dashboard ADMIN — revisión integral P3

La rama está lista para organizar commits y abrir un Pull Request de revisión hacia
`develop`. No se encontraron bloqueos en las verificaciones locales ejecutadas.
La integración desplegada con Auth real y las pruebas de carga siguen pendientes;
este informe no certifica un despliegue en producción.

## 1. Estado de Git

- Rama: `feature/admin-dashboard`. HEAD: `e064a456b505141e50e2604dbd9b81be6892adfe`.
- Alcance final: 53 archivos nuevos del Dashboard y cuatro archivos existentes
  modificados. Incluye este informe y las pruebas añadidas durante P3.
- Los cuatro existentes son `app/admin/page.tsx`, `tests/roles.test.mjs`,
  `tests/helpers/auth-provider-server.mjs` y `tests/e2e/admin-foundation.spec.ts`,
  dentro de `unifood-web`. Sus cambios corresponden a montar el Dashboard y adaptar
  las pruebas y fixtures de navegación existentes.
- Sin staging, commits, push, PR ni cambios de rama. `git diff --check` aprobado.
- `REPORTE_CAMBIOS.md`, `admin-foundation-staging-backup.patch` y
  `flow-develop-check.ts` permanecen sin seguimiento y conservan sus SHA-256
  respecto del inicio de P3. Deben quedar fuera de los commits del módulo.
- Sin modificaciones ajenas al Dashboard. No se editaron `.env`, dependencias,
  migraciones ni configuración de arranque. El servidor habitual de 3000 no se
  utilizó para estas pruebas.

## 2. Archivos revisados

Revisión de los archivos del módulo, contratos, consultas, pruebas y documentación
de P1/P2-A/P2-B; lectura adicional de los helpers compartidos de identidad,
autorización, PostgreSQL temporal y configuración Playwright.

| Área              | Archivos o directorios principales                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrada Spring    | `AdminDashboardController`, `AdminDashboardResponse`, `AdminDashboardExceptionHandler`, `AdminDashboardSecurityConfig`                                                       |
| Aplicación Spring | Modelos `AdminDashboard`, `AdminDashboardPeriod`, `AdminDashboardRequest`; excepción; puertos `GetAdminDashboardUseCase`, `AdminDashboardQueryPort`; `AdminDashboardService` |
| Persistencia      | `AdminDashboardPersistenceAdapter`; SQL `events`, `daily`, `item-quality`, `date-quality`, `ranking`                                                                         |
| Pruebas Spring    | `AdminDashboardRequestTest`, `AdminDashboardServiceTest`, `AdminDashboardApiPostgresTest`                                                                                    |
| BFF               | `app/api/admin/dashboard/route.ts`; `features/admin-dashboard/{types,filters,contracts,errors,api}.ts`; `server/forward.ts`                                                  |
| Frontend          | `app/admin/page.tsx`; `presentation.ts`, `state.ts`, `useAdminDashboard.ts`; los ocho componentes y `AdminDashboard.module.css`                                              |
| Pruebas web       | Las seis suites `tests/admin-dashboard-*.test.mjs`, tres helpers de Dashboard y `tests/e2e/admin-dashboard.spec.ts`; los tres archivos de pruebas existentes modificados     |
| Documentación     | `unifood-backend/docs/admin-dashboard.md`, `admin-dashboard-bff.md`, `admin-dashboard-ui.md` y este informe                                                                  |

## 3. Resultados de pruebas

Los resultados siguientes corresponden a P3; no se suman ejecuciones repetidas.

| Verificación                                  | Resultado                                                | Naturaleza y límites                                                                                  |
| --------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Backend completo, Java 21: `mvnw.cmd -q test` | 615 aprobadas en 43 clases; 0 fallos, errores u omitidas | Unitarias e integración local; PostgreSQL 18 temporal y propio, Auth simulado                         |
| Subconjunto backend Dashboard                 | 77 aprobadas, incluidas en las 615                       | 30 de filtros, 13 de servicio y 34 de API/persistencia/contrato                                       |
| Suite web completa: `npm test`                | 516 aprobadas; 0 fallos u omitidas                       | Incluye 179 del Dashboard/BFF/frontend, fixtures y regresiones de otros módulos                       |
| E2E ADMIN sobre build de producción           | 50 aprobadas; 0 fallos u omitidas                        | 15 Dashboard, 20 Catálogo y 15 navegación/Perfil; Edge, Next real y proveedores simulados en loopback |
| TypeScript                                    | Aprobado                                                 | `tsc --noEmit --incremental false`                                                                    |
| ESLint                                        | Aprobado, cero advertencias                              | Archivos del módulo y pruebas existentes modificadas; `--max-warnings=0`                              |
| Prettier                                      | Aprobado                                                 | Código, pruebas y documentación del módulo                                                            |
| Spotless                                      | Aprobado                                                 | Archivos Java del Dashboard                                                                           |
| Build Next.js 16.3.8                          | Aprobado tras las correcciones                           | API/Auth ficticios en loopback; ruta del BFF dinámica                                                 |

La prueba de regresión del reloj falló antes de corregir el cliente y pasó después.
La primera ejecución ampliada de E2E tuvo 47 aprobadas y un fallo de contraste;
tras corregirlo y ampliar su cobertura a tres anchos, la ejecución completa aprobó
las 50. La comprobación final de contraste utiliza el umbral sin redondearlo.

Los logs locales están en el directorio temporal del sistema con prefijo
`unifood-dashboard-p3-`; los informes backend, en `target/surefire-reports`.
Playwright guarda resultados ignorados por Git en `test-results/dashboard-p3-final`.

## 4. Integración backend, BFF y frontend

Se añadió una comprobación de contrato que obtiene el JSON serializado por Spring
MVC a partir de consultas reales sobre PostgreSQL temporal y lo entrega por stdin
al validador TypeScript real. Comprueba igualdad completa de la proyección en siete
escenarios: vacío, normal, ítems incompletos, fechas defectuosas, nombre histórico
ausente, unidades/importes grandes y cabecera monetaria inválida. No utiliza una
copia manual del DTO como respuesta esperada. El transporte hasta el validador es
local y no representa una petición HTTP a un backend desplegado.

En navegador se captura la respuesta que realmente recibe la pantalla desde el
BFF y se comparan sus siete indicadores visibles del resumen, tres de la sección
de no recogidos, todas las filas diarias y ambos rankings. Estos E2E ejecutan el
BFF y el frontend reales; su backend y Auth son fixtures del proveedor local.

Los conteos, unidades, importes COP y porcentajes conservan precisión como strings.
El frontend formatea los valores recibidos y mantiene el orden histórico de los
productos. No recalcula métricas comerciales. La tasa conserva el denominador
entregados + no recogidos, y las bases de cabecera y detalle se explican por separado.

Se verificaron carga inicial, Hoy/7/30/Personalizado, fechas inclusivas de Colombia,
validación de rangos, cancelación y descarte de respuestas obsoletas, cero frente a
null, rankings vacíos o no disponibles, cobertura limitada y errores 401/403/503.
No hay imports de fixtures ni generación de datos ficticios en el código de
producción del módulo.

## 5. Seguridad

- El BFF verifica identidad mediante `getUser`, obtiene el bearer de la sesión
  correspondiente y exige que `current_auth_profile` coincida con esa identidad,
  esté activo y tenga exclusivamente ADMIN. Spring vuelve a autorizar con hechos
  de negocio actuales: usuario activo, rol único ADMIN y una sola cafetería.
- La cafetería se resuelve en el servidor. No se admiten selectores de usuario,
  cafetería, zona horaria ni instante de corte desde el caller. Las consultas
  parametrizadas acotan eventos e ítems por cafetería; se prueban pedidos ajenos,
  claims falsificados y líneas históricas incompatibles dentro de la base temporal.
- El navegador consulta una URL relativa del BFF. Solo el servidor envía el bearer
  verificado a Spring. No se reenvían cookies, host, tokens aportados por el caller
  ni encabezados de tenant. Los redirects upstream se rechazan.
- `Cache-Control: no-store` en resultados y errores; fetch sin caché; métodos BFF
  distintos de GET devuelven 405 con la misma política.
- Errores públicos sanitizados: se preservan los estados definidos, se normalizan
  408/429/504 a 503 y se limita `Retry-After`. No se propagan cuerpos internos,
  SQL, trazas, tokens, cabeceras privadas ni datos personales de estudiantes.
- Timeout de transacción Spring: 15 s; transporte BFF a Spring, incluida lectura
  del cuerpo: 15 s; cliente de navegador: 30 s. Las pruebas simulan expiración,
  desconexión y lectura abortada. No se midió latencia de infraestructura remota.
- Escaneo de archivos versionables del módulo sin hallazgos de alta confianza de
  claves privadas, secretos de proveedores, credenciales PostgreSQL o JWT literales.
  Revisión de proyecciones y respuestas para evitar datos privados. No equivale a
  un escaneo completo del historial Git.
- No se consultó ni escribió Supabase Production ni ninguna base externa real.
  Las inserciones, cambios de restricciones y borrados de fixtures pertenecen
  exclusivamente a clusters temporales creados y cerrados por las pruebas.

## 6. Calidad visual y accesibilidad

Inspección visual de capturas de la pantalla, el gráfico y los rankings en 390,
768 y 1440 px; comparación con Perfil y con los estilos compartidos de Catálogo.
Jerarquía, tarjetas, tipografía y navegación mantienen la identidad ADMIN.
No se realizó un rediseño.

Las E2E comprueban ausencia de overflow horizontal global, foco y activación con
teclado, navegación del drawer, devolución del foco y controles utilizables.
Tablas con caption y encabezados scope; regiones desplazables enfocables;
fieldset/legend y etiquetas de fechas; estados anunciados; gráfico con nombre,
series diferenciadas por trazos y tabla diaria alternativa. El contraste del texto
del estado cargado, incluidas las tablas y los detalles abiertos, se comprueba
contra el fondo calculado en los tres anchos. Los dos textos corregidos alcanzan
aproximadamente 4,82:1 sobre el fondo del shell.

Capturas en los directorios temporales `unifood-admin-dashboard-visual`,
`unifood-admin-foundation-visual` y `unifood-admin-catalog-visual`. La inspección de
capturas es manual; la interacción de teclado y las mediciones son automatizadas.
No se certifica conformidad WCAG completa ni uso con lectores de pantalla reales.

## 7. Defectos encontrados y corregidos

1. **Período válido rechazado por reloj del navegador atrasado.** `api.ts` usaba
   el reloj local para volver a comprobar fechas futuras. Ahora utiliza la misma
   validación estructural sin reloj local; el BFF y Spring mantienen la restricción
   de futuro. El formulario sigue usando el corte publicado por el backend.
   Corregido en `api.ts` y `filters.ts`, con regresión en la suite del cliente.
   No se modificó el contrato HTTP ni la lógica de métricas.
2. **Contraste insuficiente en introducción y fecha de actualización.** Dos estilos
   tenían relaciones de 4,48:1 y 4,25:1 sobre `#f5f8fc`. Se ajustaron únicamente
   esos colores en `AdminDashboard.module.css`. Se añadió una regresión en tres
   anchos, sin alterar distribución, otros módulos ni estilos globales.

P3 también añadió el puente de contrato Spring/TypeScript, la comparación de
valores BFF/pantalla y capturas de la vista inicial. No incorporó funcionalidades.

## 8. Validaciones pendientes

- Un flujo HTTP completo con Next, Spring y Auth desplegados en staging autorizado,
  incluida renovación/expiración real de sesiones y configuración CORS/issuer.
- Latencia, planes SQL y concurrencia con volumen representativo en una copia
  controlada de staging. No ejecutar pruebas que creen pedidos en producción.
- Recorrido manual con lector de pantalla y dispositivos físicos; otros motores
  de navegador. Las E2E de esta revisión utilizaron Edge.
- Procedencia comercial de registros históricos, cobertura del histórico completo
  y pagos: siguen sin certificarse, tal como informa la interfaz.

## 9. Riesgos para producción

El contrato de cobertura es estricto: incorporar códigos nuevos requiere coordinar
backend y BFF para evitar 502. Los relojes de BFF y Spring deben mantenerse
sincronizados. El timeout de transporte y el de transacción comparten 15 segundos;
su margen real debe evaluarse con latencia y carga de staging. Los resultados
históricos pueden contener cobertura incompleta y no acreditan dinero cobrado ni
procedencia real; la UI lo conserva explícitamente.

No hay un defecto funcional o de seguridad confirmado pendiente de corrección
dentro del alcance revisado. Los resultados locales no garantizan la configuración
ni el rendimiento del entorno de producción.

## 10. Preparación de commits y Pull Request

Lista para organizar los commits de P1/P2-A/P2-B y las correcciones/pruebas de P3,
y preparar un PR de revisión hacia `develop`, excluyendo los tres archivos
protegidos. La integración definitiva y el despliegue requieren completar los
controles de staging y la revisión del equipo. No se creó ningún commit ni PR.
