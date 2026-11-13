# Decisiones del proyecto UniFood

Plan v2 aprobado el 2026-11-04. Este documento manda sobre cualquier decisión anterior
que lo contradiga. Los puntos marcados «pendiente» requieren confirmación.

## 1. Alcance y calendario

- 1 universidad, 1 sede y 2 cafeterías en el piloto. Villavicencio tiene dos sedes; solo
  una tiene cafeterías.
- Demo a los administradores de las cafeterías antes del 28 de noviembre de 2026, con
  piloto real después. Congelación de funciones: 21 de noviembre.
- Pagos solo en efectivo en caja, sin pasarela. El cobro del servicio a las cafeterías
  se gestiona fuera de la app. Un pedido no recogido solo se registra, sin sanciones.

## 2. Roles

- **CLIENTE** (estudiante, docente o administrativo): crea y cancela pedidos.
- **WORKER**: opera pedidos, fija la disponibilidad diaria y abre o cierra su cafetería
  con un botón. El panel avisa si abre la cafetería sin marcar nada disponible.
- **ADMIN**: gestiona catálogo y dashboard de su cafetería. No opera pedidos.
- **SUPER_ADMIN**: solo dos cuentas (dueño del repositorio y Jonathan Panesso), sembradas
  por script o migración controlada, nunca por registro ni por la UI. Su panel crea
  universidades, sedes, cafeterías y credenciales de ADMIN y WORKER, activa o desactiva
  la suscripción de cada cafetería y muestra el dashboard de clientes. Se recomienda 2FA
  y no compartir contraseña.
- **Credenciales de WORKER y ADMIN**: las crea SUPER_ADMIN sin depender del dominio del
  correo, con cambio obligatorio en el primer ingreso, mediante una preautorización en
  servidor y la API de administración de Supabase (§3). La service role key vive solo en
  el backend. La contraseña temporal se muestra una sola vez al SUPER_ADMIN (`no-store`,
  sin logs). Cuando Resend esté listo con dominio propio, pasa a correo.

## 3. Registro e identidad

- Auto-registro solo con dominios institucionales; cualquier otro se rechaza. Todos
  entran con rol cliente.
- Dominios en la tabla `institution_email_domains`, no en código, con `domain`,
  `institution_id`, `client_type`, `code_required`, `min_code_length` y
  `max_code_length`. **Dominios de la universidad: `ustavillavo.edu.co` (STUDENT) y
  `ustavillavicencio.edu.co` (STAFF: docentes y administrativos, con un solo
  `client_type`).**
- El dominio se compara por igualdad exacta, sin distinguir mayúsculas. Se rechazan
  subdominios y dominios parecidos, como `ustavillavo.edu.co.evil.com` o
  `evilustavillavo.edu.co`, y los correos con `+` o espacios.
- La regla se valida en la base de datos (trigger de la 018), no solo en el BFF, para que
  no se salte con un signup directo usando la clave pública.
- **Identidades fuera de la regla:** solo con una preautorización previa en una tabla
  cerrada a `anon`, `authenticated` y `service_role`, que se escribe con SQL controlado o
  desde el backend: correo, rol, institución, tipo de cliente y expiración, de un solo uso
  y como máximo 1 hora. La API de administración crea la identidad y el trigger consume
  esa preautorización. No se usa una marca en `app_metadata`: Auth la escribe después de
  insertar el usuario, y el trigger no la ve (hallazgo F1 de la revisión de la 018).
- **Uso de `preauthorize_identity`:** se ejecuta justo antes de crear la cuenta con la API
  de administración, nunca con anticipación: mientras está vigente, cualquier signup con
  ese correo la consume. Si la cuenta es de cliente, el paso 2 se completa de inmediato,
  porque la limpieza la borra a las 24 horas.
- Se guarda el tipo de cliente, deducido del dominio.

**Registro en dos pasos** (aprobado el 2026-11-07, propuesta A de la revisión de la 018):

1. **Signup:** solo correo y contraseña. La base valida el dominio y crea una identidad
   inactiva, sin nombre, código ni privacidad. Auth envía el OTP.
2. **Tras confirmar el OTP**, en una llamada autenticada: nombre, código, aceptación de
   privacidad, y la contraseña **actualizada** en Auth. Se cierran las demás sesiones.
   La base comprueba que el hash cambió desde el signup; como bcrypt usa una sal nueva,
   eso prueba que hubo una actualización, no que la contraseña sea distinta. El código se
   reserva en este paso, así que reservarlo exige tener el buzón.

- Motivo: con un solo paso, quien se registra primero con un correo ajeno fija la
  contraseña y el código que quedan activos cuando el dueño confirma, y un buzón
  inexistente retiene el código de un estudiante real.
- Hasta completar el paso 2, la cuenta no opera: no ve contexto, menú ni pedidos.
- **Condiciones del BFF** (aprobadas el 2026-11-07):
  - La contraseña del paso 1 la genera el servidor con un generador criptográfico, nunca
    el navegador. No se registra en logs ni se devuelve al cliente.
  - `complete_registration()` actúa solo sobre la cuenta de `auth.uid()`: no recibe otra
    cuenta y falla si ya se completó.
  - Orden: el BFF cambia la contraseña en Auth y cierra las demás sesiones **antes** de
    llamar a `complete_registration()`. La base rechaza el paso 2 si la contraseña no se
    actualizó desde el signup.
  - Si falla a mitad, la cuenta queda confirmada pero sin completar: no opera, conserva
    la contraseña actualizada y puede repetir el paso 2 sin un código nuevo mientras dure
    la sesión. Pasadas 24 horas la borra la limpieza.
  - Tras un signup público, el paso 2 exige una sesión emitida al verificar el código
    del correo (`amr` con `otp`). Con una sesión de contraseña se rechaza, así que quien
    eligió la contraseña del signup con un correo ajeno no puede completarlo. Las cuentas
    preautorizadas por el servidor, como las de la demo, sí pueden completarlo con
    contraseña.
- **Flujo en la web (B7):**
  1. `/registro`: el usuario escribe su correo. `registration_rules()` informa si el
     dominio vale y el tipo de cuenta, sin decir si la cuenta existe. El signup responde
     igual exista o no.
  2. El código llega al correo y vence a los 15 minutos, como los 900 s de Auth. Se
     puede reenviar con 60 s de espera y hasta 3 veces por pantalla; el límite de
     Supabase se muestra con un mensaje claro.
  3. Al verificarlo, la sesión queda en las cookies HttpOnly y la web lleva a
     `/registro/completar`. Ahí se piden nombre, código, privacidad y contraseña. Las
     longitudes del código salen de `pending_registration()`.
  4. Al terminar, la cuenta entra a `/cuenta`.
- **Reanudar:** una cuenta pendiente que entra con sesión vigente, por login o por
  recuperación, vuelve a `/registro/completar` y no llega a ninguna pantalla del cliente.
  Sin sesión, usa «¿Olvidaste tu contraseña?»: el código de recuperación también da una
  sesión `otp` y lleva al paso 2, donde fija la contraseña. Pasadas 24 horas la cuenta se
  borra y hay que registrarse de nuevo.
