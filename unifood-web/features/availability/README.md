# Disponibilidad WORKER

El módulo conserva la navegación por estado de `/worker`; sustituye Inventario y
oculta la búsqueda de pedidos al entrar. Pedidos y Llamadas mantienen sus vistas.

Browser → rutas Next `/api/worker/availability/today` → Spring → PostgreSQL.
Las dos rutas PUT añaden `/items/{itemId}` y `/cafeteria-state`. El BFF reutiliza
sesión verificada y rol exclusivo WORKER, exige sameOrigin para PUT, valida un único
booleano y `X-Business-Date`, y solo envía el token verificado y campos publicados.
No solicita un cafeteriaId ni consulta tablas/RPC de negocio en Supabase.
Spring continúa resolviendo cafetería, actividad administrativa y día de negocio.

La fecha visible y el header se toman del GET. Su validación de formato no decide
qué día es hoy. El estado mantiene dos capas: el último dato confirmado y un
overlay optimista temporal por recurso. El switch refleja la intención al pulsarlo,
con «Guardando…» y ese control bloqueado hasta recibir respuesta. Un éxito actualiza
solo su dato confirmado; un rechazo retira solo su overlay y vuelve al último valor
confirmado. Recursos diferentes pueden mutarse en paralelo. Un GET espera a que
terminen los PUT pendientes para evitar lecturas anteriores a sus confirmaciones.
El overlay no se persiste localmente y se elimina al abandonar el módulo.

Ante 409, 404 o un fallo de guardado, el módulo sincroniza con GET. Durante esa
sincronización no inicia nuevas escrituras. Día vencido reemplaza fecha y estados,
sin repetir automáticamente una intención del día anterior. Si GET falla conserva
el último estado confirmado, bloquea cambios y ofrece Reintentar. Un 503 no limpia
sesión ni redirige a login. El BFF filtra mensajes, DTOs y headers; no reenvía cookies
de negocio, cuerpos técnicos o campos arbitrarios del backend.

Las cinco categorías se mantienen visibles, incluso vacías. Los carruseles usan
overflow y scroll-snap nativos, botones de 44px, teclado (flechas, Home y End), foco
visible y scroll táctil/trackpad. No hay autoplay ni biblioteca adicional.
Las tarjetas reservan una foto 3:2; `next/image` muestra únicamente una ruta raster
local suministrada por backend. Ausencia, fallo o URL remota aún no autorizada usa
el mismo espacio con «Sin imagen». No se asignan fotos CLIENT como sustitución.

No existen orígenes remotos configurados. Antes de habilitarlos debe conocerse el
origen real y añadirse un remotePattern preciso de protocolo, host y ruta; nunca
un wildcard global. No hay uploads ni Supabase Storage en esta fase. El BFF es
servidor, por lo que no requiere cambiar CORS de Spring para X-Business-Date.

El layout conserva la marca y componentes WORKER, con una superficie gris clara
y un contenedor centrado de hasta 1320px. El resumen separa nombre, fecha, actividad
administrativa y apertura operativa. Cada categoría tiene una superficie blanca y
tarjetas de 240px en desktop/tablet. Una tarjeta única se centra dentro de su
categoría sin estirarse; las categorías con varios productos mantienen el carrusel.
Solo Disponibilidad evita la escala histórica 0.7 y el logo de fondo para conservar
legibilidad y tamaño táctil. El contenido desplaza dentro del espacio reservado por
Header/BottomNav. Las transiciones de 160ms respetan prefers-reduced-motion.
No cambia el layout de Pedidos. Disponibilidad no modifica catálogo ni usa stock.

`npm test` incluye contratos, BFF, estado concurrente y render semántico. Las pruebas
de navegador usan Next y el BFF reales con el proveedor/backend sintético de loopback;
prueban persistencia en la fixture, no escritura remota ni validación criptográfica
Supabase. `tests/e2e/worker-availability.spec.ts` cubre interacción y geometría en
móvil, tablet y desktop, cambios optimistas, rollback, errores recuperables y contexto
vencido. Las capturas visuales se guardan fuera del repositorio, en un directorio
temporal; no son baselines versionadas.
