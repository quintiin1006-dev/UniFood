# Perfil WORKER de solo lectura

`GET /api/worker/profile` devuelve el contexto de negocio del propio WORKER. El
backend Spring está implementado; BFF y UI se incorporarán en una fase posterior.
El correo corresponderá a la identidad Auth verificada en el BFF y no forma parte
del DTO Spring. No hay edición de perfil ni cambios de contraseña o asignación.

## Identidad y autorización

El subject del JWT verificado es el único identificador de usuario utilizado.
Los parámetros de consulta y los claims de rol/cafetería no son autoridad y no
se usan para seleccionar datos. La política compartida comprueba usuario activo,
rol exclusivamente WORKER y exactamente una asignación de cafetería. No se modifica
la política de Orders, Availability ni Historial.

La cafetería puede estar administrativamente inactiva: la consulta sigue permitida
y `cafeteria.active` refleja ese estado, sin confundirlo con apertura o disponibilidad
diaria. Las entidades site/institution inactivas conservan sus nombres de contexto;
este endpoint no introduce condiciones operativas adicionales.

## Contrato

La respuesta contiene exclusivamente:

- `role`: `WORKER`, después de validar la política de negocio.
- `cafeteria`: `name` y `active` (actividad administrativa).
- `site`: `name`.
- `institution`: `name`.

No devuelve email, nombre personal, documento, teléfono, UUIDs, metadatos Auth,
timestamps ni información de otros usuarios. No consulta `clients`, `auth.users`
ni el endpoint de perfil CLIENT.

## Persistencia

Un puerto de lectura específico utiliza una consulta parametrizada por el usuario
autenticado y la cafetería autorizada: `cafeteria_users → cafeterias → sites → institutions`.
Los LEFT JOIN mantienen visibles las inconsistencias de relaciones obligatorias;
un contexto incompleto o con nombres vacíos produce un error seguro, no datos
inventados ni un perfil parcial. No se ocultan asignaciones duplicadas escogiendo
arbitrariamente la primera fila.

La autorización y la proyección comparten una transacción read-only REPEATABLE READ
con timeout de 15 segundos. Hay una SELECT de autorización y una SELECT de contexto,
sin N+1, bloqueos de escritura ni nuevas entidades JPA. GET no modifica datos.
No requiere migraciones, grants nuevos, RPC ni acceso a Supabase remoto.

## Errores y privacidad

Todas las respuestas del controller/advice usan `Cache-Control: no-store`.

- 401: autenticación ausente/inválida, mediante la seguridad existente.
- 403 `WORKER_PROFILE_FORBIDDEN`: usuario/rol/asignación inválidos.
- 503 `WORKER_PROFILE_TEMPORARILY_UNAVAILABLE`: dependencia temporal,
  `Retry-After: 5`, sin modificar cookies.
- 500 `WORKER_PROFILE_INTERNAL_ERROR`: inconsistencia o fallo inesperado.

No hay un 404 de perfil opcional: una asignación válida es requisito de acceso.
Los mensajes públicos no contienen SQL, UUIDs, stack traces ni metadatos Auth.
El advice se limita a `WorkerProfileController` y conserva los contratos globales
y de los demás módulos.

## Pruebas

Las pruebas del servicio y del controller comprueban autorización defensiva,
subject como autoridad y ausencia de lecturas ante cardinalidades inválidas.
`WorkerProfileApiPostgresTest` ejecuta las migraciones 001–014 en un clúster temporal
propio, con Spring Security, Hibernate/JpaTransactionManager y JDBC reales. Comprueba DTO mínimo,
cafetería activa/inactiva, aislamiento entre usuarios, parámetros manipulados,
revocación, query count, snapshot read-only, permisos cerrados y errores seguros.
Los casos de relaciones rotas alteran exclusivamente datos de ese clúster desechable
y restauran las referencias; no modifican el esquema ni bases externas.