- **Cuentas sin completar:** se eliminan a las 24 horas de creadas si no completaron el
  paso 2, hayan confirmado el correo o no, y solo si nada más apunta a ellas: perfil de
  cliente, pedidos, roles, cafeterías, notificaciones ni correcciones de código. Con
  registro de auditoría sin el correo, un límite de cuentas por ejecución y un interruptor
  para pausarlo. Se programa con `pg_cron`, que el responsable activa en el panel, primero
  en staging. Las cuentas anteriores a la 018 nunca se borran solas.
- Verificación: OTP de 6 dígitos generado por Supabase y enviado al correo (plantilla con
  `{{ .Token }}`, no enlace). Solo prueba que el usuario es dueño del correo; no es dato
  de negocio.
- La cuenta queda inactiva hasta confirmar el correo. Spring también rechaza cuentas no
  confirmadas, sin confiar solo en el BFF.
- Datos de registro: correo institucional en el paso 1; nombre y código institucional
  (solo dígitos y único) en el paso 2. Obligatorio para estudiantes; opcional para
  docentes y administrativos. Sin teléfono ni documento.
- Longitud del código configurable **por dominio**, no por institución: `code_required`,
  `min_code_length` y `max_code_length` en `institution_email_domains`. No se fija en
  código.
  - **Estudiantes:** numérico de exactamente 7 dígitos, obligatorio (`7-7`).
  - **Docentes y administrativos:** de 5 a 12 dígitos, opcional (`5-12`).
- Código único por institución: índice único parcial sobre institución y código, que ignora
  los nulos.
- Si alguien reclama un código por error, SUPER_ADMIN lo libera en una transacción con
  registro de auditoría y marca la cuenta como «código en revisión». Se hace con un script
  local hasta que exista el panel.
- Casilla de aceptación de la política de privacidad, con fecha guardada (Ley 1581). Enlaza
  a `/privacidad`, que hoy es un **borrador pendiente de revisión legal**: no es la
  política definitiva y queda para la auditoría de legalidad.
- El worker ve solo nombre y código institucional, o nombre y tipo de cliente si no hay
  código.

**Cuentas de la demo del 28 de noviembre:** las crea el responsable en
`unifood-staging`, ya confirmadas, sin pasar por el registro público. El registro con OTP
no se muestra hasta tener dominio (§9). Procedimiento, todo en staging:

1. Preautorizar cada correo en el SQL Editor de staging **justo antes** del paso 2, de uno
   en uno y nunca con anticipación. La preautorización vale 15 minutos y un solo uso; el
   correo se escribe ahí y nunca se versiona:

   ```sql
   SELECT public.preauthorize_identity(
     'CORREO_DE_LA_DEMO', 'CLIENT',
     (SELECT id FROM public.institutions WHERE email_domain = 'ustavillavo.edu.co'),
     'STUDENT');
   ```

2. En seguida, crear la identidad en el panel de staging, en Authentication >
   Users > Add user > Create new user, con una contraseña provisional y **Auto Confirm
   User** marcado. Usa la API de administración y no envía correo.
3. Comprobar que quedó confirmada y pendiente del paso 2:

   ```sql
   SELECT u.is_active, u.email_confirmed_at IS NOT NULL AS confirmed, p.client_type
   FROM public.users u JOIN public.pending_registrations p ON p.user_id = u.id
   WHERE u.email = lower('CORREO_DE_LA_DEMO');
   ```

   Esperado: `false`, `true` y el tipo pedido.

4. En el primer ingreso, la persona hace el paso 2 como cualquier cliente: nombre,
   código, privacidad y actualizar la contraseña provisional. Necesita B7.
5. Tras la demo, se eliminan desde Authentication > Users. El borrado en cascada alcanza
   su perfil.

- Correos: buzones que controle el responsable. **No se inventan direcciones
  `@ustavillavo.edu.co`**: podrían pertenecer a un estudiante real y bloquearían su
  registro o su código.
- Códigos: valores de prueba que no correspondan a estudiantes reales.
- **El paso 2 debe hacerse antes de 24 horas desde la creación:** si no, la limpieza borra
  la cuenta. Conviene crearlas el mismo día del ensayo y completarlas en seguida.

**Siembra y cuentas ADMIN y WORKER de la demo**, todo en `unifood-staging`, con 001-021
aplicadas. Ningún paso envía correos. Sustituye `TU_GMAIL` por la parte de tu dirección de
Gmail antes de la `@`: se usan los alias `+admin` y `+worker`, que llegan al mismo buzón.

1. **Siembra.** En el SQL Editor, pega en la misma ejecución:

   ```sql
   SET unifood.seed_target = 'staging';
   ```

   seguido del contenido de `scripts/supabase/seed-demo.sql`. Crea «Sede Principal»,
   «Cafetería Central» **inactiva**, los 8 productos y el estado abierto y la
   disponibilidad de hoy. Repetirlo no cambia lo que ya existe.

2. **ADMIN.** Justo antes de crearlo, nunca con anticipación (la preautorización vale 15
   minutos y un solo uso):

   ```sql
   SELECT public.preauthorize_identity('TU_GMAIL+admin@gmail.com', 'ADMIN');
   ```

   En seguida, en Authentication > Users > Add user > Create new user, el mismo correo,
   una contraseña tuya y **Auto Confirm User** marcado. Usa la API de administración y no
   envía correo.

3. **Rol, asignación y activación**, en una sola ejecución. La 009 exige que una
   cafetería activa tenga su ADMIN activo y asignado, y lo comprueba al confirmar la
   transacción:

   ```sql
   BEGIN;
   INSERT INTO public.user_roles (user_id, role_id)
     SELECT u.id, r.id FROM public.users u, public.roles r
     WHERE u.email = lower('TU_GMAIL+admin@gmail.com') AND r.name = 'ADMIN';
   INSERT INTO public.cafeteria_users (cafeteria_id, user_id)
     SELECT c.id, u.id
     FROM public.cafeterias c
     JOIN public.sites s ON s.id = c.site_id
     CROSS JOIN public.users u
     WHERE s.name = 'Sede Principal' AND c.name = 'Cafetería Central'
       AND u.email = lower('TU_GMAIL+admin@gmail.com');
   UPDATE public.users SET is_active = true WHERE email = lower('TU_GMAIL+admin@gmail.com');
   UPDATE public.cafeterias SET is_active = true
     WHERE name = 'Cafetería Central'
       AND site_id = (SELECT id FROM public.sites WHERE name = 'Sede Principal');
   COMMIT;
   ```

4. **WORKER.** Igual que el 2 con `'TU_GMAIL+worker@gmail.com'` y el rol `'WORKER'`, y el 3
   con ese correo, `r.name = 'WORKER'` y **sin** la última sentencia `UPDATE public.cafeterias`.
5. **Comprobación:**

   ```sql
   SELECT u.email, r.name AS role, u.is_active, c.is_active AS cafeteria_active
   FROM public.users u
   JOIN public.user_roles ur ON ur.user_id = u.id
   JOIN public.roles r ON r.id = ur.role_id
   JOIN public.cafeteria_users cu ON cu.user_id = u.id
   JOIN public.cafeterias c ON c.id = cu.cafeteria_id;
   ```

   Esperado: las dos cuentas activas, con su rol, en la cafetería activa. Ambas entran por
   `/panel/login` con la contraseña que les pusiste.

