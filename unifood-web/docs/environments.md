# Configuración de entornos

El mismo código se utiliza en local, staging y production. No hay selección automática de proyecto Supabase ni de backend. Mantener proyectos, bases de datos y variables de despliegue separados por entorno; nunca reutilizar las credenciales de production en tests.

## Variables

| Aplicación | Variable                                                   | Local                                                  | Staging / production                                                         |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Backend    | `SUPABASE_DB_URL`                                          | Obligatoria, URL JDBC PostgreSQL externa               | Obligatoria, base del entorno                                                |
| Backend    | `SUPABASE_AUTH_ISSUER`                                     | Obligatoria, issuer externo                            | Obligatoria, issuer del entorno                                              |
| Backend    | `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` | Según la conexión                                      | Según la conexión; usar el gestor de secretos                                |
| Backend    | `SPRING_PROFILES_ACTIVE`                                   | Opcional                                               | Opcional; puede etiquetar `staging` o `production`                           |
| Web        | `API_URL`                                                  | Obligatoria; ejemplo explícito `http://localhost:8080` | Obligatoria; URL del backend accesible desde Next.js                         |
| Web        | `SUPABASE_URL`                                             | Obligatoria para auth                                  | Obligatoria al construir y arrancar                                          |
| Web        | `SUPABASE_PUBLISHABLE_KEY`                                 | Obligatoria para auth                                  | Obligatoria al construir y arrancar                                          |
| Web        | `NODE_ENV`                                                 | Next.js usa `development` con `next dev`               | Next.js usa `production` con `next build` / `next start`, también en staging |

Las variables anteriores son **server-only**. La clave publishable/anon es una credencial pública del proveedor, pero esta implementación la usa deliberadamente en el servidor. La validación exige una clave presente y no vacía; no interpreta su formato ni determina sus privilegios. Configurar exclusivamente la clave pública del proyecto, nunca una clave privilegiada. `NEXT_PUBLIC_API_URL` no es una alternativa admitida.

`AUTH_USERNAME_DOMAIN` sigue siendo server-only y conserva su comportamiento actual. `NEXT_PUBLIC_CAFETERIA_ID` sigue siendo pública, con su comportamiento actual y su valor fijado al construir. Su eliminación corresponde a otra fase.

El backend conserva la audiencia JWT `authenticated`. Se exige una URL JDBC PostgreSQL y un issuer HTTP(S) sin credenciales, query ni fragmento. Las URLs web deben ser HTTP(S), absolutas y sin credenciales, query ni fragmento; se permiten rutas base y se normaliza la barra final. HTTP sigue disponible para desarrollo y conexiones internas explícitas. En despliegues, usar HTTPS en las conexiones externas y TLS en PostgreSQL según el proveedor.

## Local

Desde `unifood-web`, copiar el ejemplo:

```powershell
Copy-Item .env.example .env.local
npm run dev
```

El ejemplo proporciona `API_URL=http://localhost:8080`. Si ambos valores Supabase están vacíos, solo en `next dev` se permite previsualizar la UI; el servicio de autenticación permanece sin configurar. Si se proporciona uno, también debe proporcionarse el otro y ambos deben ser válidos.

Para autenticación real, completar el proyecto y su clave pública del entorno local. Puede usarse Supabase local o un proyecto remoto dedicado al desarrollo. Los `.env.local` no se versionan.

Spring no carga automáticamente `.env` ni `.env.example`. Desde `unifood-backend`, exportar las variables o suministrarlas desde la configuración de ejecución del IDE. Ejemplo para una instancia Supabase local:

```powershell
$env:SUPABASE_DB_URL='jdbc:postgresql://localhost:54322/postgres'
$env:SUPABASE_AUTH_ISSUER='http://localhost:54321/auth/v1'
# Configurar también usuario y contraseña según la instancia local.
.\mvnw.cmd spring-boot:run
```

No hay un perfil activo hardcodeado. No se crean archivos `application-dev.properties`, `application-staging.properties` o `application-production.properties` porque los requisitos comunes no necesitan duplicarse.

El servidor web mantiene su arranque en `::`, puerto 3000, para localhost y LAN. Esta fase no cambia listeners, CORS, rutas ni permisos.

## Staging y production

1. Inyectar variables desde el entorno de CI/despliegue; no distribuir `.env.local` de un desarrollador.
2. Definir las tres variables web antes de `npm run build` y nuevamente en el entorno que ejecuta `npm run start`. El hook de arranque valida también los valores de runtime cuando se promociona un artefacto.
3. Ejecutar Next.js en modo `production`, también para staging. No usar `NODE_ENV=staging` ni `next dev` en un despliegue.
4. Definir DB e issuer antes de arrancar Spring. El validador se ejecuta antes de inicializar los clientes de persistencia y JWT.
5. Verificar que `SUPABASE_URL`, issuer, clave pública y base pertenezcan al mismo entorno y proyecto. La validación local comprueba presencia y formato; no verifica pertenencia ni conectividad con servicios remotos.
6. Evitar overrides accidentales como `SPRING_DATASOURCE_URL` o propiedades JVM. Spring valida los valores efectivos, pero un override explícito válido también puede seleccionar otro entorno.

Una variable ausente, vacía o con formato inválido aborta el arranque con su nombre, sin imprimir el valor. `next build` también valida la configuración. No existe fallback a localhost ni a un proyecto concreto.

## Tests y build de comprobación

Los tests backend usan `application-test.properties` dentro de `src/test/resources`, con precedencia explícita sobre las variables del desarrollador. El test de contexto sustituye repositorios, `JdbcTemplate` y decoder JWT por mocks y excluye la autoconfiguración de persistencia. No se conecta a Supabase ni PostgreSQL. Ese archivo no se empaqueta en el runtime de la aplicación.

Los tests de configuración web reciben un entorno aislado. El test del BFF proporciona su `API_URL` de prueba explícitamente; sus peticiones siguen simuladas. PGlite continúa en memoria.

```powershell
# Desde unifood-backend
.\mvnw.cmd test
# Desde unifood-web
npm test
npm run lint
npm run build
```

Para una comprobación de build sin proveedor real, se pueden proporcionar fixtures no sensibles exclusivamente en el proceso de CI:

```powershell
$env:API_URL='http://localhost:8080'
$env:SUPABASE_URL='https://configuration-test.invalid'
$env:SUPABASE_PUBLISHABLE_KEY='sb_publishable_configuration_test_only'
npm run build
```

Estos fixtures permiten compilar; no habilitan autenticación ni prueban conectividad. No utilizarlos como configuración de un despliegue. En runtime deben estar disponibles los valores válidos del entorno real.
