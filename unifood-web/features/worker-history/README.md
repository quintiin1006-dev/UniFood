# Historial WORKER del día

`WorkerHistoryPanel` se monta exclusivamente en Historial dentro de `/worker`.
El navegador consulta el BFF `GET /api/worker/orders/history/today`; este verifica
la sesión y el rol WORKER exclusivo y reenvía únicamente el Bearer verificado al
endpoint homónimo de Spring. Spring resuelve cafetería, día y estados terminales.
No se consultan tablas de negocio por Supabase REST ni el catálogo actual.

`contracts.ts` valida y selecciona el DTO publicado tanto en BFF como en browser.
Un pedido activo, UUID duplicado o dato inválido invalida toda la respuesta; no
se ocultan entradas defectuosas como si el historial estuviese vacío. Se conserva
el orden recibido y los nombres/importes de los snapshots, sin recalcular totales.
La referencia corta es visual; la identidad de cada tarjeta sigue siendo su UUID.
Las órdenes históricas sin detalle de items siguen siendo representables.
Los importes COP conservan los centavos cuando un snapshot `NUMERIC(12,2)` los
contiene; el formato habitual sin decimales se reutiliza para pesos enteros.

`WorkerHistoryStore` concentra el estado y el ciclo de consultas, con un runtime
inyectable para probar los timers sin esperas reales. Consulta al entrar, al volver
el foco/visibilidad, cada 30 segundos visible y al alcanzar `nextBusinessDateAt`.
Una petición en vuelo agrupa los disparadores repetidos. Al salir se aborta y se
invalidan respuestas tardías; se eliminan timers y listeners. Un nuevo día reemplaza
el snapshot completo. La fecha mostrada procede de `businessDate`; el reloj usa
explícitamente `America/Bogota`. El reloj del browser solo agenda la siguiente
consulta. Si está desajustado o Spring aún devuelve un límite pasado, se evita
un bucle inmediato reintentando mediante la cadencia de 30 segundos.

Todas las consultas/respuestas usan `no-store`, timeout y redirects bloqueados.
Un 503 mantiene la sesión; permite reintento y muestra explícitamente si se
conserva una consulta previa. Un 401 oculta datos y ofrece `/panel/login`; un 403
oculta datos y deniega acceso. Ambos detienen las consultas automáticas. El módulo
no borra cookies ni redirige automáticamente. Los mensajes upstream nunca se muestran.

La superficie clara se limita a Historial, con el ancho máximo de Disponibilidad,
tarjetas de tres/dos/una columnas, etiquetas e iconos de estado, foco visible y
estados de carga/error/vacío accesibles. El polling de pedidos activos se habilita
solo en Pedidos y Llamadas, sin cambiar las transiciones ni sus reglas.

Pruebas: `tests/worker-history-*.test.mjs` cubren contrato, BFF, API, estado y
presentación. `tests/e2e/worker-history.spec.ts` usa exclusivamente el proveedor
loopback de pruebas y comprueba integración y tamaños 390/768/1366. La captura
opcional `WORKER_HISTORY_VISUAL_AUDIT=1` escribe imágenes en el directorio temporal
del sistema, nunca dentro del repositorio.