- **Cada día de ensayo, el WORKER abre la cafetería** desde su panel. La siembra solo deja
  abierta la fecha en que se ejecutó, y en America/Bogota.
- `tests/order-schema.test.mjs` ejecuta esta misma secuencia en una base local.

**Cuenta SUPER_ADMIN de staging** (provisional para la demo, decidido el 2026-11-10). Todo
en `unifood-staging`, con 001-021 aplicadas; nunca en el proyecto real. Como máximo **dos
cuentas** (§2). El script local de §10 sigue **pendiente** y es el que se usará antes del
piloto. `CORREO` es un marcador: la dirección real se escribe solo en el SQL Editor y nunca
se versiona.

1. **Comprobar el tope** antes de crear nada:

   ```sql
   SELECT count(*) FROM public.user_roles ur
   JOIN public.roles r ON r.id = ur.role_id WHERE r.name = 'SUPER_ADMIN';
   ```

   Si devuelve 2, parar: no se crea una tercera cuenta.

2. **Preautorizar**, justo antes del paso 3 y nunca con anticipación (vale 15 minutos y un
   solo uso). SUPER_ADMIN no lleva institución ni tipo de cliente:

   ```sql
   SELECT public.preauthorize_identity('CORREO', 'SUPER_ADMIN');
   ```

3. En seguida, en Authentication > Users > Add user > Create new user, el mismo correo, una
   contraseña propia y **Auto Confirm User** marcado. No envía correo.
4. **Rol y activación, sin cafetería**, en una sola transacción: en el SQL Editor, pega
   `SET unifood.seed_target = 'staging';` seguido del contenido de
   `scripts/supabase/seed-super-admin.sql`, con `CORREO` sustituido. El script bloquea las
   escrituras de roles hasta el `COMMIT`, comprueba el tope dentro de la transacción
   (`DO $$ … RAISE EXCEPTION`), asigna el rol y activa la cuenta. Si falla, no aplica nada:
   - `SUPER_ADMIN_LIMIT`: ya hay dos. Borra la identidad recién creada en Authentication >
     Users.
   - `SUPER_ADMIN_IDENTITY_MISSING`: el correo no coincide con la identidad del paso 3.
5. **Comprobación:**

   ```sql
   SELECT u.email, u.is_active, u.email_confirmed_at IS NOT NULL AS confirmed,
          (SELECT count(*) FROM public.cafeteria_users cu WHERE cu.user_id = u.id) AS cafeterias
   FROM public.users u
   JOIN public.user_roles ur ON ur.user_id = u.id
   JOIN public.roles r ON r.id = ur.role_id
   WHERE r.name = 'SUPER_ADMIN';
   ```

   Esperado: como máximo dos filas, activas, confirmadas y con 0 cafeterías. Entra por
   `/panel/login` y llega a `/super-admin`. Se recomienda 2FA y no compartir la contraseña.

- `tests/super-admin-seed.test.mjs` ejecuta el script en una base local: dos cuentas, el
  rechazo de la tercera y la negativa fuera de staging.
- **GRANT:** comprobado en staging con la conexión de administración (no con la sesión de
  Spring): el rol postgres es dueño de las tablas y funciones, por lo que no hacen falta
  GRANT. Confirmar con `select current_user` desde Spring antes del piloto en el proyecto
  real.

## 4. Flujo del cliente

1. Registro en dos pasos con OTP (§3) e inicio de sesión. El dominio del correo determina
   la universidad; el cliente no la elige.
2. Elegir sede y luego cafetería entre las ACTIVAS de esa sede.
3. Pantalla principal con módulos Inicio, Mi pedido, Historial y Perfil: barra inferior en
   celular, sidebar en escritorio y carrito como botón flotante o dentro de Inicio.

- Modelo multi-sede y multi-cafetería desde ya.
- Si solo hay una opción de sede o de cafetería, se salta ese paso, con selector visible
  para cambiar.
- La última sede y cafetería se guardan en el servidor; localStorage es solo caché. El
  servidor valida que la cafetería siga activa y, si no, devuelve a la selección.

## 5. Suscripción y estado de cafetería

- **ACTIVA/SUSCRITA**: interruptor booleano que solo SUPER_ADMIN cambia, sin vencimiento.
- **ABIERTA/CERRADA**: la fija el WORKER.
- Cafetería no suscrita: no aparece para el cliente, ni en selección ni en su contexto.
  Su WORKER y ADMIN sí entran a su panel y configuran el catálogo.
- El backend aplica la regla: menú, guardar preferencia y crear pedido rechazan cafeterías
  no suscritas aunque se llame directo a la API, con código propio y mensaje fijo.
- Al desactivar una cafetería, los pedidos en curso se atienden hasta su estado final,
  incluido el cierre diario. Solo se bloquean los pedidos nuevos.
- Sin cafeterías activas en la sede: «Aún no hay cafeterías disponibles en tu sede».
- Cada cambio del interruptor registra quién y cuándo, en la misma transacción.
- **Demo (decidido el 2026-11-08):** ACTIVA/SUSCRITA se lee de `cafeterias.is_active`. La
  tabla propia de suscripciones, con su historial de quién y cuándo, queda como **deuda
  antes del piloto**: hasta entonces el cambio de suscripción no deja registro propio.

## 6. Pedido

- Una sola cafetería. **Hora de recogida opcional (decidido por el dueño del producto el
  2026-11-11; sustituye a «sin hora programada»):**
  - Sin hora, el pedido es «lo antes posible» y aparece de inmediato en el panel del worker,
    sin franjas horarias.
  - Con hora (`requestedPickupAt`, 023), debe ser posterior a ahora y del día de negocio
    actual en America/Bogota; si no, 400 `INVALID_PICKUP_TIME`.
  - La hora es **solo informativa**: no cambia el orden FIFO de la cola ni el cierre diario.
    La tarjeta del worker muestra «Recoger a las HH:mm» en hora de Bogotá.
  - Sin tiempo estimado ni turno. No hay horario de cafetería en el backend ni en la web:
    abrir y cerrar lo controla el worker con su botón (`CAFETERIA_CLOSED`).
- Un pedido puede mezclar desayuno y almuerzo.
- Un pedido activo por cliente. Una sola nota de hasta 200 caracteres, sin opciones ni
  extras.
- Límites: **10 unidades por producto y 15 unidades en total**.
- Sin stock: manda la disponibilidad diaria del worker, validada en servidor dentro de la
  transacción con locks. Precios y totales siempre en servidor, con idempotencia.
- Menú: con la cafetería **cerrada** se ven los productos activos sin poder pedir; con la
  cafetería **abierta** se muestran con carrusel las categorías con productos disponibles.
- Categoría sin productos disponibles: línea compacta con el nombre de la categoría y
  «No hay productos disponibles de esta categoría por el momento», sin carrusel.
- Filtros de Inicio: Todo, Del día, Desayunos, Corriente, Ejecutivo, Especial y Bebidas.
  «Del día» corresponde a `DEL_DIA`, que ya existe en `catalog_category`.
- Catálogo: todo lo que cada admin cree y active. Se añade `BEBIDA` al enum
  `catalog_category` en migración propia. Categorías libres por cafetería, después del
  piloto. Producto sin foto: inicial sobre azul suave.
