# Rediseño de los paneles de worker, admin y super admin

Especificación previa a la implementación. **No cambia código.** Base: `develop` en `6ae51a5`
(2026-11-12). Manda `docs/decisiones.md`; donde este documento lo contradiga, lo señala
como pregunta abierta (§9).

**Cómo se hizo la auditoría**

- Lectura del código de `app/worker`, `app/admin/**`, `app/super-admin`, `components/worker/`,
  `features/{orders,availability,worker-history,worker-profile,admin,admin-catalog,admin-dashboard,admin-profile,super-admin}`
  y sus BFF.
- Capturas reales en escritorio (1440×900), tableta (1024×768) y celular (390×844), con Next en
  el puerto 3200 contra una **copia** del simulador de pruebas (`tests/helpers`) en el 3201.
  No se tocó ninguna base remota ni Spring. Las capturas no se versionan.
- Los tiempos de interacción en hora pico son **estimaciones** a partir del número de pasos,
  no mediciones con usuarios.
- La parte de movimiento aplica la skill `design-motion-principles` (§1.3 y Anexo A).

Esfuerzo: **S** (menos de medio día), **M** (1 o 2 días), **L** (más de 2 días).
Riesgo: **B** (bajo, aislado), **M** (medio: toca estado o pruebas existentes), **A** (alto:
cambia la maqueta o comparte archivos con otros flujos).

---

## 1. Principios de diseño

### 1.1 Forma y estilo

1. **Se conserva la forma actual de cada panel.** Worker: cabecera, tablero de cuatro
   columnas y barra inferior de cinco módulos. Admin: barra lateral, cabecera con el
   contexto de la cafetería y contenido central. Super admin: listado único. Se corrige lo
   que hay; no se cambia la navegación.
2. **Una acción principal por tarjeta y por pantalla** (§8 de decisiones). En una tarjeta del
   tablero, la acción principal es el siguiente estado; «Rechazar» queda como secundaria.
3. **Cero ruido visual.** Nada que parpadee, pulse o se mueva sin que el usuario lo haya
   provocado. El color se reserva para el estado: azul para la acción, verde para
   «hecho», ámbar para «atención» y rojo para lo irreversible o el error.
4. **El estado del sistema siempre es visible y veraz.** Si el tablero no se pudo actualizar,
   se dice. Nunca un «En línea» fijo ni un contador en 0 cuando en realidad hubo un error.
5. **Los errores no bloquean el trabajo.** En hora pico, un fallo en un pedido no debe tapar
   los otros veinte. El error se muestra junto a lo que falló, o en una franja no modal.
6. **Textos fijos, cortos y en español llano.** Nada de «SQL», «MiB», «intento» ni
   «operación confirmada». Cada código de error tiene su frase y su siguiente paso.
7. **Un mismo concepto, una misma palabra** en todas las pantallas (§3).

### 1.2 Accesibilidad mínima de todo panel

- Navegable solo con teclado, con foco visible de alto contraste y el mismo anillo en todos
  los paneles.
- Diálogos con foco inicial, foco atrapado, `Escape` y foco devuelto al cerrar.
- Cada cambio de estado relevante se anuncia en una región `aria-live` («Pedido de Laura
  Gómez en preparación»), no solo por color o movimiento.
- Textos de al menos 12 px reales en tableta y objetivos táctiles de 44 px.
- Contraste AA. Hay que medir con axe los textos claros sobre azul (§2.1); no se midieron.
- `prefers-reduced-motion` se respeta en todo, transiciones incluidas.

### 1.3 Movimiento

La skill pide ponderar a sus tres referentes según el contexto:

| Panel       | Contexto                                                      | Lente principal                       | Secundaria                 | Selectiva                                   |
| ----------- | ------------------------------------------------------------- | ------------------------------------- | -------------------------- | ------------------------------------------- |
| Worker      | Herramienta de cocina, uso continuo, cientos de toques al día | Emil Kowalski: contención y velocidad | Jakub Krehel: pulido sutil | Jhey Tompkins: ninguna                      |
| Admin       | Panel de gestión de uso diario                                | Emil                                  | Jakub                      | Jhey: solo estados vacíos, y sin movimiento |
| Super admin | Consulta ocasional                                            | Emil                                  | Jakub                      | Ninguna                                     |

Reglas que salen de esa ponderación:

- **Filtro de frecuencia.** Lo que el worker toca cientos de veces al día (avanzar un pedido,
  cambiar de módulo, buscar) no anima, o anima solo con un cambio de color de 120 ms. Lo
  diario y ocasional (abrir un detalle, un diálogo, un aviso) anima de forma corta. Lo que se
  activa con el teclado nunca anima.
- **Tokens de movimiento** para los tres paneles:

  | Token              | Valor                        | Uso                                                      |
  | ------------------ | ---------------------------- | -------------------------------------------------------- |
  | `--motion-instant` | 0 ms                         | Cambio de módulo, filtros, búsqueda                      |
  | `--motion-fast`    | 120 ms                       | Pulsar (`scale(0.98)`), hover de color, salida de avisos |
  | `--motion-base`    | 180 ms                       | Tarjeta que llega a otra columna, aviso que entra        |
  | `--motion-dialog`  | 220 ms                       | Entrada de un diálogo o del cajón del admin              |
  | `--ease-out`       | `cubic-bezier(0.2, 0, 0, 1)` | Entradas                                                 |
  | `--ease-in`        | `cubic-bezier(0.4, 0, 1, 1)` | Salidas, a unos 2/3 de la duración de la entrada         |

- Solo se animan `transform` y `opacity`. Nada empieza en `scale(0)`: como mínimo `0.98`. Sin
  `blur` de entrada. Sin rebote. Sin animaciones infinitas.
- **La salida es más sutil que la entrada**: menos desplazamiento y menos tiempo.
- **Con `prefers-reduced-motion: reduce`** se quitan animaciones y transiciones, y queda el
  estado final. Todo movimiento funcional tiene un equivalente sin movimiento: el anuncio
  `aria-live` y el cambio de color o de texto.
- Ya hacen bien: el admin envuelve sus transiciones en
  `@media (prefers-reduced-motion: no-preference)` (`Admin.module.css`, `AdminDashboard.module.css`),
  y el carrusel de disponibilidad desplaza con `behavior: "instant"` si el usuario reduce el
  movimiento. Ese es el patrón a seguir.

---

## 2. Auditoría de las pantallas actuales

