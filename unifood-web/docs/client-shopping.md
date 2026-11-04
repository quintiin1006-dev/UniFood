# Cliente: catálogo, carrito editable y envío de pedidos

El frontend del cliente lee el catálogo de `GET /api/me/menu` y envía el pedido con
`POST /api/me/orders`. El carrito sigue en el navegador hasta que el pedido se acepta.

**Estado del backend:** `POST /api/me/orders` existe; `GET /api/me/menu` todavía no. Hasta
implementarlo, con el backend real la app muestra "No pudimos cargar el menú". Las pruebas
E2E usan el contrato de abajo a través de `tests/helpers/auth-provider-server.mjs`.

## Contrato que consume el frontend

`GET /api/me/menu` (solo CLIENT activo; la institución sale del perfil, no del navegador):

```json
{
  "sites": [
    {
      "id": "uuid",
      "name": "Sede Principal",
      "city": "Villavicencio",
      "imageUrl": null,
      "meals": [
        {
          "id": "uuid",
          "cafeteriaId": "uuid",
          "cafeteriaName": "Cafetería Central",
          "name": "Pollo",
          "description": null,
          "price": "15000.00",
          "imageUrl": "/images/client/chicken.png",
          "stock": 12,
          "category": "CORRIENTE",
          "availableToday": true
        }
      ]
    }
  ]
}
```

- `category` es el enum `catalog_category` de `lunches`: `DESAYUNO` define el servicio de
  desayuno y `DEL_DIA`, `CORRIENTE`, `EJECUTIVO` y `ESPECIAL` el de almuerzo.
- `availableToday` refleja la disponibilidad del día en Colombia y debe ser `false` para
  todos los platos si la cafetería está cerrada ese día. No hay días de venta semanales.
- `price` admite número JSON o texto decimal con hasta dos decimales.
- `imageUrl` solo se usa si es una ruta local (`/...`); cualquier otra usa el logo, porque
  `next/image` falla con hosts no configurados.

`POST /api/me/orders` recibe `{ pickupAt, items: [{ lunchId, quantity, note }] }` y responde
201 con `id`, `status` y `total`. La ruta `app/api/me/orders/route.ts` reenvía solo esos
campos con el token de la sesión; precios o identidades enviados por el navegador se
descartan. `pickupAt` ya se envía, pero el backend aún no lo guarda.

## Lectura del menú

- `app/cuenta/layout.tsx` carga el menú una vez por petición (`loadClientMenu`, cacheado con
  `React.cache`) y lo entrega al proveedor del carrito. El navegador no llama al backend.
- `domain/menu.ts` convierte la respuesta en un `ClientMenu` y descarta platos mal formados
  sin ocultar el resto de la sede. Una respuesta inesperada se trata como menú no disponible.
- Con el menú no disponible, inicio, menú, producto, carrito y resumen muestran
  `MenuUnavailable`; el carrito guardado no se borra.
- Si un plato sale del menú, se quita solo esa línea del carrito.
- Tras un rechazo 409 (stock o disponibilidad) se recarga el menú y se conserva el motivo.

Los desayunos solo aparecen en las sedes que los ofrecen.

## Implementado

- Se conserva la selección de sede y la cafetería asociada a cada una.
- El inicio muestra un carrusel y debajo los accesos Desayunos/Almuerzos.
- Cinco slides cuando hay suficientes platos: en Principal, tres almuerzos y dos
  desayunos. En Aguas Claras solo almuerzos. Se excluyen agotados y platos que no
  se ofrecen ese día. Antes de las 8:30, los desayunos aparecen primero.
- Avance cada tres segundos, navegación circular, flechas, indicadores y gesto
  horizontal. La interacción pausa el avance; el botón de reproducción lo retoma.
  No avanza en pestañas ocultas ni fuera de pantalla. Respeta movimiento reducido.
- Desayunos de 06:00 inclusive a 08:30 exclusive; almuerzos de 11:30 inclusive a
  14:30 exclusive. Toda la lógica usa `America/Bogota`.
- Los accesos de comida quedan deshabilitados fuera de horario. Se puede consultar
  el detalle desde un slide; agregar se bloquea fuera del servicio, sin stock o
  cuando el plato no se ofrece ese día. Las reglas se repiten al pulsar Agregar.
- Pantalla de detalle, cantidad, observaciones opcionales (máximo 200 caracteres),
  precio total y acción Agregar al carrito. Cada combo cuenta como una unidad.
- Máximo de tres platos completos contando cantidades, y una cafetería por carrito.
  Las observaciones diferentes conservan líneas distintas pero comparten el stock.
- Desayunos y almuerzos se piden por separado. Agregar y confirmar rechazan un
  carrito mixto, incluso en modo de prueba.
- Al regresar al detalle de un plato ya agregado, el selector muestra su cantidad
  actual y el botón **Actualizar carrito** guarda el nuevo total sin duplicarlo.
- Carrito con líneas, cantidades, observaciones, subtotal y eliminación por botón.
  Vaciar y cambiar de cafetería requieren confirmación con foco accesible.
- Navegación Inicio/Pedidos/Carrito/Perfil, contador y toast. Pedidos está reservado
  y deshabilitado hasta implementar el seguimiento.