- Cancelación: el cliente cancela **solo mientras el pedido esté PENDING, sin plazo** por
  tiempo (confirmado el 2026-11-08).
- **Rechazo (B18, cambio decidido por el dueño del producto el 2026-11-10):** el worker puede
  rechazar un pedido **en PENDING y en PREPARING**, con motivo obligatorio que el cliente ve.
  Sustituye a la regla anterior de «solo en PENDING».
  - Motivo: un pedido en preparación puede no poder completarse (por ejemplo, se acabó un
    ingrediente) y no debe quedar sin salida.
  - **No se rechaza** en READY ni en CALLED (ahí ya existe «No recogido»), ni en los
    terminales DELIVERED, CANCELLED o NOT_COLLECTED.
  - El pedido rechazado queda CANCELLED con `cancellation_source = 'WORKER'`,
    `rejection_reason`, `rejected_by` y `cancelled_at`. El cliente queda libre para crear otro.
- **El worker no cancela** (confirmado el 2026-11-08): la ruta `PATCH /api/orders/{id}/cancel`
  del worker, su botón y su plazo se retiraron el 2026-11-10. Su única salida es el rechazo.
- **El worker ve nombre, código institucional y tipo de cliente, nunca el documento (B20).**
  Los pedidos con la copia de la 021 la usan; los anteriores toman código y tipo del cliente.
  Sin código se muestra el tipo («Estudiante» o «Docente o administrativo»).
- **Listado del worker:** los pedidos activos de cualquier día más los entregados hoy
  (America/Bogota), solo de la cafetería asignada en `cafeteria_users`. Un pedido activo
  atascado de otro día nunca queda invisible.
- **Pedido activo:** PENDING, PREPARING, READY y CALLED. Terminales: DELIVERED,
  NOT_COLLECTED y CANCELLED. La base lo garantiza con el índice único parcial
  `uq_orders_one_active_per_client` (020): un estado terminal cierra el pedido para siempre,
  y uno activo todavía obliga al cliente a recogerlo o cancelarlo.
- **Quién terminó un pedido cancelado** (`orders.cancellation_source`, 021): `CLIENT`, el
  cliente en PENDING; `WORKER`, la cafetería, con `rejection_reason` y `rejected_by` si es
  un rechazo; `SYSTEM`, el cierre diario. Es inmutable una vez fijado.
- Una clave de idempotencia sirve una sola vez por cliente, para siempre: repetirla tras la
  entrega sigue siendo un reintento, nunca un pedido nuevo.
- Cierre diario (America/Bogota): PENDING pasa a CANCELLED por el sistema; PREPARING, READY
  o CALLED pasan a NOT_COLLECTED. La cola FIFO solo considera pedidos del día.
  - **Implementado el 2026-11-12:** al preparar, la cabeza de la cola es el PENDING más antiguo
    creado en el día de negocio actual de America/Bogota (`TimeProvider`). Un PENDING de otro
    día ya no bloquea la cola de hoy y no se puede preparar (409
    `ORDER_PROCESSING_SEQUENCE_VIOLATION`); el worker puede rechazarlo y el cierre diario lo
    cancela.
  - **Automático desde B19 (2026-11-10):** Spring lo ejecuta al arrancar y luego cada hora,
    porque en la demo el backend se apaga de noche y al encenderlo cierra lo del día anterior.
    El script manual queda como herramienta de emergencia (§11).
  - Los pedidos ya terminados no se tocan, incluidos los rechazos del worker (B18,
    `cancellation_source = 'WORKER'`).
  - Se salta las reglas del worker para NOT_COLLECTED (CALLED con 3 recordatorios), igual que
    el script: un pedido olvidado de otro día se cierra en el estado que esté.
- Historial de solo lectura, sin «repetir pedido».

## 7. Notificaciones

Solo dentro de la app, al pasar a preparación y a listo para recoger (CALLED y sus
recordatorios): pantalla «Mi pedido» con polling, aviso visible, sonido y cambio del
título de la pestaña. Web Push queda para después.

**Decidido el 2026-11-08:** los avisos se deducen del estado que devuelve el sondeo de «Mi
pedido». La tabla `notifications` **no se usa por ahora**: no se escribe ni se lee.

## 8. Diseño

Estilo iPhone minimalista, mobile-first, azules y blancos, marca UniFood
(`unifood-logo.png`), cero ruido visual, una acción principal por pantalla, transiciones
cortas y respeto a `prefers-reduced-motion`. Se definen tokens reales del cliente y se
aíslan sus estilos de `globals.css`.

- Tipografía: Inter, cargada solo en `/cuenta`. El resto de la app no cambia.
- Modo oscuro: después del piloto. Los tokens del cliente quedan preparados para añadirlo.

## 9. Infraestructura y Supabase

- Frontend en Vercel. Backend Spring en hosting con contenedor, por decidir.
- **Demo (decidido el 2026-11-08):** la web y Spring corren **en local** contra
  `unifood-staging`. El hosting se decide después.
- **Entornos:** la demo del 28 de noviembre corre sobre `unifood-staging`; el piloto, sobre
  el proyecto real. El real recibe la 018 y B7 en enero de 2027, antes del piloto, tras
  validarlos en staging.
- Supabase en plan gratuito hoy. Migraciones: primero bases temporales locales, luego el
  proyecto de pruebas `unifood-staging`. **Nunca se estrenan en el proyecto real.**

**Supabase Auth verificado por el responsable:** Confirm email activo; OTP de 6 dígitos con
expiración de 900 s; plantilla «Confirm sign up» con `{{ .Token }}`; contraseña mínima de 8
con letras y dígitos; Secure password change activo; anonymous sign-ins y manual linking
apagados; registro público abierto, porque la regla de dominio vive en el trigger de la 018.

**Correo:** SMTP personalizado con Resend activo, con remitente de pruebas
`onboarding@resend.dev`, que solo entrega al correo dueño de la cuenta de Resend.

**Dominio (B37):** se compra en enero de 2027, ya no es requisito de la demo y pasa al hito
«Piloto». Antes de abrir el piloto se prueba el registro real con 3 o 4 estudiantes. Lo que
necesita dominio verificado queda «pendiente hasta B37»: entrega del OTP a cualquier
estudiante, registro público de extremo a extremo y correo de credenciales de WORKER y
ADMIN.

**Rate limits de Auth:** 30 correos por hora; 30 sign-ups o sign-ins y 30 verificaciones
cada 5 minutos por IP; 60 s entre correos al mismo usuario; IP forwarding apagado. Como el
BFF llama desde el servidor, todos comparten IP. El endurecimiento incluye límites propios
por IP real y por cuenta, y CAPTCHA, sin activar IP forwarding por ahora.

## 10. Migraciones 018 a 021

Renumeradas el 2026-11-08, consecutivas y sin saltos. Las suscripciones y las preferencias
salen del bloque: la suscripción es deuda antes del piloto (§5) y la preferencia de sede y
cafetería tomará el siguiente número libre cuando se implemente.