### 2.1 Worker (`/worker`, `components/worker/WorkerDashboard.tsx`)

Todo el panel es una sola ruta y el módulo vive en el estado de React. **Pedidos y Llamadas
se dibujan con `transform: scale(0.7)`** (`app/globals.css`, `.worker-page`); Disponibilidad,
Historial y Perfil anulan esa escala (`WorkerDashboard.module.css`). La cabecera y la barra
inferior cambian de tamaño al pasar de un módulo a otro.

#### Tablero Kanban («Pedidos»)

| Aspecto             | Estado actual                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Muestra             | Cuatro columnas: Pendientes, En preparación, Listos para entregar (READY y CALLED) y Entregados (solo los 5 últimos). Cada tarjeta muestra nombre, código o tipo de cliente, «Hace N min», «Recoger a las HH:mm» si la hay, observaciones, «Estudiante avisado» en CALLED, la acción principal y «Rechazar» en PENDING y PREPARING.                                                                                                          |
| Acciones            | Avanzar el estado (Pasar a preparación, Marcar como listo, Llamar a recoger, Marcar como entregado), abrir el detalle, rechazar con motivo y buscar desde la cabecera.                                                                                                                                                                                                                                                                       |
| Cargando            | Texto «Cargando pedidos...» blanco y centrado, con estilos en línea y sin esqueleto.                                                                                                                                                                                                                                                                                                                                                         |
| Vacío               | «No hay pedidos» en cada columna. Con una búsqueda sin resultados sale **el mismo texto y contadores en 0**, como si no hubiera pedidos.                                                                                                                                                                                                                                                                                                     |
| Error al cargar     | El mensaje del BFF en texto plano, **sin botón «Reintentar»**. Ante cualquier fallo, incluido un 502 de red, el mensaje es «No se pudo resolver la cafetería de tu cuenta.», que no explica qué pasó. El sondeo de 10 s sigue intentándolo.                                                                                                                                                                                                  |
| Error de acción     | **Diálogo que bloquea toda la pantalla**, con desenfoque, «No se pudo completar la acción» y botón «Entendido». No mueve el foco ni responde a `Escape`, y se cierra al tocar cualquier parte. El texto es `data.message` del cuerpo que reenvía el BFF, es decir, **el mensaje de Spring** (`features/orders/api/orderApi.ts`, `readErrorMessage`). El caso FIFO se detecta con la expresión regular `/pedido anterior/` sobre ese texto.   |
| Sin permiso         | El mismo texto plano de error. El BFF devuelve 401 o 403 con el mensaje fijo; no ofrece «Iniciar sesión».                                                                                                                                                                                                                                                                                                                                    |
| Cafetería cerrada   | **No se indica.** El tablero no sabe si la cafetería está abierta; hay que ir a Disponibilidad.                                                                                                                                                                                                                                                                                                                                              |
| Éxito               | La tarjeta desaparece de su columna y reaparece en la siguiente con `cardIn` (450 ms). Sin anuncio para lectores de pantalla.                                                                                                                                                                                                                                                                                                                |
| Estado de conexión  | «En línea» con un punto verde que **pulsa siempre** (`Header.module.css`, `pulse` infinito), aunque el listado esté fallando.                                                                                                                                                                                                                                                                                                                |
| Accesibilidad       | Botones nativos y `aria-label` en las acciones. Faltan un enlace «Ir al contenido» y una región `aria-live` para los cambios. El `h1` es «UniFood» y el título del módulo va en un `<p>`. El foco de las tarjetas usa un anillo al 22 % de opacidad, poco visible. Con la escala 0.7, un texto de 14 px se ve de unos 10 px y los botones encogen un 30 %. Hay que medir con axe el texto claro sobre azul («No hay pedidos», «Hace N min»). |
| Movimiento          | Entrada de la cabecera de 700 ms y del logo de 750 ms; `cardIn` de 450 ms en **cada** tarjeta cada vez que se vuelve a Pedidos; elevación al pasar el cursor en tarjetas y botones; detalle de 360 ms; punto que pulsa sin fin. Con movimiento reducido, `globals.css` corta las animaciones pero no las transiciones; cada componente lo resuelve por su cuenta.                                                                            |
| Tiempo en hora pico | 4 toques por pedido, uno por estado, de 1 a 2 s cada uno. Un error añade 1 toque y unos 3 s de lectura, y tapa el tablero. Un pedido nuevo tarda hasta 10 s en aparecer y no se distingue de los demás.                                                                                                                                                                                                                                      |

#### Detalle del pedido (diálogo desde el tablero)

| Aspecto       | Estado actual                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Muestra       | Nombre, código, productos con cantidad, precio unitario («c/u») y subtotal, total, «Observaciones», «Tiempo de pedido» y la acción principal. |
| Falta         | La hora de recogida y «Rechazar». Las observaciones **pierden los saltos de línea**, que sí se ven en la tarjeta (§11 pide conservarlos).     |
| Accesibilidad | Correcta: foco inicial en «Cerrar», foco atrapado, `Escape` y foco devuelto.                                                                  |
| Movimiento    | Fondo de 220 ms con desenfoque y diálogo de 360 ms: lento para algo que se abre decenas de veces por turno.                                   |

#### Rechazo (`features/orders/components/RejectOrderDialog.tsx`)

Motivo obligatorio de 3 a 200 caracteres, contador, «El cliente verá este motivo.», el error
dentro del diálogo y bloqueo contra el doble envío. Buen texto. **Falta**: atrapar el foco,
devolverlo al cerrar y un botón para cerrar visible además de «Volver». Tiempo típico: de 10
a 15 s para escribir el motivo.

#### Llamadas

| Aspecto             | Estado actual                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Muestra             | Lista de pedidos CALLED con iniciales, nombre, código, campana de aviso con «N/3» y «Ver pedido». Panel de detalle («Resumen para entrega», «Lo que pidió», «Nota del pedido», avisos enviados, total, «Marcar como entregado» y «No recogido» con doble confirmación en 5 s). |
| Cargando y error    | **No existen.** Mientras carga y cuando el listado falla, se ve el contador «0» y una lista vacía. Comprobado con el backend caído: «Llamadas 0» con «En línea» en verde.                                                                                                      |
| Vacío               | Área vacía con `aria-hidden`: no dice «No hay pedidos por entregar».                                                                                                                                                                                                           |
| Avisar de nuevo     | La razón del bloqueo («Podrás volver a avisar en 3 min») solo está en `title`: no se ve en una pantalla táctil y el lector de pantalla no la anuncia.                                                                                                                          |
| Éxito               | El pedido sale de la lista; el panel vuelve a «Selecciona un pedido». Sin confirmación.                                                                                                                                                                                        |
| Accesibilidad       | Hay dos `h1` («UniFood» en la cabecera y «Llamadas»). El foco visible es correcto (`.container button:focus-visible`).                                                                                                                                                         |
| Tiempo en hora pico | Buscar por código (7 dígitos), elegir la fila y entregar: de 5 a 8 s. Avisar de nuevo: 1 toque.                                                                                                                                                                                |

