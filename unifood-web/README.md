# UniFood web

Panel de trabajadores en Next.js. Ejecutar `npm install` y `npm run dev`; abrir `/worker`.

## Conexión al backend

Crear `.env.local` si se requieren valores distintos:

```dotenv
API_URL=http://localhost:8080
NEXT_PUBLIC_CAFETERIA_ID=59ac35a8-1c1c-4081-8720-2d517d8740bd
```

Reiniciar Next.js después de cambiar la configuración. `API_URL` es la dirección del backend accesible desde el servidor Next.js. Se acepta también la variable anterior `NEXT_PUBLIC_API_URL` como alternativa.

El navegador consulta `/api/orders` en su mismo origen. El Route Handler reenvía GET y las acciones PATCH al backend sin reenviar el Origin del navegador. Esto evita depender de que Spring permita el puerto o el hostname del frontend por CORS. Los códigos y mensajes del backend, incluido 409, se conservan. Si el backend no responde, el frontend muestra un error de conexión (502).

## Flujo de órdenes

- Pendiente → preparación → listo → llamado → entregado.
- El backend autoriza pasar a preparación únicamente al primer pendiente de la cafetería (createdAt e id). El frontend conserva el orden recibido y no omite esa validación, incluso cuando hay una búsqueda activa.
- Cancelar requiere un pedido pendiente; el backend valida también el plazo de cancelación.
- Las órdenes se consultan cada 10 segundos, al recuperar el foco y después de cada acción. Las solicitudes anteriores no pueden sobrescribir una mutación y se bloquean acciones simultáneas sobre el mismo pedido.
- Los conflictos muestran el mensaje real del backend. Solo un rechazo de preparación por un pedido anterior se identifica como prioridad.
- CANCELLED y NOT_COLLECTED son terminales y no aparecen como pendientes.
- La vista de llamadas permite entregar; el detalle se cierra al dejar de estar llamado. El botón de recordatorio está deshabilitado porque OrderController todavía no expone ese endpoint.

## Verificación

```sh
npm test
npm run lint
npm run build
```

Las pruebas usan respuestas simuladas: cubren todas las transiciones, prioridad, cancelación, estados terminales, errores y el proxy. Para verificar la integración real, usar pedidos de prueba y comprobar: rechazo al preparar el segundo pendiente, éxito del primero, avance hasta entregado, persistencia al recargar y cancelación permitida/rechazada según plazo.

En la revisión del 27 de septiembre de 2026 no hubo conexión a localhost:8080 desde el entorno de trabajo. La integración con la base de datos y el backend en ejecución queda pendiente de esa disponibilidad. CORS se identificó como una limitación de configuración; no se pudo confirmar como causa única del fallo observado.