| #   | Archivo                         | Contenido                                                                                                                                                                                          |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 018 | `secure_registration`           | Tabla de dominios, `min_code_length` y `max_code_length`, tipo de cliente, código, privacidad, `users.email_confirmed_at`, `users.must_change_password`, cuenta inactiva y activación al confirmar |
| 019 | `catalog_category_bebida`       | Solo `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'BEBIDA'`, fuera de transacción                                                                                                                       |
| 020 | `order_idempotency`             | `idempotency_key`, `request_hash`, único por cliente y clave, único parcial de pedido activo por cliente e índice del historial                                                                    |
| 021 | `order_rejection_and_snapshots` | `note`, `cancellation_source`, `rejection_reason`, `rejected_by`, `client_code`, `client_type`                                                                                                     |

- 019-021: los pedidos existentes conservan su historia. `cancellation_source` se deduce
  exactamente del indicador `cancelled_by_client` de la 008; `client_code` y `client_type`
  quedan nulos en los pedidos anteriores, que mantienen `client_document`.
- La 020 se niega a aplicarse si un cliente tiene dos pedidos activos, con un mensaje que
  dice cuáles; no repara datos.

- Todas: RLS sin policies y `REVOKE` a `PUBLIC, anon, authenticated`. Antes de aplicar, se
  amplía y ejecuta `audit_business_integrity.sql`.
- Cuentas existentes: confirmadas siguen activas con tipo por dominio; no confirmadas pasan
  a inactivas.
- El `CHECK` de código obligatorio entra **validado** en la misma 018, no `NOT VALID`: antes
  de crearlo, los estudiantes existentes sin código se marcan «código en revisión».
- Se conserva `canonical_institution_email_domain`, porque Spring la usa en
  `SpringDataInstitutionRepository`.
- La 018 se corrige en su propio archivo, sin crear una 019, porque no está aplicada en
  ninguna base. Si se aplica en staging antes de corregirse, staging se reinicia.
- `clients.document`: se quita `NOT NULL`, se deja de usar y no se copia al código, porque
  son datos distintos. Se elimina tras el piloto.
- `orders.client_document`: historial intacto. Los pedidos nuevos usan `client_code`.
- SUPER_ADMIN: script local con la API de administración y SQL parametrizado; correos como
  parámetro, nunca versionados. Rechaza una tercera cuenta. **Pendiente**: mientras tanto,
  staging usa el procedimiento manual de §3, «Cuenta SUPER_ADMIN de staging».

## 11. Contratos de API

El BFF y Spring usan las mismas rutas. Errores con `ApiErrorResponse`:
`{status, code, message, timestamp, path}`.