#### Disponibilidad (`features/availability`)

| Aspecto       | Estado actual                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Muestra       | Nombre de la cafetería, fecha de hoy, estado administrativo, interruptor ABIERTA/CERRADA y seis categorías con carrusel de tarjetas e interruptor por producto.                                            |
| Estados       | Cargando con esqueleto; error con «Reintentar» que conserva los últimos datos; «Guardando…» por control; reversión si falla; aviso de día vencido; texto de cafetería inactiva. Es el módulo más completo. |
| Falta         | **El aviso de §2 de decisiones: «El panel avisa si abre la cafetería sin marcar nada disponible.»** No existe; el único `notice` es el del cambio de día.                                                  |
| Accesibilidad | Interruptores con `role="switch"`, carrusel con teclado y foco visible. Correcta.                                                                                                                          |
| Movimiento    | 160 ms con movimiento reducido respetado. Correcto.                                                                                                                                                        |
| Tiempo        | Abrir el día con unos 8 productos: de 10 a 30 s, un toque por producto más la apertura.                                                                                                                    |

#### Historial (`features/worker-history`)

Búsqueda, filtros de período y estado, «Hora de Bogotá», tarjetas con el estado final y su
motivo, «Cargar más», esqueleto, vacío con y sin filtros, error con «Reintentar» o «Iniciar
sesión», y datos anteriores conservados. Bien resuelto. Detalles: el selector de período lleva
`label` y además `aria-label` (doble nombre), y en el celular la barra inferior tapa el final
de la lista.

#### Perfil (`features/worker-profile`)

Correo, rol, cafetería, sede, institución y aviso de cafetería inactiva; cargando, error con
«Reintentar» o «Iniciar sesión». Sin acciones. No enlaza el cambio de contraseña.

### 2.2 Admin (`/admin`, `features/admin/components/AdminShell.tsx`)

La estructura tiene barra lateral (Dashboard, Catálogo, Mi perfil), cajón `<dialog>` en el
celular con foco atrapado, «Ir al contenido» y cabecera con la cafetería, la sede y la
institución. Si el perfil no carga, no se muestra nada más. Con la cafetería inactiva, una
franja dice: **«Puedes consultar la información, pero los cambios están deshabilitados.»**

#### Dashboard (`features/admin-dashboard`)

| Aspecto       | Estado actual                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Muestra       | Períodos (Hoy, 7 días, 30 días, personalizado), cinco métricas, valor de los pedidos registrados, gráfico por día con su tabla, productos no recogidos, ranking de entregados y «Información sobre los datos».                                                                                                                                          |
| Estados       | Esqueleto, error con «Reintentar» o «Iniciar sesión», «Actualizado a las HH:mm», y fallo al actualizar que conserva los datos. Muy completo.                                                                                                                                                                                                            |
| Problemas     | El valor monetario sale con centavos («$ 75,00») cuando el catálogo y el worker muestran pesos enteros; la tasa sale con dos decimales («25,00 %»). «Información sobre los datos» usa frases que en una demo alarman a un administrador («No se puede confirmar qué pedidos corresponden a operaciones reales.»). El título «Dashboard» está en inglés. |
| Accesibilidad | La mejor de los tres paneles: tabla alternativa al gráfico, `details` en lugar de tooltips de hover, y foco visible.                                                                                                                                                                                                                                    |
| Tiempo        | Lectura fuera de hora pico: de 10 a 20 s.                                                                                                                                                                                                                                                                                                               |

#### Catálogo (`features/admin-catalog`)

| Aspecto            | Estado actual                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Muestra            | «Nuevo producto», búsqueda, filtros de categoría y estado, tarjetas con foto o «Sin imagen», categoría, precio, Activo o Inactivo, «Editar» y «Activar» o «Desactivar». Editor en `<dialog>` con confirmación al descartar cambios y flujo de imagen con reconciliación. |
| Estados            | Cargando en texto, error con «Reintentar» o «Iniciar sesión», tres vacíos distintos, éxito «Producto creado.» arriba de la página (lejos del editor ya cerrado).                                                                                                         |
| Cafetería inactiva | **Todo deshabilitado**, y Spring responde `ADMIN_CATALOG_CAFETERIA_INACTIVE`. Choca con §5: «Su WORKER y ADMIN sí entran a su panel y configuran el catálogo» (§9, pregunta 2).                                                                                          |
| Mensajes           | Técnicos: «hasta 3 MiB», «Reenviar mismo intento de imagen», «No hay una operación confirmada», «Esta operación corresponde a otro intento».                                                                                                                             |
| Tiempo             | Crear un producto con foto: de 1 a 2 min.                                                                                                                                                                                                                                |

#### Perfil del admin

Correo, rol, cafetería con su estado, sede e institución, y «Solo lectura». Sin estado propio
de carga: depende del shell. Correcto.

### 2.3 Super admin (`/super-admin`, `features/super-admin`)

| Aspecto        | Estado actual                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Muestra        | «Solo lectura», «Cafeterías», un resumen y una tabla (Cafetería, Sede, Institución, Suscripción, ADMIN).                                                                                                                                                                                                                 |
| Problemas      | Plurales fijos: «**1 cafeterías en 1 sedes de 1 instituciones**». La leyenda de la tabla dice «La suscripción solo se cambia por **SQL** controlado por ahora.». La columna «ADMIN» y «Sin ADMIN activo» usan el código del rol. No hay marca ni botón de actualizar. En el celular, la tabla se desplaza en horizontal. |
| Estados        | Cargando, error con «Reintentar» o «Iniciar sesión», y vacío. Correctos.                                                                                                                                                                                                                                                 |
| Próximo cambio | La Fase 4 (`docs/propuesta-fase4-cobro.md` §6) añade el interruptor «Visible para los clientes», el modelo de cobro y el historial **en estos mismos archivos**.                                                                                                                                                         |

---

## 3. Inconsistencias entre pantallas

