# Cliente: menú, carrito y checkout

Estado tras el PR 2 del cliente. Contratos en `docs/decisiones.md` §11; este documento
describe cómo los consume el frontend.

## Datos

- Contexto: `GET /api/me/context` (sedes, cafeterías suscritas y si están abiertas).
- Menú: `GET /api/me/menu?cafeteriaId=` (categorías y productos con `available`).
- Pedido: `POST /api/me/orders` con `Idempotency-Key`. Las páginas leen en el servidor
  (`server/context.ts`, `server/menu.ts`); el carrito, que es de cliente, lee el menú de su
  cafetería con `hooks/useCafeteriaMenu` a través del BFF. Los textos de Spring no llegan a
  la pantalla.
- No hay horarios de cafetería ni franjas: abrir y cerrar lo decide el worker, y el
  backend responde `CAFETERIA_CLOSED`.

## Selección de cafetería

La cafetería vive en la URL (`/cuenta?cafeteria=<uuid>`) y se valida contra el contexto en
cada petición. Un paso con una sola opción se salta; el selector queda visible y abre las
opciones con `/cuenta?elegir=1`. `localStorage` (`unifood.client.cafeteria.v1`) solo recuerda
la última. **Pendiente de backend:** §4 y §11 dicen que el contexto devuelve `preference` y
que existe `PUT /api/me/preference`; ninguno existe todavía.

## Carrito

- Líneas por `cafeteriaId` + `productId`; solo se guardan ids y cantidades, nunca precios ni
  notas. Una cafetería por carrito; cambiar pide confirmación.
- Límites de §6: 10 unidades por producto y 15 en total. Se puede mezclar desayuno y almuerzo.
  No hay stock en el cliente: manda la disponibilidad diaria del worker.
- Almacenamiento `unifood.client.cart.v2` (v1 se descarta). `unifood:logout` y los eventos
  `storage` sincronizan la limpieza entre pestañas.
- Reducir o quitar una línea siempre se permite; aumentar vuelve a comprobar que la cafetería
  esté abierta y el producto disponible.

## Checkout (`/cuenta/carrito/resumen`)

- **Hora:** por defecto «Lo antes posible». «Elegir hora» muestra un selector de hora que solo
  admite horas de hoy posteriores a la actual en hora de Bogotá; se envía
  `requestedPickupAt` en ISO-8601 con offset (`-05:00`). Es informativa y no cambia el orden
  de atención. Spring la valida otra vez (`INVALID_PICKUP_TIME`).
- **Nota:** una sola por pedido, hasta 200 caracteres (se cuentan caracteres, no bytes).
- **Cuerpo:** `{cafeteriaId, items:[{productId, quantity}], note?, requestedPickupAt?}`. Precios,
  totales y disponibilidad los calcula el servidor.
- **Idempotency-Key** (`idempotency.ts`): un UUID por intento, reutilizado mientras el contenido
  (carrito, nota, hora) no cambie: reintento tras un error de red, doble clic o recarga de la
  pestaña (se guarda en `sessionStorage`). Cambia solo tras un éxito, si cambia el contenido o si
  el backend responde `IDEMPOTENCY_KEY_CONFLICT`/`INVALID_ORDER_REQUEST`. Un 200 (repetición
  idempotente) cuenta como éxito igual que un 201.
- **Éxito:** se vacía el carrito y se muestra «Pedido enviado» con la referencia, la cafetería,
  la hora, la nota, los productos y el total que devolvió el backend. Enlaza a `/cuenta`; «Mi
  pedido» llega con el PR 3.

### Errores del pedido

`errors.ts` traduce el código de error a un mensaje fijo y una acción. Nada del cuerpo de
Spring se muestra. Ante un error de red o de Auth el carrito se conserva y se puede reintentar.

| Código                                              | Acción                                  |
| --------------------------------------------------- | --------------------------------------- |
| `CAFETERIA_CLOSED`                                  | Ir al menú                              |
| `PRODUCT_UNAVAILABLE`                               | Revisar carrito                         |
| `ACTIVE_ORDER_EXISTS`                               | Ir al inicio                            |
| `IDEMPOTENCY_KEY_CONFLICT`                          | Confirmar de nuevo, con clave nueva     |
| `INVALID_PICKUP_TIME`                               | Cambiar la hora                         |
| `ORDER_NOTE_TOO_LONG`                               | Acortar la nota                         |
| `ORDER_LIMIT_EXCEEDED`, `INVALID_ORDER_REQUEST`     | Revisar carrito                         |
| `CAFETERIA_NOT_FOUND`, `CAFETERIA_NOT_SUBSCRIBED`   | Elegir cafetería                        |
| `FORBIDDEN`                                         | Ir al inicio                            |
| `UNAUTHORIZED`                                      | Iniciar sesión (el carrito se conserva) |
| `ORDER_TEMPORARILY_UNAVAILABLE`, 502/503, red, Auth | Reintentar con la misma clave           |
| Cualquier otro                                      | Reintentar                              |

## Comprobaciones

`tests/client-checkout.test.mjs` (hora, cuerpo, idempotencia, cliente de envío y errores),
`tests/client-shopping.test.mjs` (carrito), `tests/client-menu.test.mjs`,
`tests/client-context.test.mjs`, `tests/client-pages.test.mjs` y `tests/client-order-bff.test.mjs`.
E2E: `client-home`, `client-shopping` y `client-checkout`, con el proveedor local
(`tests/helpers/auth-provider-server.mjs`), que sirve el contexto y el menú desde
`tests/fixtures/client-menu.ts` y crea pedidos con `tests/helpers/client-order-fixture.mjs`
(una nota que empieza con `__` provoca fallos a propósito).