| Método y ruta                                         | Uso                                     | Errores                                                                                                              |
| ----------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/me/context`                                 | Sedes, cafeterías activas y preferencia | 404 `CLIENT_PROFILE_NOT_FOUND`                                                                                       |
| `PUT /api/me/preference`                              | Guarda sede y cafetería                 | 403 `CAFETERIA_NOT_SUBSCRIBED`, 404 `SITE_NOT_FOUND`, 409 `CAFETERIA_SITE_MISMATCH`                                  |
| `GET /api/me/menu?cafeteriaId=`                       | Menú del día, con `ETag`                | 404 `CAFETERIA_NOT_FOUND`, 403 `CAFETERIA_NOT_SUBSCRIBED`, 400 `INVALID_REQUEST`                                     |
| `POST /api/me/orders`                                 | Crea pedido, con `Idempotency-Key`      | Ver abajo; con hora inválida, 400 `INVALID_PICKUP_TIME`                                                              |
| `GET /api/me/orders/current`                          | Pedido activo o `null`, con `ETag`      | —                                                                                                                    |
| `GET /api/me/orders?cursor=&limit=20`                 | Historial                               | 400 `INVALID_ORDER_REQUEST`                                                                                          |
| `GET /api/me/orders/{id}`                             | Detalle de un pedido propio             | 404 `ORDER_NOT_FOUND`                                                                                                |
| `PATCH /api/me/orders/{id}/cancel`                    | Cancela en PENDING                      | 404 `ORDER_NOT_FOUND`, 409 `ORDER_ALREADY_PREPARING`, `INVALID_ORDER_STATE`                                          |
| `GET /api/worker/orders`                              | Listado operativo del worker            | 401, 403 `FORBIDDEN`                                                                                                 |
| `PATCH /api/orders/{id}/reject`                       | Rechazo del worker `{reason}`           | 400 `REJECTION_REASON_REQUIRED`, `REJECTION_REASON_TOO_LONG`, 403 `FORBIDDEN`, 409 `INVALID_ORDER_STATE`             |
| `PATCH /api/orders/{id}/remind`                       | Recordatorio del worker, en CALLED      | 403 `FORBIDDEN`, 409 `REMINDER_TOO_EARLY`, `REMINDER_LIMIT_REACHED`, `INVALID_ORDER_STATE`                           |
| `PATCH /api/orders/{id}/not-collected`                | No recogido tras los 3 recordatorios    | 403 `FORBIDDEN`, 409 `NOT_COLLECTED_REQUIREMENTS_NOT_MET`, `INVALID_ORDER_STATE`                                     |
| `GET /api/super-admin/cafeterias`                     | Instituciones, sedes y cafeterías       | 403 `SUPER_ADMIN_FORBIDDEN`                                                                                          |
| `PATCH /api/super-admin/cafeterias/{id}/subscription` | `{subscribed, expectedSubscribed}`      | 403 `SUPER_ADMIN_FORBIDDEN`, 404 `CAFETERIA_NOT_FOUND`, 409 `SUBSCRIPTION_STATE_CHANGED`                             |
| `POST /api/super-admin/credentials`                   | `{email, fullName, role, cafeteriaId}`  | 400 `CREDENTIAL_INVALID_REQUEST`, 403 `SUPER_ADMIN_FORBIDDEN`, 409 `EMAIL_ALREADY_REGISTERED`, `CAFETERIA_HAS_ADMIN` |

**Contexto**

```json
{
  "institution": { "id": "…", "name": "Universidad Santo Tomás" },
  "clientType": "STUDENT",
  "sites": [
    {
      "id": "s1",
      "name": "Sede Principal",
      "cafeterias": [{ "id": "c1", "name": "Cafetería Central", "open": true }]
    }
  ],
  "preference": { "siteId": "s1", "cafeteriaId": "c1", "valid": true }
}
```

**Contexto implementado (B13, 2026-11-08):** la forma de arriba más `fullName` y
`activeOrder: { "id": "…" } | null`, y **sin `preference`** hasta que exista en la base.
Solo lista cafeterías activas de sedes activas de la institución del cliente, con `open`
según `cafeteria_daily_states` de hoy en America/Bogota. Nunca incluye el documento.

**Menú**

```json
{
  "cafeteria": { "id": "c1", "name": "Cafetería Central", "open": false },
  "businessDate": "2026-11-20",
  "categories": [
    {
      "id": "BEBIDA",
      "products": [
        {
          "id": "p1",
          "name": "Jugo natural",
          "description": null,
          "price": "4500.00",
          "imageUrl": null,
          "available": true
        }
      ]
    }
  ]
}
```

**Menú implementado (B14, 2026-11-08):**

- Todas las categorías del enum que tengan productos activos, en el orden de los filtros
  de §6: `DEL_DIA`, `DESAYUNO`, `CORRIENTE`, `EJECUTIVO`, `ESPECIAL` y `BEBIDA`.
- **Cafetería cerrada hoy:** se devuelven sus productos activos con `cafeteria.open: false`
  y `available: false` en cada uno, para ver el menú sin poder pedir (§6).
- **Cafetería inexistente o de otra institución: 404 `CAFETERIA_NOT_FOUND`, con el mismo
  mensaje en los dos casos.** Sustituye al 403 `INSTITUTION_MISMATCH` anterior, para no
  revelar que existe una cafetería de otra institución.
- **Cafetería inactiva de la propia institución:** 403 `CAFETERIA_NOT_SUBSCRIBED`, con
  mensaje fijo (§5).
- `ETag` fuerte sobre el contenido y `Cache-Control: no-cache, private`. Con un
  `If-None-Match` igual responde 304 sin cuerpo. El BFF reenvía `If-None-Match`, `ETag` y
  el 304.
- `imageUrl` va en `null` hasta el PR de pantallas.

**Crear pedido**

```json
{
  "cafeteriaId": "c1",
  "note": "Sin cebolla",
  "items": [{ "productId": "p1", "quantity": 2 }]
}
```

```json
{
  "id": "o1",
  "status": "PENDING",
  "total": "9000.00",
  "note": "Sin cebolla",
  "createdAt": "2026-11-20T17:00:00Z",
  "items": [
    {
      "name": "Jugo natural",
      "quantity": 2,
      "unitPrice": "4500.00",
      "subtotal": "9000.00"
    }
  ]
}
```

- 201 si es nuevo; 200 si repite la misma clave con el mismo contenido.
- Orden de locks: suscripción, cafetería, productos por id y filas del día. Sin fila del
  día, el producto se considera no disponible.
- 400 `INVALID_ORDER_REQUEST`, `ORDER_LIMIT_EXCEEDED`, `ORDER_NOTE_TOO_LONG`.
- 403 `CAFETERIA_NOT_SUBSCRIBED`.
- 404 `CAFETERIA_NOT_FOUND` (decidido el 2026-11-08, sustituye a `INSTITUTION_MISMATCH`).
- 409 `CAFETERIA_CLOSED`, `PRODUCT_UNAVAILABLE`, `ACTIVE_ORDER_EXISTS`,
  `IDEMPOTENCY_KEY_CONFLICT`.
- Pruebas obligatorias: dos pedidos simultáneos del mismo cliente producen exactamente un
  `ACTIVE_ORDER_EXISTS`; la misma `Idempotency-Key` repetida devuelve el mismo pedido.

**Crear pedido implementado (B15, decidido el 2026-11-08):**

- **Orden de las comprobaciones:**
  1. Cuenta inactiva o sin fila en `clients`: 403 `FORBIDDEN`, antes que cualquier otra
     validación.
  2. Forma de la solicitud: 400.
  3. Clave ya usada: la repetición devuelve 200; otro contenido con la misma clave es 409.
  4. Pedido activo: 409.
  5. Cafetería: no existe o es de otra institución, 404; inactiva, 403; cerrada hoy, 409.
  6. Productos: 409.
- **Cafetería de otra institución:** 404 `CAFETERIA_NOT_FOUND`, con el mismo mensaje que una
  inexistente, como en el menú.
- **`ACTIVE_ORDER_EXISTS`:** el `ApiErrorResponse` lleva además `activeOrderId`, el pedido
  que hay que recoger o cancelar. Ningún otro error incluye ese campo.
- **400 `INVALID_ORDER_REQUEST`:**
  - Falta `Idempotency-Key` o no cumple el formato de la 020.
  - Un producto aparece repetido en `items`: se rechaza, no se suman las cantidades.
  - El cuerpo no es JSON, o le faltan tipos o campos.
- **409 `PRODUCT_UNAVAILABLE`, con el mismo mensaje en todos los casos:**
  - El producto no existe, está inactivo o es de otra cafetería.
  - No tiene fila del día o está marcado no disponible.
- **Nota:** se recorta. Si queda vacía se guarda `null` y cuenta como `null` en el hash: `""`,
  espacios y sin nota son la misma solicitud. El límite de 200 cuenta caracteres, como
  `length()` en PostgreSQL.
- **`request_hash`:** SHA-256 hex de la cafetería, los ítems ordenados por producto y la nota
  recortada. Los mismos ítems en otro orden son la misma solicitud.
- **Repetición (200):** devuelve el pedido con su estado actual y sus ítems, en el formato del
  201, aunque ya haya terminado o la cafetería esté cerrada.
- **Campos ignorados:** precios, totales y cualquier otro campo del cuerpo; el BFF ni
  siquiera los reenvía.
- **Datos copiados al crear:** `client_name`, `client_code` (código institucional) y
  `client_type`. `client_document` queda en `null`.
- **Carreras:** las resuelven los índices únicos de la 020. La solicitud que pierde se
  revierte entera, y una lectura nueva la convierte en 200, si es la misma solicitud, o en 409.
- **503 `ORDER_TEMPORARILY_UNAVAILABLE`, con `Retry-After`:** fallo temporal de la base de
  datos. Se reintenta con la misma clave.

**Hora de recogida opcional (023, decidido el 2026-11-11):**

- `POST /api/me/orders` acepta `requestedPickupAt` opcional: ISO-8601 con offset (`Z` o
  `±hh:mm`). Ausente o `null` es «lo antes posible». Un valor que no es texto es 400
  `INVALID_ORDER_REQUEST`; un texto sin offset, mal formado, no posterior a ahora (del
  `TimeProvider`) o de otro día de negocio en America/Bogota es 400 `INVALID_PICKUP_TIME`.
- **Orden:** el formato se valida con la forma (paso 2); el rango, justo después de la
  repetición (paso 3), así que reintentar con la misma clave responde 200 aunque la hora ya
  haya pasado.
- **`request_hash`:** incluye el instante de la hora, no su offset: `13:30-05:00` y
  `18:30Z` son la misma solicitud. Sin hora, la forma canónica es la de B15, así que las
  claves ya guardadas siguen valiendo. La misma clave con otra hora, o con y sin hora, es 409
  `IDEMPOTENCY_KEY_CONFLICT`.
- **Respuestas:** el pedido del cliente y el del worker añaden al final `requestedPickupAt`,
  nullable. El worker la recibe en el listado y en cada transición, que nunca la reescriben.
- **BFF:** reenvía `requestedPickupAt` solo si es texto de hasta 64 caracteres; el formato y
  el rango son de Spring.

**Pedido actual, historial y detalle implementados (B16, decidido el 2026-11-09):**

- **Respuesta del pedido**, la misma en crear, pedido actual, detalle y cancelación: los campos
  de B15 sin cambios, seguidos de `cafeteria {id, name}`, `cancellationSource`,
  `rejectionReason`, `updatedAt`, `calledAt`, `reminderCount`, `lastRemindedAt`,
  `deliveredAt`, `notCollectedAt` y `cancelledAt`. Nunca lleva el documento, `clientId` ni
  `rejected_by`. `orders` no guarda cuándo pasó a preparación ni a listo.
- **Pedido actual:**
  - Sin pedido activo responde 200 con `null`.
  - El `ETag` sale de una consulta mínima: id, estado, `updated_at` y `version`. Los dos
    últimos cambian con cada UPDATE, incluidos el recordatorio y el rechazo.
  - Con un `If-None-Match` igual responde 304 sin leer el pedido ni sus ítems.
  - `Cache-Control: no-cache, private`. La lectura es una transacción REPEATABLE READ de
    solo lectura, así el `ETag` y el cuerpo describen lo mismo.
- **Historial:**
  - Más reciente primero, por `created_at DESC, id DESC` sobre `idx_orders_client_history`,
    con los terminales incluidos. Formato: `{orders, nextCursor}`; `nextCursor` es `null` en
    la última página.
  - Cada elemento lleva `id`, `status`, `total`, `createdAt`, `cafeteriaName`, `itemCount` y
    `summary`.
  - `itemCount` suma unidades. `summary` nombra hasta 2 productos por nombre, con su
    cantidad, y «y N más» cuenta los productos distintos restantes, no las unidades:
    «3× Arepa de queso, 1× Corriente del día y 1 más».
  - `limit` es 20 por defecto y admite de 1 a 50. El cursor es opaco.
  - Un `limit` fuera de rango o un cursor que no se decodifica exactamente es 400
    `INVALID_ORDER_REQUEST`, el mismo código de crear pedido; no hay un segundo código. Un
    cursor bien formado pero ajeno solo recorre los pedidos del cliente de la sesión.
- **Detalle:** un pedido de otro cliente, uno inexistente y un id mal formado responden el
  mismo 404 `ORDER_NOT_FOUND`, con el mismo mensaje.
- **Cuenta sin fila en `clients`:** 403 `FORBIDDEN` antes de validar la solicitud, como en
  crear pedido.
- **Filtro:** cada consulta SQL filtra por el usuario o el cliente de la sesión, no en memoria.
- **Cancelación (revisada contra §6):**
  - Solo en PENDING, sin plazo y solo el dueño. `cancellation_source = 'CLIENT'`.
  - Desde PREPARING, 409 `ORDER_ALREADY_PREPARING`. Desde los demás estados, 409
    `INVALID_ORDER_STATE`, también si la terminó la cafetería o el cierre diario.
  - **Repetir la cancelación** de un pedido que ya canceló el propio cliente responde 200
    con el pedido, sin escribir otra vez.
  - Spring responde con el pedido del cliente, sin el documento. El BFF sigue devolviendo
    solo `{id, status}`.

**Listado del worker en una llamada (implementado el 2026-11-12):**

- `GET /api/worker/orders` sin parámetros. La cafetería sale de actividad, rol y asignación
  leídos de la base en esa misma petición, con la política de `/api/worker/context`; nunca de
  un parámetro ni del JWT. Sin caché de permisos.
- Mismo cuerpo y cabeceras que `GET /api/orders?cafeteriaId=` (§6, «Listado del worker»).
- Cuenta inactiva, sin rol WORKER exclusivo, sin asignación o con varias: el mismo 403
  `FORBIDDEN` con mensaje fijo. Sin sesión: 401.
- El BFF hace una sola llamada en vez de contexto y listado, y traduce cualquier fallo al
  mensaje fijo «No se pudo resolver la cafetería de tu cuenta.». `GET /api/worker/context` y
  `GET /api/orders?cafeteriaId=` se conservan en Spring sin consumidores en la web.
- El sondeo de 10 s se pausa con la pestaña oculta y recarga al volver a ser visible.

**Observaciones del pedido visibles para el worker (implementado el 2026-11-12):**

- La respuesta del pedido del worker (`OrderResponse`: listado y todas las transiciones de
  `/api/orders/{id}/…`) añade al final `note`, el texto libre del cliente de la 021, o `null`.
- Spring la lee de `orders.note` en modo solo lectura: ninguna transición del worker ni el cierre
  diario la reescriben, y no se registra en logs. No hizo falta migración.
- El panel la muestra tal cual, como texto plano con la etiqueta fija «Observaciones», con sus
  saltos de línea y sin cortar, en la tarjeta, el detalle y la vista de llamados.

**Cómo terminó un pedido en el historial del worker (implementado el 2026-11-12):**

- `GET /api/worker/orders/history` añade a cada pedido `cancellationSource` (`CLIENT`, `WORKER`,
  `SYSTEM` o `null`) y `rejectionReason`. Solo un CANCELLED lleva origen, y solo un rechazo del
  worker lleva motivo. Nunca expone `rejected_by`.
- Textos fijos: «Rechazado por la cafetería: <motivo>», «Cancelado por el cliente», «Cerrado por
  el sistema» y «No recogido», que sigue aparte. Una cancelación anterior a la 021 sigue como
  «Cancelado», y una del worker sin motivo, de antes de B18, como «Cancelado por la cafetería».
- El dashboard del admin no lista pedidos uno a uno: solo agrega conteos y menciona
  «cancelados» en textos de cobertura, así que no cambia.

**Rechazo del worker implementado (B18, decidido el 2026-11-10):**

- **Quién:** solo un WORKER activo asignado a la cafetería del pedido. El worker que rechaza
  sale del JWT verificado. **Un pedido de otra cafetería y uno inexistente devuelven el mismo
  403 `FORBIDDEN`**, sin revelar si el pedido existe. Cliente, ADMIN o SUPER_ADMIN: 403. Sin
  sesión o con un token inválido: 401.
- **Cuándo:** desde PENDING o PREPARING (§6). Desde cualquier otro estado, 409
  `INVALID_ORDER_STATE`, con el pedido intacto.
- **Motivo:** se recorta **antes** de validar, así que `"   "` es 400
  `REJECTION_REASON_REQUIRED`, igual que un motivo ausente o de menos de 3 caracteres. Más
  de 200 es 400 `REJECTION_REASON_TOO_LONG`. Cuenta caracteres como `length()` de
  PostgreSQL. La 021 admite hasta 300, así que no hizo falta migración. El motivo se valida
  antes que el estado.
- **Escritura:** status `CANCELLED`, `cancellation_source = 'WORKER'`, `rejection_reason`,
  `rejected_by` (id del worker), `cancelled_at` del `TimeProvider` y `cancelled_by_client =