| #   | Inconsistencia                                                                                                                                                                                          | Dónde                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| I1  | Escala 0.7 en Pedidos y Llamadas, escala 1 en los demás módulos: la cabecera cambia de tamaño al navegar.                                                                                               | `globals.css`, `WorkerDashboard.module.css`                                                                          |
| I2  | Dos detalles del mismo pedido con textos distintos: «Observaciones» y «Nota del pedido»; «Detalles del pedido» y «Lo que pidió»; «c/u» y «por unidad». Ninguno muestra la hora de recogida.             | `OrderDetail.tsx`, `CallsBoard.tsx`                                                                                  |
| I3  | Vocabulario: «Llamar a recoger», «Llamadas», «Avisar nuevamente», «Avisado», y «Estudiante avisado» aunque el cliente sea docente o administrativo.                                                     | `orderWorkflow.ts`, `OrderCard.tsx`, `CallsBoard.tsx`                                                                |
| I4  | Tres formas de error: diálogo que bloquea (acciones del tablero), texto plano sin reintento (listado del tablero), ninguna (Llamadas), frente a una franja con «Reintentar» (resto de módulos y admin). | Worker frente a resto                                                                                                |
| I5  | Mensajes: fijos por código en llamados, disponibilidad, historial, perfiles, catálogo y super admin; **texto de Spring** en las acciones del tablero. Contradice «Sin errores crudos» de CLAUDE.md.     | `orderApi.ts`                                                                                                        |
| I6  | Dinero en cuatro formatos: «$12.000», «$ 15.000», «$ 18.500» con un formateador propio, y con centavos en el historial y el dashboard.                                                                  | `CallsBoard.tsx`, `availability/presentation.ts`, `admin-catalog/presentation.ts`, `admin-dashboard/presentation.ts` |
| I7  | Horas: la de entrega del tablero usa la zona del navegador (`formatClockTime`); las demás, la de Bogotá. Formatos «9:38 p. m.» y «22:48» en la misma tarjeta.                                           | `lib/orderTime.ts`, `pickupTime.ts`                                                                                  |
| I8  | Anillo de foco de cinco colores y grosores distintos, uno al 22 % de opacidad.                                                                                                                          | CSS de cada módulo                                                                                                   |
| I9  | Encabezados: el worker usa `h1` «UniFood» con el título en un `<p>`, y Llamadas añade otro `h1`; admin y super admin usan un `h1` por página.                                                           | `Header.tsx`, `CallsBoard.tsx`                                                                                       |
| I10 | Cafetería inactiva: el worker «puede cerrar y deshabilitar», el admin tiene «los cambios deshabilitados», §5 dice que configura el catálogo.                                                            | `AvailabilityPanel.tsx`, `AdminShell.tsx`                                                                            |
| I11 | Cargando: texto plano en el tablero y el catálogo; esqueletos en disponibilidad, historial, perfil y dashboard.                                                                                         | —                                                                                                                    |
| I12 | Marca: logo en la cabecera del worker y en la barra lateral del admin; ninguno en el super admin.                                                                                                       | `SuperAdminPanel.tsx`                                                                                                |
| I13 | Orden de categorías: Disponibilidad pone Desayuno en quinto lugar; §11 lo pone en segundo.                                                                                                              | `features/availability/types.ts`                                                                                     |

---

## 4. Mejoras priorizadas por pantalla

Prioridad: **P0** antes del congelamiento del 21 de noviembre; **P1** después de la demo del
28; **P2** cuando haya hueco. Los textos propuestos son borradores para revisar.

### 4.1 Worker: tablero

| ID  | Mejora                                                                                                                                                                                                                                                                                                                                                                                                                         | Esfuerzo | Riesgo | Prioridad |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | --------- |
| W1  | **Estado de sincronización veraz** en lugar de «En línea» fijo: punto estático (sin pulso) y texto «Actualizado hace 8 s», o en ámbar «Sin conexión. Reintentando…» si el último sondeo falló. `useOrders` expone `lastSyncedAt` y `syncError`, y deja visibles los últimos pedidos conocidos.                                                                                                                                 | S        | M      | P0        |
| W2  | **Error de carga con salida**: franja con «No pudimos cargar los pedidos.», «Reintentar», y con 401 «Inicia sesión de nuevo». El mensaje se elige por estado HTTP en el navegador, sin cambiar el BFF.                                                                                                                                                                                                                         | S        | B      | P0        |
| W3  | **Errores de acción sin bloquear**: se sustituye el diálogo de pantalla completa por un aviso en la propia tarjeta (o una franja fija arriba del tablero) con `role="alert"`, cierre con `Escape` y sin desenfoque. Entra en 180 ms y sale en 120 ms.                                                                                                                                                                          | M        | M      | P0        |
| W4  | **Mensajes fijos por código** en preparar, listo, llamar y entregar, como ya hacen los llamados: `ORDER_PROCESSING_SEQUENCE_VIOLATION` → «Primero pasa a preparación el pedido más antiguo de hoy.»; `INVALID_ORDER_STATE` u `ORDER_CONCURRENT_MODIFICATION` → «El pedido ya cambió de estado. Revisa el tablero actualizado.»; 401, 403 y red con su frase. El caso FIFO se detecta por código, no con una expresión regular. | S        | B      | P0        |
| W5  | **Búsqueda sin resultados**: «Ningún pedido coincide con “zzz”.» con «Limpiar búsqueda», en lugar de «No hay pedidos» por columna.                                                                                                                                                                                                                                                                                             | S        | B      | P0        |
| W6  | **Contador de Entregados veraz**: «Últimos 5 de 12» o el total real con la lista recortada.                                                                                                                                                                                                                                                                                                                                    | S        | B      | P0        |
| W7  | **«Cliente avisado»** en lugar de «Estudiante avisado» (los docentes también piden).                                                                                                                                                                                                                                                                                                                                           | S        | B      | P0        |
| W8  | **Anuncio accesible** de cada transición en una región `aria-live="polite"`: «Pedido de Laura Gómez: en preparación».                                                                                                                                                                                                                                                                                                          | S        | B      | P0        |
| W9  | **Movimiento del tablero** según §1.3: quitar el pulso infinito; quitar la entrada de cabecera y logo; `cardIn` a 180 ms, sin `scale` y solo cuando la tarjeta llega a otra columna, no al volver al módulo; quitar las elevaciones al pasar el cursor (es táctil); pulsar con `scale(0.98)` en 120 ms.                                                                                                                        | S        | B      | P0        |
| W10 | **Indicador de cafetería cerrada** en el tablero: «La cafetería está cerrada. Los clientes no pueden pedir.» con enlace a Disponibilidad. Necesita leer el estado del día, que el listado no trae.                                                                                                                                                                                                                             | M        | M      | P1        |
| W11 | **Pedido nuevo visible**: insignia estática «Nuevo» durante 60 s en las tarjetas que no estaban en el sondeo anterior. Sin pulso. Si el dueño lo aprueba, un sonido corto (§9, pregunta 5).                                                                                                                                                                                                                                    | M        | M      | P1        |
| W12 | **Quitar `scale(0.7)`** y dimensionar de verdad para la tableta de cocina: textos de 13 a 16 px, botones de 44 px y columnas con desplazamiento propio. Resuelve I1.                                                                                                                                                                                                                                                           | L        | A      | P1        |
| W13 | Quitar `backdrop-filter` de las columnas y de la barra inferior: cuatro superficies grandes con desenfoque traban las tabletas modestas.                                                                                                                                                                                                                                                                                       | S        | B      | P1        |
| W14 | «Ir al contenido», un `h1` por módulo y un solo anillo de foco (I8, I9).                                                                                                                                                                                                                                                                                                                                                       | S        | B      | P1        |
| W15 | Mover el tablero a `features/worker-board/` y dejar `components/worker/` vacío (CLAUDE.md lo da por histórico). Hacerlo junto con W12.                                                                                                                                                                                                                                                                                         | L        | A      | P2        |

