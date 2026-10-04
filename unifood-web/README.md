# UniFood web

Aplicación en Next.js con login, registro de estudiantes y panel de trabajadores. Ejecutar `npm install` y `npm run dev`; abrir `/login`. El panel `/worker` requiere una cuenta verificada con rol y cafetería asignados.

En este equipo se trabaja desde `C:\Users\credi\Documents\UniFood`. Se puede iniciar desde la raíz con `npm run dev` o con `iniciar-unifood.cmd`; local y red usan el mismo servidor en el puerto 3000. Ver [arranque del proyecto](../README.md). No ejecutar la copia independiente de `OneDrive\Desktop\UniFood` para consultar estos cambios.

La configuración de Supabase, migración, plantillas de correo y estructura del módulo se documentan en [Autenticación](docs/auth.md). Ver [configuración de local, staging y production](docs/environments.md). Copiar `.env.example` a `.env.local`; completar los dos valores Supabase antes de probar el acceso real.

## Conexión al backend

Definir explícitamente `API_URL` en `.env.local`, también para desarrollo local:

```dotenv
API_URL=http://localhost:8080
```

Reiniciar Next.js después de cambiar la configuración. `API_URL` es la dirección del backend accesible desde el servidor Next.js y es obligatoria. `NEXT_PUBLIC_API_URL` no se utiliza. En `next build` y `next start`, también son obligatorias `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`. La validación identifica la variable incorrecta sin imprimir su valor.

El navegador consulta `/api/orders` en su mismo origen, sin elegir cafetería. Para cada listado, el BFF consulta `/api/worker/context` con el token de la sesión verificada y utiliza el ID devuelto para el GET de pedidos del backend. Ignora cualquier `cafeteriaId` enviado por el navegador. El contexto exige WORKER activo, sin roles administrativos y con exactamente una asignación vigente en PostgreSQL; sin asignación o con varias devuelve 403. No se guarda ni cachea la asignación. Spring vuelve a autorizar cada lectura y operación de pedidos.

El Route Handler reenvía las acciones PATCH al backend sin reenviar el Origin del navegador. Esto evita depender de que Spring permita el puerto o el hostname del frontend por CORS. Los códigos y mensajes de pedidos, incluido 409, se conservan. Los errores de contexto usan mensajes seguros: se mantienen 401/403 y los fallos de conexión o respuestas inválidas producen 502.

## Flujo de órdenes

- Pendiente → preparación → listo → llamado → entregado.
- El backend autoriza pasar a preparación únicamente al primer pendiente de la cafetería (createdAt e id). El frontend conserva el orden recibido y no omite esa validación, incluso cuando hay una búsqueda activa.
- Cancelar desde worker requiere un pedido pendiente; el backend valida también el plazo de cancelación.
- Las órdenes se consultan cada 10 segundos, al recuperar el foco y después de cada acción. Las solicitudes anteriores no pueden sobrescribir una mutación y se bloquean acciones simultáneas sobre el mismo pedido.
- Los conflictos muestran el mensaje real del backend. Solo un rechazo de preparación por un pedido anterior se identifica como prioridad.
- CANCELLED y NOT_COLLECTED son terminales y no aparecen como pendientes.
- La vista de llamadas permite entregar; el detalle se cierra al dejar de estar llamado. El botón de recordatorio está deshabilitado porque OrderController todavía no expone ese endpoint.

## Verificación

La cancelación propia usa `PATCH /api/me/orders/{orderId}/cancel`, tanto en backend como en BFF. Exige CLIENT activo como único rol vigente. El backend resuelve el propietario por `orders.client_id → clients.user_id → users.id` y lo compara con el subject autenticado; ningún email, clientId, body o parámetro del navegador concede permisos. La regla PENDING vive en `Order` y esta operación CLIENT no aplica un deadline adicional. Las operaciones worker conservan su política y su deadline.

El backend devuelve 200 con `OrderResponse`; el BFF entrega únicamente `{id, status: "CANCELLED"}`. Sin sesión: 401; cuenta no elegible: 403; pedido inexistente, ajeno o sin cliente vinculado para un CLIENT elegible: 404 (`ORDER_NOT_FOUND`); cualquier estado diferente de PENDING en un pedido propio: 409 (`INVALID_ORDER_STATE`). Los errores del backend usan `ApiErrorResponse`; el BFF mantiene esos estados con mensajes fijos y el mismo formato de error, sin copiar bodies ni headers upstream. Fallos de conexión, redirects o respuestas inválidas producen 502. No hay cambios de UI ni historial CLIENT en esta fase.

Roles, actividad y ownership se consultan de nuevo en cada petición. Persiste el riesgo de cambios simultáneos entre autorización, lectura y guardado: la transacción actual no aplica locking ni una actualización condicional. Esta fase no garantiza exclusión frente a una preparación worker concurrente; locking e idempotencia quedan pendientes.

```sh
npm test
npm run lint
npm run build
```

Las pruebas usan respuestas simuladas: cubren todas las transiciones, prioridad, cancelación, estados terminales, errores y el proxy. Para verificar la integración real, usar pedidos de prueba y comprobar: rechazo al preparar el segundo pendiente, éxito del primero, avance hasta entregado, persistencia al recargar y cancelación permitida/rechazada según plazo.

En la revisión del 27 de septiembre de 2026 no hubo conexión a localhost:8080 desde el entorno de trabajo. La integración con la base de datos y el backend en ejecución queda pendiente de esa disponibilidad. CORS se identificó como una limitación de configuración; no se pudo confirmar como causa única del fallo observado.