false`. La `version` sube como en las demás transiciones (JPA y el trigger de la 008),
  bajo el mismo bloqueo de fila, así que un rechazo y una cancelación del cliente
  simultáneos dan un ganador y un 409.
- **Repetición:** si el mismo worker rechaza otra vez un pedido que ya rechazó, la respuesta
  es 200 con el pedido, sin escribir y conservando el motivo original, que la 021 hace
  inmutable. Es coherente con la cancelación repetida del cliente. Si lo rechazó otro worker,
  o lo terminó el cliente o el cierre diario, es 409.
- **Lo que ve el cliente:** `GET /api/me/orders/current`, `/api/me/orders` y
  `/api/me/orders/{id}` siguen el contrato de B16. El pedido rechazado deja de ser el actual
  (`null`). El detalle trae `cancellationSource: "WORKER"` y `rejectionReason`, y el
  historial lo lista como CANCELLED. Nunca exponen `rejected_by` ni datos del worker.
- **BFF:** `app/api/orders` acepta la acción `reject` con `sameOrigin`, sesión, rol WORKER y
  Bearer, como las demás. Solo reenvía `{reason}` ya recortado, y rechaza un motivo inválido
  sin llamar a Spring.

**Listado de SUPER_ADMIN implementado (decidido el 2026-11-10), solo lectura:**

- **Quién:** cuenta activa con rol SUPER_ADMIN exclusivo y sin cafetería asignada, leído de la
  base en cada llamada; nunca del JWT. Sin sesión o con token inválido: 401. CLIENT, WORKER,
  ADMIN, SUPER_ADMIN inactivo o con otro rol: 403 `SUPER_ADMIN_FORBIDDEN`.
- **Respuesta:** instituciones `{id, name, active, sites}`, sedes
  `{id, name, city, active, cafeterias}` y cafeterías `{id, name, subscribed, hasActiveAdmin}`,
  bajo `institutions` y por nombre. Incluye instituciones sin sedes y sedes sin cafeterías,
  activas o no.
- `subscribed` es `cafeterias.is_active` (§5); no hay un segundo campo `active` en la
  cafetería. `hasActiveAdmin` es verdadero si un ADMIN activo está asignado en
  `cafeteria_users`.
- Lectura `REPEATABLE READ` de solo lectura, con `Cache-Control: no-store`. 503
  `SUPER_ADMIN_TEMPORARILY_UNAVAILABLE` con `Retry-After` ante un fallo temporal.
- **BFF:** `app/api/super-admin/**` con sesión (`getAuth()`), rol SUPER_ADMIN y Bearer de la
  sesión. `sameOrigin` se exige a todo método que no sea GET o HEAD, como en el resto de BFF:
  el navegador no envía `Origin` en un GET del mismo origen.
- Sin escrituras: el interruptor de suscripción y las credenciales quedan para otro PR.

**Dashboard del admin sin sondeo (implementado el 2026-11-12, solo frontend):**

- Carga una vez al abrir y al cambiar el período; no recarga sola, ni con el foco ni al volver a
  la pestaña. «Actualizar» fuerza una consulta nueva y se deshabilita mientras carga.
- Muestra «Actualizado a las HH:mm» en hora de Bogotá, a partir de `period.asOf` del servidor.
- Si «Actualizar» falla, conserva los datos anteriores con el mensaje fijo «No pudimos actualizar
  el dashboard. Se muestran los datos anteriores.». Un 401 o 403 sí los retira.
- Caché en memoria del navegador **solo de períodos personalizados ya cerrados**: `to` anterior
  a hoy en Bogotá y `period.partial = false` en la respuesta. Hoy, «Últimos 7/30 días» o
  cualquier rango que incluya hoy siempre van al servidor. Un día pasado no cambia porque cada
  evento se fecha con el reloj del servidor al ocurrir y los estados terminales son finales.
- La clave incluye admin (correo), institución, sede y cafetería del perfil, y el período.
  Otro perfil vacía la caché, igual que cerrar sesión (`unifood:logout`). Sin perfil cargado,
  no se cachea.

**Cierre diario automático (B19, implementado el 2026-11-10):**

- **Cuándo:** al arrancar el backend y luego **cada hora** (`orders.daily-close.interval`,
  `PT1H` por defecto, variable `DAILY_CLOSE_INTERVAL`). **Cambia lo de antes, «cada 5
  minutos»:** en la demo el backend se apaga de noche y la ejecución al arrancar cierra lo
  pendiente, así que una hora basta. A cambio, con el backend ya encendido a medianoche, un
  pedido viejo puede seguir activo hasta una hora.
- **Interruptor:** `orders.daily-close.enabled` (`DAILY_CLOSE_ENABLED`, `true` por defecto).
  Con `false` el trabajo no se registra. Se define como variable del proceso; el `.env` que
  lee `start-backend.ps1` no la admite.
- **Regla:** la misma del script manual, con dos `UPDATE … FOR UPDATE SKIP LOCKED` en una
  transacción READ COMMITTED de 15 s. Pedidos creados antes del inicio del día en
  America/Bogota: PENDING pasa a CANCELLED (`cancellation_source = 'SYSTEM'`, `cancelled_at`);
  PREPARING, READY y CALLED pasan a NOT_COLLECTED (`not_collected_at`). Los de hoy y los
  terminados, incluidos los rechazos del worker, no se tocan. Cada pedido cerrado sube su
  `version` (008).
- **Fechas:** el inicio del día, `cancelled_at` y `not_collected_at` salen del `TimeProvider`,
  no de `now()` de la base, como en las demás transiciones de Spring.
- **Concurrencia:** `SKIP LOCKED` basta y no hay otra dependencia. Dos instancias no cierran
  la misma fila: una salta lo que la otra tiene bloqueado, y lo que ya cerró deja de estar
  activo. Una fila que un worker tiene bloqueada se cierra en la siguiente ejecución, y un
  worker que llegue después del cierre recibe el 409 de modificación concurrente.
- **Log:** solo cuántos pedidos cerró de cada tipo, sin ids ni datos personales. Un fallo se
  registra con su tipo y se reintenta en la siguiente ejecución.
- **Sin endpoint:** `CloseStaleOrdersUseCase` queda listo para un futuro endpoint de admin,
  que no se expone todavía.

**Cierre manual de emergencia** (`scripts/supabase/close-stale-orders.sql`): aplica la
misma regla a los pedidos activos creados antes del inicio del día en America/Bogota.
PENDING pasa a CANCELLED con `cancellation_source = 'SYSTEM'` y `cancelled_at`; PREPARING,
READY y CALLED pasan a NOT_COLLECTED con `not_collected_at`. Cada pedido cerrado sube su
`version`. Los pedidos de hoy y los ya terminados no se tocan, y los bloqueados en ese
momento se saltan hasta la siguiente ejecución.

- Por defecto es un **ensayo**: solo lista qué cerraría. Cierra de verdad con
  `SET unifood.close_stale_orders = 'apply';` en la misma ejecución.
- Solo hace falta si el trabajo automático está desactivado o fallando: Spring ya lo hace al
  arrancar. Libera a los clientes que dejaron un pedido activo el día anterior (020).
- Límite: un NOT_COLLECTED del cierre no se distingue de uno marcado por el worker, porque
  `not_collected_at` no guarda quién lo marcó.

**Cambio forzado de contraseña:** `current_auth_profile` devuelve `mustChangePassword`.
Hasta cambiarla, el panel solo muestra esa pantalla y Spring responde 403
`PASSWORD_CHANGE_REQUIRED`.

## 12. Trabajo de cliente

`origin/feature/client-orders` es de Jonathan Panesso y no se modifica. Su trabajo continúa
en `feature/client-orders-v2`, creada desde esa rama para conservar la autoría. Se conserva
la estructura del caso de uso y del BFF. Se retiran stock y horarios fijos, se usa una nota
por pedido y se crean los endpoints que faltan.

## 13. Línea de corte

Si el 14 de noviembre el backend de pedidos no está terminado, se activa toda la línea.
Lo que pasa a después de la demo, en orden:

1. Dashboard de clientes.
2. Crear cafeterías en panel: se siembran por script.
3. Interruptor de suscripción en UI: se cambia por SQL controlado.
4. Cambio obligatorio de contraseña y creación de credenciales: por script.
5. Historial.
6. Sonido y título de pestaña.

**No se negocia:** registro seguro, migraciones, menú, crear pedido, pedido actual,
cancelación, recordatorios, rechazo, cierre diario, selección de sede y cafetería, Mi
pedido, endurecimiento de login y correos, staging y el recorrido completo con dos días de
ensayo.