### 4.2 Worker: detalle y rechazo

| ID  | Mejora                                                                                                                                         | Esfuerzo | Riesgo | Prioridad |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | --------- |
| D1  | Mostrar «Recoger a las HH:mm» en el detalle y en el panel de Llamadas.                                                                         | S        | B      | P0        |
| D2  | Conservar los saltos de línea de las observaciones (`white-space: pre-wrap`) y usar la etiqueta fija «Observaciones» en los dos detalles (I2). | S        | B      | P0        |
| D3  | Hora de entrega en Bogotá y con el mismo formato de 24 h que la hora de recogida (I7).                                                         | S        | B      | P0        |
| D4  | Detalle: entrada en 200 ms con `opacity` y `scale(0.98 → 1)`, salida en 120 ms; fondo sin desenfoque.                                          | S        | B      | P0        |
| D5  | Rechazo: atrapar el foco, devolverlo al botón de origen y añadir un botón para cerrar.                                                         | S        | B      | P0        |
| D6  | «Rechazar» también dentro del detalle, como acción secundaria.                                                                                 | S        | M      | P1        |
| D7  | **Un solo componente de detalle** para el tablero y Llamadas, con las mismas etiquetas y formatos (I2, I6).                                    | M        | M      | P1        |

### 4.3 Worker: Llamadas

| ID  | Mejora                                                                                                                                 | Esfuerzo | Riesgo | Prioridad |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | --------- |
| L1  | **Estados de carga y error**, los mismos de W2; nunca «0» si el listado falló.                                                         | S        | B      | P0        |
| L2  | Vacío con texto: «No hay pedidos esperando entrega.»                                                                                   | S        | B      | P0        |
| L3  | **Razón visible** del bloqueo de «Avisar de nuevo»: texto pequeño bajo la campana («En 3 min», «3 de 3 avisos») y en su `aria-label`.  | S        | B      | P0        |
| L4  | Al entregar, aviso breve «Entregado a Santiago Mora» en la región `aria-live` y selección automática del siguiente pedido de la lista. | S        | M      | P1        |
| L5  | Vocabulario único (I3): el módulo pasa a «Avisos» o la acción a «Llamar de nuevo». Hay que elegir uno (§9, pregunta 6).                | S        | M      | P1        |

### 4.4 Worker: Disponibilidad, Historial y Perfil

| ID  | Mejora                                                                                                                                                                                                                                                                                                                  | Esfuerzo | Riesgo | Prioridad |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | --------- |
| A1  | **Aviso de §2 de decisiones**: al abrir con 0 productos disponibles, «Abriste la cafetería sin productos disponibles. Los clientes verán el menú, pero no podrán pedir.», y al revés, «Marca al menos un producto como disponible.» si está abierta sin ninguno. Confirmación previa o aviso posterior: §9, pregunta 3. | S        | M      | P0        |
| A2  | Orden de categorías como en §11 (I13).                                                                                                                                                                                                                                                                                  | S        | B      | P1        |
| H1  | Historial: quitar el `aria-label` duplicado de los selectores y reservar espacio bajo la lista para la barra inferior en el celular.                                                                                                                                                                                    | S        | B      | P1        |
| P1  | Perfil: enlace «Cambiar contraseña» al flujo de recuperación del panel.                                                                                                                                                                                                                                                 | S        | B      | P2        |

### 4.5 Admin

| ID  | Mejora                                                                                                                                                                                                                                   | Esfuerzo | Riesgo | Prioridad |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | --------- |
| AD1 | Franja de cafetería inactiva coherente con la decisión que tome el dueño (§9, pregunta 2). Si se mantiene el bloqueo: «La cafetería no está visible para los clientes. Pide a UniFood que la active para editar el catálogo.»            | S        | B      | P0        |
| AD2 | Textos del catálogo en lenguaje llano: «La imagen debe pesar como máximo 3 MB.»; «No sabemos si la imagen se guardó. Revisa el producto antes de volver a subirla.»; «Volver a intentar» en lugar de «Reenviar mismo intento de imagen». | S        | M      | P0        |
| AD3 | «Información sobre los datos» del dashboard: una frase tranquila («Algunas cifras pueden estar incompletas.») y el detalle técnico dentro de «¿Por qué?».                                                                                | S        | M      | P0        |
| AD4 | Mensaje de éxito junto al producto editado (o aviso fijo abajo), y foco devuelto a la tarjeta.                                                                                                                                           | S        | B      | P1        |
| AD5 | Formatos únicos: pesos sin centavos salvo que existan, y porcentaje con un decimal (I6).                                                                                                                                                 | S        | M      | P1        |
| AD6 | Esqueleto de carga en el catálogo (I11).                                                                                                                                                                                                 | S        | B      | P1        |
| AD7 | «Resumen» en lugar de «Dashboard» en el título y el menú (§9, pregunta 6).                                                                                                                                                               | S        | M      | P2        |

### 4.6 Super admin