Para conciliar los slides combinados con horarios que no se superponen, el
carrusel presenta la oferta del día con stock: puede mostrar platos de otro turno,
sin horarios en los slides. Los horarios se consultan en las categorías y en el
detalle del plato. Ver un slide no significa que se pueda comprar en ese momento.

## Carrito y envío del pedido

- `/cuenta/carrito` permite aumentar/reducir cantidades, editar observaciones en
  un diálogo y ver el subtotal actualizado. Las líneas del mismo plato con iguales
  observaciones se combinan. El stock se cuenta entre todas las líneas del plato.
- Se puede eliminar con el botón o deslizar a la izquierda para descubrir la acción
  de eliminación. El desplazamiento vertical conserva su comportamiento normal.
- `/cuenta/carrito/resumen` requiere CLIENT activo tanto en la página como en el
  layout. La navegación mantiene Carrito como sección activa.
- Los horarios son del día en Colombia y se ofrecen cada 30 minutos: 06:00–08:30
  para desayunos, 11:30–14:30 para almuerzos. La hora de cierre sí admite recogida,
  pero no nuevos pedidos. Se exige un margen de preparación de 20 minutos exactos,
  incluidos segundos; por ejemplo, a las 12:10:01 ya no se admite recoger a las 12:30.
- Una selección que vence queda bloqueada y debe cambiarse; si ya no quedan turnos,
  se puede regresar al carrito.
- Confirmar requiere aceptar las condiciones. Antes de enviar se revalidan el carrito,
  las existencias, la sede, el servicio y la hora elegida. La confirmación relee el
  carrito persistido para detectar cambios aún no renderizados.
- Al confirmar, el navegador envía solo `lunchId`, `quantity` y `note` a
  `POST /api/me/orders` (a través de la ruta `app/api/me/orders/route.ts`, que exige
  origen válido, sesión y rol CLIENT, y descarta cualquier otro campo).
- El backend valida el carrito, toma precios y cafetería de la base de datos, descuenta
  el stock de cada línea de forma atómica y crea el pedido en estado `PENDING`. Si una
  línea no tiene stock, todo el pedido se revierte.
- Con la respuesta **201** se muestra **Pedido enviado** con la referencia del pedido
  y se vacía el carrito. Si el backend rechaza el pedido, el carrito se conserva y se
  muestra el motivo.

`domain/cart.ts` concentra edición y validación del carrito; `domain/checkout.ts`
define intervalos, preparación y el resumen. Ambos reciben el menú como parámetro.
El diálogo base `ClientDialog` conserva foco, Escape y scroll.

## Probar el carrito fuera de horario

Con `npm run dev`, las vistas del cliente muestran **Probar sin horario**. Sirve para
explorar Desayunos/Almuerzos y agregar al carrito a cualquier hora. Se conserva al
navegar y recargar en esa pestaña para la misma cuenta; cerrar sesión lo desactiva.

El control solo funciona con `NODE_ENV=development`. En producción se ignora aunque
haya un valor guardado. Se conservan las restricciones de sede, disponibilidad del día, stock y
máximo de tres platos completos.

**En modo de prueba no se envían pedidos.** El botón de confirmar queda deshabilitado
con un aviso. El backend todavía no valida horarios de servicio, así que enviar un
pedido fuera de horario crearía un pedido real.

## Almacenamiento en el navegador

La clave `unifood.client.cart.v1` guarda el UUID de propietario y las líneas en
localStorage. No guarda tokens, precios, información de perfil ni credenciales.
Una cuenta diferente no restaura el carrito anterior. La lectura valida tipos,
platos (contra el menú actual), sede y cantidades; descarta datos corruptos o
excesivos, incluidos carritos guardados con los identificadores del mock anterior.

Después del logout exitoso, `LogoutButton` emite `unifood:logout`. El proveedor
limpia memoria y almacenamiento. Los eventos `storage` sincronizan la limpieza entre
pestañas. La recuperación de contraseña conserva su flujo existente.

## Comprobaciones

- Pruebas unitarias (`npm test`): reglas de horario y zona horaria, stock entre líneas,
  límite total, menú por sede y días, datos persistidos manipulados, y el analizador
  de la respuesta del menú (`tests/client-menu.test.mjs`).
- Ruta del pedido: `tests/client-order-route.test.mjs` cubre origen, sesión, rol, campos
  reenviados, validación y que el texto interno del backend no llegue al navegador.
- Backend: `ClientOrderCreationServiceTest` y `ClientOrderCreationApiTest` cubren reglas de
  pedido, stock, cafeterías y autorización.
- E2E con proveedor local (`tests/helpers/auth-provider-server.mjs`): sirve el menú del
  fixture y simula `POST /api/me/orders` con las mismas reglas de stock y cafetería.
  Recorrido y overflow en 320/375/390/412/430/1280 px, horarios, persistencia, cambio de
  sede, confirmación y sesión.

## Pendiente

1. Backend de `GET /api/me/menu` y datos reales del menú, sobre el catálogo de `lunches`
   (categorías y disponibilidad diaria).
2. Guardar `pickupAt` y validar horarios de servicio en el backend.
3. Evitar pedidos duplicados si la respuesta se pierde y el cliente reintenta.
4. Historial, seguimiento y cancelación de pedidos en el cliente.
5. Verificar que la cafetería pertenece a la institución del cliente en la creación
   (la creación aún no lo revalida).
6. Avisos dentro de la app y notificaciones; push en segundo plano pendiente.
