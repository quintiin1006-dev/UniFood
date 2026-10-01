# Estándares de trabajo del equipo UniFood

> **Estado:** aprobado por los dos integrantes el 30 de septiembre de 2026.

## 1. Guía de estilo y nombres

El repositorio es un monorepo con backend Java 21/Spring en `unifood-backend/` y frontend Next.js/React con TypeScript en `unifood-web/`.

- **Java:** seguimos Google Java Style. Spotless con Google Java Format está configurado en Maven. Desde `unifood-backend/`, comprobamos el formato con `bash ./mvnw spotless:check` y lo corregimos con `bash ./mvnw spotless:apply`.
- **TypeScript y JavaScript:** seguimos la configuración ESLint existente para Next.js Core Web Vitals y TypeScript. Prettier está configurado en `unifood-web/`; para cada archivo frontend modificado, usamos `npm run format -- ruta/al/archivo` para aplicar el formato y `npm run format:check -- ruta/al/archivo` para comprobarlo.
- **Idioma:** nombres de código en inglés; documentación y mensajes del equipo pueden estar en español. Los mensajes de commit siguen el formato e idioma de los commits existentes en el repositorio.
- **Nombres propios del equipo:** clases, interfaces y componentes React usan `PascalCase` (por ejemplo, `OrderService` y `OrderSummary`); variables y funciones usan `camelCase` (por ejemplo, `orderId` y `findOrder`); paquetes Java usan minúsculas y guiones bajos no se usan en identificadores Java.
- **Pruebas:** los archivos de prueba conservan las convenciones del módulo correspondiente; las pruebas frontend usan el patrón `*.test.mjs` ya presente.

## 2. Ramas y commits

- `main` contiene versiones estables. No se suben cambios directamente a esta rama.
- `develop` integra el trabajo terminado antes de llegar a `main`. Las ramas de trabajo nacen de `develop` y se integran mediante pull request hacia `develop`.
- Nombres de rama en minúsculas y con guiones: `feature/<tema>`, `fix/<tema>`, `docs/<tema>`, `refactor/<tema>` o `test/<tema>`. Ejemplos: `feature/order-history`, `fix/order-validation`, `docs/estandares-equipo`.
- Seguimos el estilo de commits que ya aparece en el repositorio: `tipo(alcance): descripción breve`, con alcance opcional. Tipos permitidos: `feat`, `fix`, `refactor`, `docs`, `test` y `chore`. Ejemplos: `feat(orders): add order history`, `fix(auth): handle expired token`, `docs: add team standards`.
- Un commit describe un cambio concreto. Los merges se realizan desde el pull request de GitHub; no se crean commits de merge manuales para simular revisión.

## 3. Definition of Ready (DoR)

Una tarea está lista para comenzar cuando otra persona del equipo puede verificar que:

1. Tiene un objetivo escrito y criterios de aceptación observables.
2. Se identificó el módulo afectado (`unifood-backend/`, `unifood-web/` o migraciones de base de datos).
3. Las decisiones necesarias de API, datos, interfaz y dependencias están tomadas o anotadas como pendientes.
4. Se conoce cómo comprobar el resultado mediante pruebas, comandos o pasos reproducibles.
5. El equipo tiene acceso a los recursos necesarios; los secretos no se comparten en el repositorio.

## 4. Definition of Done (DoD)

Una tarea está terminada cuando un integrante que no la implementó puede comprobar que:

1. El cambio cumple todos los criterios de aceptación escritos para la tarea.
2. Para cambios del backend, `bash ./mvnw verify` termina correctamente desde `unifood-backend/`; si se modificó Java, también pasa `bash ./mvnw spotless:check`.
3. Para cambios del frontend, `npm run lint`, `npm test` y `npm run build` terminan correctamente desde `unifood-web/`; `npm run format:check -- ruta/al/archivo` pasa para cada archivo frontend modificado.
4. Si cambia el esquema o comportamiento de base de datos, se incluye una nueva migración en `unifood-backend/supabase/migrations/`; no se modifica una migración ya aplicada.
5. La documentación de instalación, uso o contratos se actualiza si el cambio la afecta. No se suben credenciales, archivos `.env` ni datos privados.
6. El pull request explica qué cambió y cómo se verificó, recibió aprobación del otro integrante y se integró a `develop`.

Antes de correr los comandos frontend por primera vez o después de cambiar dependencias, se ejecuta `npm ci` desde `unifood-web/`. En Windows, el comando del backend es `mvnw.cmd verify` o `mvnw.cmd spotless:check` desde `unifood-backend/`.

## 5. Política de revisión

- Cada cambio que vaya a `develop` o `main` se presenta en un pull request. Quien lo implementó no lo aprueba; lo revisa el otro integrante.
- El revisor responde dentro de las 24 horas siguientes a la solicitud. Si no puede cumplir ese plazo, avisa y acuerda con el autor una nueva hora de respuesta. No se integra sin revisión.
- **Bloquean la integración:** compilación, lint, formato o pruebas fallidas; un riesgo de seguridad, privacidad o pérdida/corrupción de datos; criterios de aceptación sin cumplir; o un punto de DoD que no se pueda comprobar.
- **No bloquean por sí solos:** preferencias de estilo ya cubiertas por las reglas automáticas, sugerencias de refactor que no afectan los criterios, y cambios futuros fuera del alcance acordado.
- Cada observación señala archivo y línea, explica el impacto y dice qué resultado hace falta. Se marca como `BLOQUEANTE` o `SUGERENCIA`. El autor responde a cada comentario; los bloqueantes se resuelven antes de aprobar.

## 6. Roles y aceptación

Para acordar y publicar este documento:

- **Juan Jose Torres Quintin:** redactor y responsable del repositorio. Redacta lo que el equipo acuerde, crea el archivo, realiza el commit y comparte el enlace.
- **Jonathan Alexis Panesso Toro:** guardián de lo verificable y abogado del diablo. Comprueba que cada punto se pueda verificar y plantea escenarios donde cumplirlo sería difícil.

Cada integrante completa su aceptación después de revisar el documento. La aceptación es individual; una persona no confirma por la otra.

- [x] Juan Jose Torres Quintin: “Conozco y acepto estos estándares.” Fecha: 30 de septiembre de 2026.
- [x] Jonathan Alexis Panesso Toro: “Conozco y acepto estos estándares.” Fecha: 30 de septiembre de 2026.