| ID  | Mejora                                                                                                                                                             | Esfuerzo | Riesgo | Prioridad             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | --------------------- |
| SA1 | Plurales correctos («1 cafetería en 1 sede de 1 institución») y leyenda sin «SQL»: «El estado de cada cafetería se cambia desde soporte.» hasta la Fase 4.         | S        | B      | P0, o dentro del PR G |
| SA2 | Columna «Administrador» con «Asignado» o «Sin administrador activo».                                                                                               | S        | B      | P0, o dentro del PR G |
| SA3 | Marca y botón «Actualizar» como en el dashboard del admin.                                                                                                         | S        | B      | P1                    |
| SA4 | En el celular, una tarjeta por cafetería en lugar de la tabla.                                                                                                     | M        | B      | P1                    |
| SA5 | Diseño de los controles de la Fase 4 con estas mismas reglas: confirmación en un diálogo, error junto al control y «Cambios guardados.» en una región `aria-live`. | —        | —      | Con el PR G           |

---

## 5. Antes del 21 de noviembre y después del 28

**Imprescindible antes del congelamiento** (todo S salvo W3; unos 4 o 5 días de trabajo):

- Worker, lo que hoy **engaña** u **oculta** fallos en plena hora pico: W1, W2, W3, W4, L1, L2.
- Worker, lo que confunde en la demo: W5, W6, W7, D1, D2, D3, L3.
- Requisito de decisiones que falta: A1.
- Accesibilidad y movimiento de bajo riesgo: W8, W9, D4, D5.
- Admin y super admin, textos que se verán en la demo: AD1 (según la respuesta del dueño),
  AD2, AD3, SA1 y SA2.

**Puede esperar a después de la demo:** W10 a W15, D6, D7, L4, L5, A2, H1, AD4 a AD7, SA3 y SA4.
W12 (quitar la escala 0.7) es lo más valioso de esta lista, pero cambia la maqueta entera del
worker: no conviene a una semana de la demo salvo que la tableta real lo exija (§9, pregunta 4).

**Si falta tiempo**, el mínimo para la demo es W1, W2, W3, W4, L1 y A1.

---

## 6. Orden de implementación y archivos

Cada PR sale de `develop` con prefijo `jj/`, en el orden de la tabla dentro de cada panel. Los
del worker van **en serie** porque comparten `WorkerDashboard.tsx`. Worker, admin y super
admin pueden ir **en paralelo** entre sí. Ningún PR toca `app/cuenta/**` ni `features/client/**`.

### Worker

| PR  | Rama sugerida                | Mejoras                    | Archivos                                                                                                                                                                                                                                                     |
| --- | ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `jj/ui-worker-estados`       | W1, W2, W5, W6, W8, L1, L2 | `features/orders/hooks/useOrders.ts`; `components/worker/{WorkerDashboard,KanbanBoard,CallsBoard,Header}.tsx` y `Header.module.css`. Componentes nuevos (franja de estado, región `aria-live`) en `features/orders/components/`, no en `components/worker/`. |
| 2   | `jj/ui-worker-mensajes`      | W3, W4                     | `features/orders/api/orderApi.ts`; nuevo `features/orders/orderActionMessages.ts`; nuevo `features/orders/components/OrderActionAlert.tsx`; `components/worker/WorkerDashboard.tsx` (se retira el diálogo en línea); `features/orders/hooks/useOrders.ts`.   |
| 3   | `jj/ui-worker-detalle`       | W7, D1, D2, D3, D5, L3     | `components/worker/{OrderCard,OrderDetail,CallsBoard}.tsx` y `OrderDetail.module.css`; `lib/orderTime.ts`; `features/orders/components/{RejectOrderDialog,CalledOrderActions}.tsx`.                                                                          |
| 4   | `jj/ui-worker-movimiento`    | W9, D4                     | Solo CSS: `components/worker/{Header,OrderCard,OrderDetail,BottomNav,KanbanBoard}.module.css` y un nuevo `features/orders/components/motion.module.css` con los tokens. **No** se toca `app/globals.css`, que comparten el login y el cliente.               |
| 5   | `jj/ui-disponibilidad-aviso` | A1                         | `features/availability/{state.ts,presentation.ts}` y `components/AvailabilityPanel.tsx`. Independiente de los PR 1 a 4.                                                                                                                                      |

### Admin y super admin

| PR  | Rama sugerida                                                       | Mejoras       | Archivos                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | `jj/ui-admin-textos`                                                | AD1, AD2, AD3 | `features/admin/components/AdminShell.tsx`; `features/admin-catalog/{images.ts,errors.ts}` y `components/ProductDrawer.tsx` (solo textos); `features/admin-dashboard/components/DashboardCoverage.tsx`. |
| 7   | Dentro del PR G de la Fase 4, o antes en `jj/ui-super-admin-textos` | SA1, SA2      | `features/super-admin/{presentation.ts,components/SuperAdminPanel.tsx}`. **Se coordina con el PR G**, que reescribe estos archivos.                                                                     |

### Riesgos y pruebas

- **Pruebas que fijan textos o estructura**: `tests/{roles,worker-order-note,worker-pickup-time,availability-ui,worker-profile-ui}.test.mjs` y `tests/e2e/{roles,auth-audit}.spec.ts`. Cada PR actualiza las suyas en el mismo cambio. Para AD2 y AD3 hay que revisar además `tests/e2e/admin-product-images.spec.ts` y `admin-dashboard.spec.ts`.
- **W3 y W4** cambian cómo llegan los errores de las acciones: la prueba nueva cubre cada código con su frase y comprueba que un 409 FIFO no bloquea el tablero.
- **W1** no puede retirar los pedidos conocidos cuando falla un sondeo: hace falta una prueba de «falla el sondeo y los pedidos siguen visibles».
- **Verificación por PR**: `npm run lint`, `npx tsc --noEmit --incremental false`, `npm test`, `npx prettier --check` sobre los archivos tocados y el e2e del área con `PLAYWRIGHT_PRODUCTION=true`. Para el movimiento, una pasada con la emulación de `prefers-reduced-motion: reduce`.
- **Accesibilidad**: una pasada de axe sobre Pedidos, Llamadas y el detalle antes y después del PR 1, para cerrar las dudas de contraste de §2.1.

---

## 7. Mejoras de flujo del cliente (solo anotadas)

Área de Jonathan. **No se implementa nada aquí.** Revisión de solo lectura de `develop`.

