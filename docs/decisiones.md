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
  correo, con cambio obligatorio en el primer ingreso, mediante la API de administración
  de Supabase. La service role key vive solo en el backend. La contraseña temporal se
  muestra una sola vez al SUPER_ADMIN (`no-store`, sin logs). Cuando Resend esté listo
  con dominio propio, pasa a correo.

## 3. Registro e identidad

- Auto-registro solo con dominios institucionales; cualquier otro se rechaza. Todos
  entran con rol cliente.
- Dominios en la tabla `institution_email_domains(domain, institution_id, client_type)`,
  no en código. **Dominios de la universidad: `ustavillavo.edu.co` (STUDENT) y
  `ustavillavicencio.edu.co` (docentes y administrativos, con un solo `client_type`).**
- El dominio se compara por igualdad exacta, sin distinguir mayúsculas. Se rechazan
  subdominios y dominios parecidos, como `ustavillavo.edu.co.evil.com` o
  `evilustavillavo.edu.co`, y los correos con `+` o espacios.
- La regla se valida en la base de datos (trigger de la 018), no solo en el BFF, para que
  no se salte con un signup directo usando la clave pública. Solo la API de administración
  crea identidades fuera de esa regla, con una marca en `app_metadata`.
- Se guarda el tipo de cliente, deducido del dominio.
- Verificación: OTP de 6 dígitos generado por Supabase y enviado al correo (plantilla con
  `{{ .Token }}`, no enlace). Solo prueba que el usuario es dueño del correo; no es dato
  de negocio.
- La cuenta queda inactiva hasta confirmar el correo. Spring también rechaza cuentas no
  confirmadas, sin confiar solo en el BFF.
- Datos de registro: correo institucional, nombre y código institucional (solo dígitos y
  único). Obligatorio para estudiantes; opcional para docentes y administrativos. Sin
  teléfono ni documento.
- Longitud del código configurable por institución: `min_code_length` y `max_code_length`.
  **El código de estudiante es numérico de exactamente 7 dígitos**
  (`min_code_length = max_code_length = 7`). No se fija en código.
- Código único por institución: índice único parcial sobre institución y código, que ignora
  los nulos.
- Si alguien reclama un código por error, SUPER_ADMIN lo libera en una transacción con
  registro de auditoría y marca la cuenta como «código en revisión». Se hace con un script
  local hasta que exista el panel.
- Casilla de aceptación de la política de privacidad, con fecha guardada (Ley 1581).
- El worker ve solo nombre y código institucional, o nombre y tipo de cliente si no hay
  código.

## 4. Flujo del cliente

1. Registro con OTP e inicio de sesión. El dominio del correo determina la universidad; el
   cliente no la elige.
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

## 6. Pedido

- Una sola cafetería, «lo antes posible»: sin hora programada, tiempo estimado ni turno.
  Aparece de inmediato en el panel del worker.
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
- Cancelación: el cliente cancela mientras esté PENDING, sin plazo por tiempo.
- Rechazo: el worker puede rechazar **solo en PENDING**, con motivo obligatorio.
- Cierre diario (America/Bogota): PENDING pasa a CANCELLED por el sistema; PREPARING, READY
  o CALLED pasan a NOT_COLLECTED. La cola FIFO solo considera pedidos del día.
- Historial de solo lectura, sin «repetir pedido».

## 7. Notificaciones

Solo dentro de la app, al pasar a preparación y a listo para recoger (CALLED y sus
recordatorios): pantalla «Mi pedido» con polling, aviso visible, sonido y cambio del
título de la pestaña. Web Push queda para después.

## 8. Diseño

Estilo iPhone minimalista, mobile-first, azules y blancos, marca UniFood
(`unifood-logo.png`), cero ruido visual, una acción principal por pantalla, transiciones
cortas y respeto a `prefers-reduced-motion`. Se definen tokens reales del cliente y se
aíslan sus estilos de `globals.css`.

- Tipografía: Inter, cargada solo en `/cuenta`. El resto de la app no cambia.
- Modo oscuro: después del piloto. Los tokens del cliente quedan preparados para añadirlo.

## 9. Infraestructura y Supabase

- Frontend en Vercel. Backend Spring en hosting con contenedor, por decidir.
- Supabase en plan gratuito hoy. Migraciones: primero bases temporales locales, luego el
  proyecto de pruebas `unifood-staging`. **Nunca se estrenan en el proyecto real.**

**Supabase Auth verificado por el responsable:** Confirm email activo; OTP de 6 dígitos con
expiración de 900 s; plantilla «Confirm sign up» con `{{ .Token }}`; contraseña mínima de 8
con letras y dígitos; Secure password change activo; anonymous sign-ins y manual linking
apagados; registro público abierto, porque la regla de dominio vive en el trigger de la 018.

