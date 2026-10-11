# Cliente: catálogo, carrito editable y resumen de compra

El primer bloque y el bloque de carrito/resumen fueron autorizados por el usuario.
Solo frontend. La creación de pedidos simulados y su seguimiento corresponden al
siguiente bloque, después de revisar este recorrido. No se crean pedidos reales.

## Implementado en este bloque

- Se conserva la selección de sede y la cafetería asociada a cada una.
- El inicio muestra un carrusel y debajo los accesos Desayunos/Almuerzos.
- Cinco slides cuando hay suficientes platos: en Principal, tres almuerzos y dos
  desayunos. En Aguas Claras solo almuerzos. Se excluyen agotados y platos que no
  se ofrecen ese día. Antes de las 8:30, los desayunos aparecen primero.
- Avance cada tres segundos, navegación circular, flechas, indicadores y gesto
  horizontal. La interacción pausa el avance; el botón de reproducción lo retoma.
  No avanza en pestañas ocultas ni fuera de pantalla. Respeta movimiento reducido.
- Cinco desayunos completos, fotografías generadas y precios provisionales.
- Desayunos solo en Principal, de 06:00 inclusive a 08:30 exclusive. Almuerzos,
  de 11:30 inclusive a 14:30 exclusive. Toda la lógica usa `America/Bogota`.
- Los accesos de comida quedan deshabilitados fuera de horario. Se puede consultar
  el detalle desde un slide; agregar se bloquea fuera del servicio, sin stock o
  cuando el plato no se ofrece ese día. Las reglas se repiten al pulsar Agregar.
- Pantalla de detalle, cantidad, observaciones opcionales (máximo 200 caracteres),
  precio total y acción Agregar al carrito. Cada combo cuenta como una unidad:
  huevos, arepa y chocolate de un desayuno no se cuentan por separado.
- Máximo de tres platos completos contando cantidades, y una cafetería por carrito.
  Las observaciones diferentes conservan líneas distintas pero comparten el stock.
- Desayunos y almuerzos se piden por separado. Agregar y confirmar rechazan un
  carrito mixto, incluso en modo de prueba. Los carritos mixtos guardados antes de
  esta regla se conservan para corregirlos; muestran el motivo y no permiten confirmar.
- Al regresar al detalle de un plato ya agregado, el selector muestra su cantidad
  actual y el botón **Actualizar carrito** guarda el nuevo total sin duplicarlo.
  Si hay varias líneas del mismo plato con distintas notas, se edita la primera;
  cada variante también se puede editar directamente en el carrito.
- Carrito inicial con líneas, cantidades, observaciones, subtotal y eliminación por
  botón. Vaciar y cambiar de cafetería requieren confirmación con foco accesible.
- Navegación Inicio/Pedidos/Carrito/Perfil, contador y toast. Pedidos está reservado
  y deshabilitado hasta implementar el bloque de seguimiento.
- Se retiraron avisos visibles de datos ilustrativos a petición del usuario.

Para conciliar los slides combinados con horarios que no se superponen, el
carrusel presenta la oferta del día con stock: puede mostrar platos de otro turno,
sin horarios en los slides. Los horarios se consultan en las categorías y en el
detalle del plato. Ver un slide no significa que se pueda comprar en ese momento.

## Carrito editable y confirmación de prueba

- `/cuenta/carrito` permite aumentar/reducir cantidades, editar observaciones en
  un diálogo y ver el subtotal actualizado. Las líneas del mismo plato con iguales
  observaciones se combinan. El stock se cuenta entre todas las líneas del plato.
- Reducir cantidades y editar notas permite corregir un carrito fuera de horario;
  aumentar y continuar al resumen vuelven a comprobar la disponibilidad actual.
- Se puede eliminar con el botón o deslizar a la izquierda para descubrir la acción
  de eliminación. El desplazamiento vertical conserva su comportamiento normal.
- `/cuenta/carrito/resumen` requiere CLIENT activo tanto en la página como en el
  layout. La navegación mantiene Carrito como sección activa.
- El resumen muestra sede, cafetería, platos, notas, cantidades, precios actuales
  del catálogo, total, efectivo al recoger y condiciones provisionales de recogida.
- Los horarios son del día en Colombia y se ofrecen cada 30 minutos: 06:00–08:30
  para desayunos, 11:30–14:30 para almuerzos. La hora de cierre sí admite recogida,
  pero no nuevos pedidos. Se exige un margen de preparación de 20 minutos exactos,
  incluidos segundos; por ejemplo, a las 12:10:01 ya no se admite recoger a las 12:30.
- La interfaz indica la siguiente hora disponible. Una selección que vence queda
  bloqueada y debe cambiarse; si ya no quedan turnos, se puede regresar al carrito.
- Confirmar requiere aceptar las condiciones. Se revalidan el carrito, las
  existencias, la sede, el servicio y la hora elegida en el instante de pulsar.
  Los cambios de carrito o modo de prueba invalidan la aceptación previa. La
  confirmación relee el carrito persistido para detectar cambios aún no renderizados.
- Al confirmar se muestra **Resumen confirmado**, identificado como confirmación
  de prueba. Se conserva el carrito. No se asigna número de pedido, se reserva stock,
  se crea historial ni se llama a una API de pedidos. El resultado existe solo en
  memoria y se descarta al recargar; el próximo bloque añadirá pedidos simulados.