1. **No existe la pantalla «Mi pedido»** (§4 y §7 de decisiones; §13 la da por no negociable).
   Las rutas de `app/cuenta` son inicio, menú, producto, carrito, resumen, perfil y contraseña.
   El contexto trae `activeOrder`, pero ninguna pantalla lo usa. Sin ella, el cliente no ve
   «en preparación», ni el aviso del worker, ni el motivo de un rechazo, ni puede cancelar.
   **Es el mayor riesgo de la demo**: el worker avisa y nadie recibe el aviso.
2. Tras «Pedido enviado», el botón lleva a `/cuenta`. Debería llevar a «Mi pedido» cuando exista.
3. Con un pedido activo, el inicio debería mostrar una franja persistente «Tu pedido está en
   preparación» y llevar a «Mi pedido», en lugar de descubrir `ACTIVE_ORDER_EXISTS` al pagar.
4. Avisos de §7 (sonido y título de la pestaña): conviene que los dispare el mismo sondeo de
   «Mi pedido», con un solo aviso por cambio de estado y respetando `prefers-reduced-motion`.
5. Usar el mismo vocabulario que el worker tras L5: si el worker «avisa», el cliente recibe
   «Tu pedido está listo. Te esperamos en la caja.».
6. Rechazo: mostrar «La cafetería rechazó tu pedido: <motivo>» con la acción «Hacer otro
   pedido».
7. La preferencia de sede y cafetería en el servidor sigue pendiente (§4).
8. El historial del cliente puede esperar (§13, punto 5).

---

## 8. Lo que no cambia

- Ninguna regla de negocio, ningún contrato de API y ningún BFF, salvo leer el código de error
  que ya llega (W4).
- La navegación de los tres paneles.
- La marca, los azules y blancos, y la tipografía actual de los paneles (Inter se carga solo en
  `/cuenta`, §8).

---

## 9. Preguntas abiertas para el dueño

1. **Congelamiento.** ¿Las correcciones de UX de §5 pueden fusionarse después del 21 como
   arreglos, o todo lo P0 tiene que estar dentro antes del 21?
2. **Catálogo con la cafetería inactiva.** §5 dice que el ADMIN configura el catálogo; el
   código (frontend y Spring, `ADMIN_CATALOG_CAFETERIA_INACTIVE`) lo bloquea. ¿Cuál vale? Si
   vale §5, hace falta un cambio de backend fuera de este rediseño.
3. **Abrir sin productos disponibles (A1).** ¿Confirmación antes de abrir o aviso después de
   abrir?
4. **Dispositivo del worker** en la demo y en el piloto: ¿tableta, computador o celular, y de
   qué tamaño? Decide si W12 (quitar la escala 0.7) sube a P0.
5. **Pedido nuevo (W11).** ¿Insignia visual sola, o también sonido para el worker? No está en
   decisiones.
6. **Vocabulario.** ¿«Avisar» o «Llamar» (L5)? ¿«Resumen» o «Dashboard» (AD7)? Cambiar textos
   visibles obliga a actualizar pruebas.
7. **Dashboard en la demo.** ¿Se simplifica «Información sobre los datos» (AD3) o se oculta
   mientras dure la demo?
8. **Super admin.** ¿SA1 y SA2 van dentro del PR G de la Fase 4 o en un PR propio antes?
9. **«Entregados»** muestra solo los 5 últimos. ¿Es intencional o deberían verse todos los de
   hoy?
10. **Skill de movimiento.** Este PR versiona `.claude/skills/design-motion-principles/` (licencia
    MIT, conservada en la carpeta). ¿La queremos en el repo o solo local?

---

## Anexo A. Skill `design-motion-principles`

- **Origen**: `github.com/kylezantos/design-motion-principles`, commit `4a9ca87` (2026-05-30),
  licencia MIT. Se copió solo `skills/design-motion-principles/` y se añadió su `LICENSE`.
- **Revisión previa**: solo Markdown y dos plantillas HTML sin `<script>`, formularios ni
  iframes. Sin hooks, scripts ejecutables, descargas de binarios, telemetría ni `allowed-tools`.
  Dos cosas a tener en cuenta: el informe HTML de auditoría carga fuentes de Google Fonts al
  abrirse, y el flujo de auditoría propone abrirlo con `start` u `open`. En este repositorio se
  pide el modo terminal (`--terminal`) para que no escriba en `motion-audits/` ni abra nada.
- **Qué hace**: dos modos. _Create_ construye componentes con movimiento según tres
  referentes (Emil Kowalski, Jakub Krehel y Jhey Tompkins), ponderados por contexto. _Audit_
  revisa el movimiento existente: busca huecos de movimiento, aplica una lista de patrones
  «AI-slop» (pulsos, escalas al pasar el cursor, escalonados, rebotes) y exige
  `prefers-reduced-motion`.
- **Cuándo se activa**: Claude la carga cuando una petición trata de animaciones,
  transiciones, estados de hover, microinteracciones o entradas y salidas, o de revisar
  movimiento. Elige _Create_ con «crear», «añadir animación» o «animar», y _Audit_ con
  «auditar», «revisar» o «evaluar». Si la petición es ambigua, pregunta. También se invoca
  por su nombre.

## Anexo B. Cómo se obtuvieron las capturas

1. Copia de `unifood-web/tests/helpers` y `tests/fixtures` en una carpeta temporal fuera del
   repositorio, con el puerto del simulador cambiado de 3101 a 3201 **solo en la copia**.
2. `next dev --hostname 127.0.0.1 --port 3200` con `API_URL` y `SUPABASE_URL` hacia el 3201 y
   la clave publicable falsa de Playwright.
3. Un script de Playwright (Edge) inicia sesión como `worker@`, `backendunavailable@`,
   `admin@` y `superadmin@example.invalid` y siembra el tablero con `/__test/worker-orders`.
4. Los servidores se detuvieron al terminar y el repositorio quedó sin cambios.

---

## Tokens

Identidad aprobada por el dueño (ola 2): sobria, minimalista y elegante. Azules y blancos, rojo y
verde apagados; sin amarillo ni colores extra. Los valores viven **solo** en
`unifood-web/app/tokens.css`; los componentes usan `var(--…)`.

### Color