**Correo:** SMTP personalizado con Resend activo, con remitente de pruebas
`onboarding@resend.dev`, que solo entrega al correo dueño de la cuenta de Resend. **El
dominio verificado es requisito de la demo, con fecha límite 15 de noviembre.**

**Rate limits de Auth:** 30 correos por hora; 30 sign-ups o sign-ins y 30 verificaciones
cada 5 minutos por IP; 60 s entre correos al mismo usuario; IP forwarding apagado. Como el
BFF llama desde el servidor, todos comparten IP. El endurecimiento incluye límites propios
por IP real y por cuenta, y CAPTCHA, sin activar IP forwarding por ahora.

## 10. Migraciones 018 a 023

| #   | Archivo                         | Contenido                                                                                                                                                                                          |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 018 | `secure_registration`           | Tabla de dominios, `min_code_length` y `max_code_length`, tipo de cliente, código, privacidad, `users.email_confirmed_at`, `users.must_change_password`, cuenta inactiva y activación al confirmar |
| 019 | `cafeteria_subscriptions`       | Tabla propia e historial de cambios. No reutiliza `cafeterias.is_active`                                                                                                                           |
| 020 | `client_preferences`            | Sede y cafetería, con FK compuesta                                                                                                                                                                 |
| 021 | `catalog_category_bebida`       | Solo `ALTER TYPE ... ADD VALUE 'BEBIDA'`                                                                                                                                                           |
| 022 | `order_idempotency`             | `idempotency_key`, `request_hash` y único parcial de pedido activo por cliente                                                                                                                     |
| 023 | `order_rejection_and_snapshots` | `note`, `cancellation_source`, `rejection_reason`, `rejected_by`, `client_code`, `client_type`                                                                                                     |

- Todas: RLS sin policies y `REVOKE` a `PUBLIC, anon, authenticated`. Antes de aplicar, se
  amplía y ejecuta `audit_business_integrity.sql`.
- Cuentas existentes: confirmadas siguen activas con tipo por dominio; no confirmadas pasan
  a inactivas. El `CHECK` de código obligatorio entra `NOT VALID` y se valida después.
- `clients.document`: se quita `NOT NULL`, se deja de usar y no se copia al código, porque
  son datos distintos. Se elimina tras el piloto.
- `orders.client_document`: historial intacto. Los pedidos nuevos usan `client_code`.
- SUPER_ADMIN: script local con la API de administración y SQL parametrizado; correos como
  parámetro, nunca versionados. Rechaza una tercera cuenta.

## 11. Contratos de API

El BFF y Spring usan las mismas rutas. Errores con `ApiErrorResponse`:
`{status, code, message, timestamp, path}`.

| Método y ruta                                         | Uso                                     | Errores                                                                                                              |
| ----------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/me/context`                                 | Sedes, cafeterías activas y preferencia | —                                                                                                                    |
| `PUT /api/me/preference`                              | Guarda sede y cafetería                 | 403 `CAFETERIA_NOT_SUBSCRIBED`, 404 `SITE_NOT_FOUND`, 409 `CAFETERIA_SITE_MISMATCH`                                  |
| `GET /api/me/menu?cafeteriaId=`                       | Menú del día                            | 403 `CAFETERIA_NOT_SUBSCRIBED`, `INSTITUTION_MISMATCH`                                                               |
| `POST /api/me/orders`                                 | Crea pedido, con `Idempotency-Key`      | Ver abajo                                                                                                            |
| `GET /api/me/orders/current`                          | Pedido activo o `null`                  | —                                                                                                                    |
| `GET /api/me/orders?cursor=&limit=20`                 | Historial                               | —                                                                                                                    |
| `PATCH /api/me/orders/{id}/cancel`                    | Cancela en PENDING                      | 404 `ORDER_NOT_FOUND`, 409 `ORDER_ALREADY_PREPARING`, `INVALID_ORDER_STATE`                                          |
| `PATCH /api/orders/{id}/reject`                       | Rechazo del worker `{reason}`           | 400 `REJECTION_REASON_REQUIRED`, 403 `FORBIDDEN`, 409 `INVALID_ORDER_STATE`                                          |
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
- 403 `CAFETERIA_NOT_SUBSCRIBED`, `INSTITUTION_MISMATCH`.
- 409 `CAFETERIA_CLOSED`, `PRODUCT_UNAVAILABLE`, `ACTIVE_ORDER_EXISTS`,
  `IDEMPOTENCY_KEY_CONFLICT`.
- Pruebas obligatorias: dos pedidos simultáneos del mismo cliente producen exactamente un
  `ACTIVE_ORDER_EXISTS`; la misma `Idempotency-Key` repetida devuelve el mismo pedido.

**Cierre diario:** sin endpoint público. Tarea cada 5 minutos y al arrancar; toma pedidos
activos anteriores al inicio del día con `FOR UPDATE SKIP LOCKED`. Es idempotente.

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
