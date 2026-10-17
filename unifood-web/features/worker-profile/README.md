# Mi perfil WORKER

El módulo de solo lectura se integra en la pestaña «Mi perfil» de `/worker`.
El navegador solicita `GET /api/worker/profile` al BFF de Next. El BFF verifica
la identidad con Supabase Auth, aplica la admisión WORKER exclusiva mediante
`current_auth_profile` y consulta la ruta fija de Spring con el bearer de esa sesión.
Spring resuelve la asignación y devuelve cafetería, sede e institución desde PostgreSQL.
No hay acceso del frontend a tablas business de Supabase.

`getVerifiedAuthIdentity()` separa autenticación de autorización: un usuario Auth
válido pero inactivo sigue autenticado y recibe 403. El correo procede únicamente
de `auth.getUser()`, con email confirmado; se ignoran el correo del RPC y cualquier
campo extra del backend. `getSession()` aporta el token después de verificar la
identidad. No se decodifica el JWT en el navegador. `getAuth()` conserva su contrato.
El nuevo helper difiere las escrituras de cookies del SDK hasta completar la
verificación; descarta intentos de borrado ante un fallo temporal.

El contrato del navegador es `{ email, role: "WORKER", cafeteria: { name, active },
site: { name }, institution: { name } }`. Ambos límites validan el contrato completo
y seleccionan únicamente sus campos públicos. Datos parciales o tipos inválidos no
se presentan. El BFF usa no-store, timeout de 15 segundos y redirects bloqueados;
el navegador también usa no-store y cancela lecturas al abandonar la pestaña.

401 ofrece una acción a `/panel/login`. 403 muestra acceso no permitido, sin bucles
ni redirección automática. 503 mantiene la sesión y permite reintentar; el BFF
conserva Retry-After numérico de 1 a 300 segundos o usa 5. Errores 500/502 muestran
mensajes seguros, sin detalles del proveedor o SQL. No hay estado vacío normal.
Se consulta al entrar y mediante reintento, sin polling del perfil.

La UI usa una tarjeta clara, icono neutro y `dl/dt/dd`; no deriva nombres del correo
ni muestra campos personales inexistentes. Una cafetería administrativamente inactiva
permite lectura y muestra un aviso textual. No es disponibilidad diaria. El logout
sigue exclusivamente en el Header y conserva el regreso a `/panel/login`.

Los tests cubren identidad/admisión, contratos, BFF, estados cancelables, presentación
y navegador con un proveedor/backend de prueba local. Las pruebas de navegador
incluyen recuperación, navegación entre módulos y tamaños móvil, tablet y escritorio.