| Token                                             | Valor                             | Uso                                                       |
| ------------------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `--color-ink`                                     | `#0F172A`                         | Texto principal (sustituye al negro)                      |
| `--color-text-soft`                               | `#64708A`                         | Texto de apoyo; borde de inputs y controles               |
| `--color-slate`                                   | `#475266`                         | Secundario; texto de apoyo sobre `brand-tint`             |
| `--color-brand` / `--color-brand-hover`           | `#1E4FD8` / `#1A40AE`             | Acción principal, enlaces, foco                           |
| `--color-brand-tint` / `--color-brand-tint-2`     | `#EEF3FF` / `#DCE6FB`             | Avisos e información, nav activa, resalte de pedido nuevo |
| `--color-bg` / `--color-surface` / `--color-line` | `#F6F7F9` / `#FFFFFF` / `#E5E8EE` | Fondo de página, tarjetas, bordes decorativos             |
| `--color-success` / `-bg` / `-ink`                | `#2E7D5B` / `#E6F2EC` / `#1F5E43` | «Marcar como listo», éxito, chip Listo                    |
| `--color-danger` / `-bg` / `-ink`                 | `#C8323A` / `#FDECEE` / `#9E2530` | Rechazar, errores, chips Rechazado y No recogido          |
| `--color-neutral-chip-bg` / `-ink`                | `#EEF0F4` / `#475266`             | Chip Entregado                                            |

### Contraste (WCAG 2.x, calculado)

| Pareja                             | Uso                                  | Contraste | Nivel          |
| ---------------------------------- | ------------------------------------ | --------- | -------------- |
| ink / surface                      | Texto principal sobre tarjeta        | 17.85:1   | AAA            |
| ink / bg                           | Texto principal sobre fondo          | 16.65:1   | AAA            |
| text-soft / surface                | Texto de apoyo sobre tarjeta         | 4.97:1    | AA             |
| text-soft / bg                     | Texto de apoyo sobre fondo           | 4.64:1    | AA             |
| slate / surface                    | Secundario sobre tarjeta             | 7.87:1    | AAA            |
| brand / surface                    | Enlace o texto brand sobre tarjeta   | 6.63:1    | AA             |
| brand / bg                         | Enlace sobre fondo                   | 6.19:1    | AA             |
| white / brand                      | Botón primario / chip En preparación | 6.63:1    | AA             |
| white / brand-hover                | Botón primario en hover              | 8.79:1    | AAA            |
| brand-hover / brand-tint           | Chip Pendiente / aviso               | 7.91:1    | AAA            |
| ink / brand-tint                   | Texto sobre aviso brand-tint         | 16.07:1   | AAA            |
| ink / brand-tint-2                 | Texto sobre brand-tint-2             | 14.24:1   | AAA            |
| text-soft / brand-tint             | Apoyo sobre brand-tint               | 4.47:1    | AA grande / UI |
| white / success                    | Botón de éxito                       | 5.00:1    | AA             |
| success-ink / success-bg           | Chip Listo / mensaje de éxito        | 6.67:1    | AA             |
| white / ink                        | Chip Llamado / barra de carrito      | 17.85:1   | AAA            |
| neutral-chip-ink / neutral-chip-bg | Chip Entregado                       | 6.90:1    | AA             |
| danger-ink / danger-bg             | Chip Rechazado / mensaje de error    | 6.67:1    | AA             |
| danger / surface                   | Botón de peligro (texto)             | 5.29:1    | AA             |
| danger-ink / surface               | Chip No recogido                     | 7.61:1    | AAA            |
| brand / brand-tint                 | Brand sobre brand-tint (nav activa)  | 5.97:1    | AA             |
| brand / surface                    | Anillo de foco (no texto, ≥3:1)      | 6.63:1    | AA             |
| line / surface                     | Borde (decorativo)                   | 1.23:1    | NO             |

- Todas las parejas de texto cumplen AA salvo `text-soft` sobre `brand-tint` (4,47:1). Regla: **sobre `brand-tint` el texto de apoyo va en `slate`** (7,87:1 sobre blanco; más de 6:1 sobre el tinte).
- `line` (1,23:1) es solo decorativo. El límite de inputs y controles usa `--color-control-border` (`text-soft`, 4,97:1), para cumplir el contraste no textual (WCAG 1.4.11).
- El anillo de foco (`brand`, 2 px con 2 px de separación) tiene 6,63:1 sobre blanco.

### Tipografía, forma y movimiento

- **Figtree** con `next/font/google`, pesos 500, 600, 700 y 800, autoalojada en el build (sin peticiones a Google en ejecución). `font-variant-numeric: tabular-nums` en precios, códigos y horas (`time` y la clase `.tabular`).
- Radios: 12 (controles pequeños), 20 (botones e inputs), 28 (tarjetas y contenedores) y píldora (chips y navegación). **Arco de la U**: cabeceras de columna o sección `12 12 28 28` e imágenes de producto `28 28 40 40`.
- Una sola sombra, para tarjetas elevadas: `0 12px 24px -16px rgba(15, 23, 42, .25)`.
- Movimiento según la skill: entradas de 8 px en 200 a 240 ms con `cubic-bezier(0.2, 0, 0, 1)`, botones que se hunden un 3 % al pulsar, un pedido nuevo del worker con un resalte `brand-tint` una sola vez, y nada que se anime al refrescar por sondeo. Con `prefers-reduced-motion`, solo opacidad (hoy la regla global de `globals.css` las reduce a 0,01 ms).

### Componentes compartidos (`unifood-web/components/ui/`)

| Componente                      | Qué resuelve                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`, `buttonClass`         | Primario (brand), éxito, peligro en contorno nunca mayor que el primario, secundario; 48 px, o 56 px con `touch`                                |
| `StatusChip` y `orderStatus.ts` | **Único mapa** de estados: Pendiente, En preparación, Listo, Llamado, Entregado, Rechazado, No recogido y Cancelado                             |
| `Card`, `ArchHeader`            | Contenedor de radio 28 con sombra opcional; cabecera en arco con tono tinte, brand, éxito o neutro                                              |
| `Field`                         | Etiqueta, input de radio 20, ayuda y error anunciado                                                                                            |
| `PillNav`                       | Navegación inferior o pestañas en píldora, con `aria-current`                                                                                   |
| `EmptyState`                    | Icono, una frase y como mucho una acción                                                                                                        |
| `Notice`                        | Mensaje de respuesta: éxito en verde, error en rojo (`alert`), aviso o información en `brand-tint` (`status`); `floating` lo convierte en toast |

`lib/messages.ts` reúne los textos que varios paneles repetían palabra por palabra (sesión no verificable, sesión vencida, pedido que cambió de estado), sin cambiar su redacción.