`domain/cart.ts` concentra edición y validación del carrito; `domain/checkout.ts`
define intervalos, preparación y un resumen interno. Este tipo no presupone ningún
contrato del backend. El diálogo base `ClientDialog` conserva foco, Escape y scroll
y se reutiliza para editar notas, vaciar el carrito y cambiar de cafetería.

## Probar el carrito fuera de horario

Al iniciar con `npm run dev` (o `iniciar-unifood.cmd`), las vistas del cliente
muestran **Probar sin horario** arriba del contenido. Actívalo para explorar
Desayunos/Almuerzos y agregar al carrito a cualquier hora. Se conserva al navegar
y recargar en esa pestaña para la misma cuenta; cerrar sesión lo desactiva.
Desmárcalo para volver a comprobar los horarios normales de Colombia.

El control y la excepción solo funcionan con `NODE_ENV=development`. En una
compilación de producción, incluso un valor guardado previamente se ignora.
Se conservan las restricciones de sede, días del menú, stock y máximo de tres
platos completos. No modifica `.env.local` ni envía pedidos al backend.
En el resumen, el modo de prueba conserva las franjas reales: desayunos de 06:00
a 08:30 y almuerzos de 11:30 a 14:30, cada 30 minutos. Si no queda un turno válido
hoy, muestra la próxima fecha compatible con los días del menú. La fecha aparece
en cada opción y se mantiene el margen de 20 minutos. No ofrece recogidas de madrugada
ni amplía el horario del servicio. En producción solo se ofrecen turnos del día.
La creación de pedidos y su seguimiento siguen pendientes del siguiente bloque.

## Arquitectura y almacenamiento

`features/client/mocks/catalog.ts` conserva productos, imágenes, precios, stock
y días disponibles. `getSiteMeals` define la oferta de cada cafetería; no es un
DTO supuesto de Spring. Los nombres de las sedes fueron confirmados por el usuario.

`domain/catalog.ts` concentra horarios, disponibilidad, formato COP y selección
del carrusel. `domain/cart.ts` valida agregados y normaliza datos persistidos.
`ClientCartProvider` limita el estado a las rutas protegidas CLIENT. Las nuevas
rutas `/cuenta/producto/[mealId]` y `/cuenta/carrito` también comprueban el rol en
servidor, independientemente del layout.

La clave `unifood.client.cart.v1` guarda el UUID de propietario y las líneas en
localStorage. No guarda tokens, precios, información de perfil ni credenciales.
Una cuenta diferente no restaura el carrito anterior. La lectura valida tipos,
productos, sede y cantidades; descarta datos corruptos o excesivos. Si el navegador
no permite almacenamiento, el carrito sigue funcionando en memoria y se informa
que no se conservará al recargar.

Después del logout exitoso, `LogoutButton` emite `unifood:logout`. El proveedor
limpia memoria y almacenamiento; el panel conserva su destino y comportamiento.
Los eventos `storage` sincronizan la limpieza entre pestañas. La recuperación de
contraseña conserva su flujo existente y no se modificaron endpoints de auth.

La persistencia es provisional. El backend futuro deberá validar horarios,
precio, stock y propiedad de forma autoritativa; estas comprobaciones del navegador
solo hacen consistente la demostración. Todavía no hay reserva de stock ni venta.

## Comprobaciones

- Pruebas de reglas: aperturas/cierres exactos, zona horaria, stock entre líneas,
  límite total, menú por sede, días y datos persistidos manipulados.
- E2E con proveedor local: recorrido y overflow a 320/375/390/412/430/1280 px;
  carrusel automático/manual, horarios sin recargar, persistencia, cambio de sede,
  confirmaciones, sesión, carrito ajeno/corrupto y bloqueo por stock.
- Playwright comprueba el control de pruebas fuera de horario, su persistencia
  por pestaña y el retorno al horario normal. Las reglas prueban que la excepción
  se ignora en producción y conserva sede, stock, días y límites del carrito.
- Edición, condiciones, márgenes exactos de recogida, cierre del servicio,
  selecciones vencidas, confirmación de prueba, precios derivados del catálogo y
  cambios persistidos entre la revisión y la confirmación.

## Pendiente de los siguientes bloques aprobados

1. Pedidos simulados persistentes: activos/historial desplegables, estados,
   progreso, cambios automáticos con tiempos realistas y detalle.
2. Cancelación solo PENDING, motivo predefinido/texto, repetir omitiendo agotados,
   últimos tres del historial y filtros por fecha/estado/cafetería.
3. Avisos dentro de la app y notificaciones locales mientras está abierta; push
   en segundo plano pendiente de infraestructura posterior.
4. Integración con contratos reales de backend y menú administrado por trabajador.

## Commits sugeridos

- `feat(client): complete cart and checkout flow` — edición, diálogo compartido
  del cliente, reglas y ruta de resumen, confirmación de prueba, pruebas y documentación.
- `feat(client): add breakfast menus and rotating meal carousel` — catálogo,
  horarios, inicio, carrusel, imágenes, estilos y pruebas de disponibilidad.
- `feat(client): add product details and persistent cart foundation` — rutas,
  detalle, reglas, proveedor, carrito inicial, navegación, limpieza tras logout y
  pruebas del recorrido y aislamiento.
- `docs(client): document shopping scope and generated breakfast assets` — este
  documento, enlaces y procedencia de imágenes.

No se ejecutaron commits ni push.
