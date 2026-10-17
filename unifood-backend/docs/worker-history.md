# Historial WORKER del día

`GET /api/worker/orders/history/today` consulta únicamente los pedidos terminales de
la cafetería autorizada del WORKER durante el día de negocio actual. El endpoint
Spring, el BFF Next y la UI WORKER dentro de `/worker` están implementados.
El recorrido es Browser → Next/BFF → Spring → PostgreSQL, sin acceso directo del
frontend a tablas de negocio Supabase.

## Identidad y fecha

La identidad procede del subject del JWT verificado. La autorización compartida
consulta usuario activo, rol exclusivamente WORKER y exactamente una cafetería
asignada. Claims de rol/cafetería y parámetros del navegador no cambian esa
autoridad. CLIENT, ADMIN, SUPER_ADMIN y perfiles inválidos reciben 403; una
autenticación ausente o inválida recibe 401 según la seguridad existente.

El caso de uso captura `TimeProvider.now()` una vez y reutiliza `BusinessDate`
en `America/Bogota`. Calcula inicio incluido y siguiente inicio excluido desde
el calendario local; no usa la zona del host, `CURRENT_DATE` ni una fecha del
navegador. La respuesta incluye `businessDate` y `nextBusinessDateAt` como instante
ISO que el frontend usa para solicitar una nueva lectura al cambiar el día.
Si una petición cruza medianoche, su respuesta conserva una fotografía coherente
con el instante capturado; la siguiente petición obtiene el nuevo día.

La UI muestra la fecha suministrada por Spring y las horas en `America/Bogota`.
Consulta al entrar en Historial y al recuperar foco o visibilidad, con polling
cada 30 segundos mientras Historial está visible y refresh mediante
`nextBusinessDateAt`.

## Selección y snapshots

El puerto de lectura específico usa una sola consulta parametrizada con tres
ramas UNION ALL, cada una restringida a la cafetería autorizada y su timestamp:

| Estado | Fecha terminal |
|---|---|
| DELIVERED | delivered_at |
| NOT_COLLECTED | not_collected_at |
| CANCELLED | cancelled_at |

El rango es `[dayStart, nextDayStart)`. Una orden creada ayer y finalizada hoy
pertenece a hoy; PENDING, PREPARING, READY y CALLED no pertenecen al historial.
No se usan `created_at`, `updated_at` ni otro timestamp como fallback. Los
terminales con fecha desconocida permanecen en DB y quedan fuera de la consulta.

Las órdenes se ordenan por fecha terminal DESC y UUID completo DESC. Los items
se unen en la misma SELECT y se ordenan por su UUID para mantener una presentación
estable, sin N+1. Se devuelven nombre, cantidad, precio unitario y subtotal de
`order_items`; nunca se reconstruyen desde el catálogo actual. Una orden sin
items devuelve una lista vacía, sin desaparecer por el JOIN.

## Contrato y errores

La respuesta contiene `businessDate`, `nextBusinessDateAt` y `orders`. Cada orden
incluye `id`, `reference`, `clientName`, `status`, `completedAt`, `total` e `items` con `name`,
`quantity`, `unitPrice` y `subtotal`. `clientName` procede de `orders.client_name`,
el nombre almacenado del pedido usado también por las operaciones WORKER; un nombre
vacío se representa como null, sin inventar identidad. No requiere JOIN a `clients`
ni consultas adicionales. No incluye email, teléfono, documento, notas, IDs de usuario,
de cafetería, IDs de productos ni otros datos operativos innecesarios.

`reference`, por ejemplo `Pedido · A91C6F2D`, deriva de los primeros ocho caracteres
hexadecimales del UUID. Es solo una etiqueta visual: puede colisionar, no es un
número comercial y no sustituye al UUID para identidad o autorización.

Las respuestas del controller y su advice usan `Cache-Control: no-store`.
Los fallos temporales de conexión/transacción devuelven 503 con
`WORKER_HISTORY_TEMPORARILY_UNAVAILABLE` y `Retry-After: 5`; un error inesperado
devuelve 500 con `WORKER_HISTORY_INTERNAL_ERROR`. Los mensajes públicos no exponen
SQL, identificadores privados ni stack traces. El advice está acotado a este
controller y conserva los contratos de otros módulos.

La lectura es transaccional read-only y no cambia estados, cancelaciones, FIFO,
locks ni Availability. No añade migraciones, índices o escrituras remotas. El
conjunto diario aún no está paginado: medir volumen y plan de ejecución antes de
introducir índices o paginación si la escala futura lo requiere.

El buscador de la UI filtra en memoria el snapshot diario por referencia, nombre
de cliente y estado técnico o etiqueta española, ignorando mayúsculas, acentos y
espacios exteriores. No envía consultas por pulsación ni cambia cafetería, fecha
o estados del endpoint. El texto se conserva al refrescar el snapshot.
