# UniFood

Pedidos de almuerzo universitarios. Decisiones de negocio y plan v2: `docs/decisiones.md`.
Auditorías y convenciones completas: `docs/auditorias/`, sección 7 de cada una.

## Stack y estructura

- `unifood-backend/`: Java 21, Spring Boot 4, hexagonal (domain, application, adapter, config).
- `unifood-web/`: Next.js 16, React 19, TypeScript estricto, BFF hacia Spring.
- `unifood-backend/supabase/`: migraciones SQL manuales. Supabase Postgres, Auth y Storage.
- Antes de tocar el frontend, leer `unifood-web/AGENTS.md` y consultar
  `node_modules/next/dist/docs/`: esta versión de Next difiere de versiones anteriores.
- **Cliente:** `origin/feature/client-orders-v2` será la base del trabajo de cliente, creada
  desde `origin/feature/client-orders`, que es de Jonathan y no se modifica.

## Comandos verificados

Frontend, desde `unifood-web/`:

```sh
npm run lint
npx tsc --noEmit --incremental false
npm test                 # PGlite y clúster PostgreSQL temporal local; exige PostgreSQL nativo
npm run build
npx prettier --check <archivos>
PLAYWRIGHT_PRODUCTION=true npx playwright test tests/e2e/<spec>.ts   # puerto 3000 libre y build previo
```

Backend, desde `unifood-backend/` (en Windows, `.\mvnw.cmd`):

```sh
./mvnw -o test "-Dtest=!*PostgresTest"
./mvnw -o spotless:check
./mvnw -o test -Dtest=AdminDashboardApiPostgresTest   # clúster temporal local
```

Por confirmar: `mvnw verify` completo, `start-backend.ps1`, suite e2e completa.

## Variables de entorno (solo nombres)

- Web: API_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, AUTH_USERNAME_DOMAIN.
- Backend: SUPABASE_DB_URL, SUPABASE_AUTH_ISSUER, SPRING_DATASOURCE_USERNAME,
  SPRING_DATASOURCE_PASSWORD, SPRING_PROFILES_ACTIVE, SUPABASE_STORAGE_URL,
  SUPABASE_STORAGE_SECRET_KEY, SUPABASE_PRODUCT_IMAGES_BUCKET,
  PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS, PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS,
  PRODUCT_IMAGES_CLEANUP_ENABLED, DAILY_CLOSE_ENABLED, DAILY_CLOSE_INTERVAL.

## Convenciones

- Backend: `<Verbo><Objeto>UseCase`, `<Área>Service`, `<Área>PersistenceAdapter`,
  `SpringData<Entidad>Repository`, respuestas como `record`, SQL en `resources/sql/<módulo>/`.
- Backend: `@Transactional(timeout = 15)`; `REPEATABLE_READ` en lecturas con autorización.
- Frontend: `features/<dominio>/` con `api`, `contracts`, `errors`, `state`, `types`,
  `use<Dominio>`, `presentation`, `server/forward` y `components/`.
- Frontend: `components/worker/` es histórico; no añadir código nuevo ahí.
- Código en inglés; textos de usuario en español; errores `MÓDULO_MOTIVO`.
- Tests: `*Test`, `*AuthorizationTest`, `*PostgresTest`; `tests/<área>-<tipo>.test.mjs`.
- Commits `tipo(alcance): descripción` con feat, fix, refactor, docs, test o chore.

## Seguridad obligatoria

- Nunca leer ni imprimir valores de `.env`; nunca commitear secretos.
- La service role key solo en backend. Sin variables `NEXT_PUBLIC_` sin decisión explícita.
- En cada BFF: `sameOrigin` si muta, sesión, rol, validación estricta y `fetch` con
  `cache: "no-store"`, `redirect: "error"` y timeout. Sin errores crudos.
- Rol, actividad y cafetería salen de la base de datos, nunca del JWT ni del navegador.
- Precios, totales y disponibilidad se calculan en servidor.
- Tablas de negocio cerradas al navegador. Migraciones nuevas con `REVOKE` explícito.
- No modificar migraciones aplicadas. Las nuevas se prueban en bases temporales locales y
  luego en `unifood-staging`; nunca se estrenan en el proyecto real.
- No tocar Supabase remoto, producción ni deploys sin mostrar el comando exacto y recibir OK.

## Reglas de trabajo

1. Cada tarea en su rama desde `develop` (`feature|fix|docs|refactor|test|chore/<tema>`),
   con PR pequeño. Sin `git add .`: archivos por nombre.
2. Plan breve (archivos, riesgos, pruebas) y esperar aprobación antes de implementar.
3. Ejecutar las verificaciones del área y reportar solo lo ejecutado.
4. Ante una decisión de negocio o ambigüedad, preguntar. Si algo falla, parar y mostrarlo.
5. Configuración de GitHub: mostrar el comando exacto y esperar OK.
6. Resumen final de máximo 8 líneas: qué cambió, qué se verificó y qué queda pendiente.
7. `origin/feature/client-orders` es de Jonathan: no integrarla ni modificarla.
