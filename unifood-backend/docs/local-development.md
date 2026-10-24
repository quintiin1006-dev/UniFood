# Backend local en Windows PowerShell

## Arranque y archivo privado

Desde la raiz del monorepo, crear el archivo una sola vez si no existe:

```powershell
New-Item -Path .\unifood-backend\.env -ItemType File `
  -Value (Get-Content -LiteralPath .\unifood-backend\.env.example -Raw) `
  -ErrorAction Stop
```

El comando no utiliza `-Force`: si el archivo ya existe, no lo sobrescribe.
Completar sus credenciales en el editor local y ejecutar:

```powershell
.\start-backend.ps1
```

El launcher encuentra `unifood-backend` desde su propia ubicacion, no desde el
directorio actual. Tambien puede invocarse con su ruta absoluta. No escribe `.env`,
el perfil de PowerShell ni variables persistentes del usuario o del sistema.
Restaura el entorno y directorio de la terminal al finalizar y devuelve el codigo
de salida de Maven. No debe cargarse con dot-sourcing; ejecutarlo con `&` o `.\`.

Si la politica local impide ejecutar un script propio, puede usarse un proceso
temporal, sin modificar la politica del usuario o del equipo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-backend.ps1
```

Las politicas administradas del equipo siguen aplicando.

## Variables y precedencia

El archivo admite exclusivamente las entradas existentes del backend:

| Variable | Requisito |
| --- | --- |
| `SUPABASE_DB_URL` | Obligatoria; JDBC PostgreSQL |
| `SUPABASE_AUTH_ISSUER` | Obligatoria; issuer HTTP(S), sin credenciales, query o fragmento |
| `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` | Segun la conexion; preferir credenciales separadas de la URL |
| `SPRING_PROFILES_ACTIVE` | Opcional; no se elige un perfil automaticamente |
| `SUPABASE_STORAGE_URL`, `SUPABASE_STORAGE_SECRET_KEY` | Ambas presentes o ambas vacias |
| `SUPABASE_PRODUCT_IMAGES_BUCKET` | Opcional; default Spring `product-images` |
| `PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS` | Opcional; entero de 1 a 10; default 5 |
| `PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS` | Opcional; entero de 1 a 30; default 20 |
| `PRODUCT_IMAGES_CLEANUP_ENABLED` | Opcional; `true` o `false`; default Spring sigue siendo `true` |

Las variables NO vacias ya definidas en el proceso tienen prioridad sobre `.env`.
Una variable del proceso con solo espacios se considera invalida, no un motivo
para sustituirla silenciosamente. Si falta `.env` pero el entorno ya contiene las
variables necesarias, el launcher permite arrancar y lo informa. Si faltan valores
necesarios, falla antes de Maven con sus nombres, sin imprimir valores.

Las variables se transfieren al proceso hijo; Spring conserva sus placeholders,
autoconfiguracion y precedencia normal. No se agrego una libreria dotenv, un perfil
hardcodeado ni una importacion de archivos locales en produccion. El comando
existente `.\mvnw.cmd spring-boot:run`, desde `unifood-backend`, continua funcionando
con variables inyectadas por el entorno o el IDE; por si solo no carga `.env`.
Otros overrides de Spring/JVM siguen siendo responsabilidad del entorno de
despliegue; no introducirlos para seleccionar otro proyecto accidentalmente.

## Formato del archivo

UTF-8, con o sin BOM, una asignacion por linea. Se separa solo por el primer `=`.
Se permiten lineas vacias, comentarios completos con `#` y el prefijo `export`.

```dotenv
SPRING_DATASOURCE_PASSWORD='valor-local-con=igual&y?pregunta#literal'
```

Las comillas exteriores son opcionales; preservan los espacios interiores. No hay
interpolacion de `$variables`, ejecucion de `$()`, conversion de escapes ni
continuaciones de linea. `#`, `&`, `?`, `=`, `$` y las barras se conservan como datos.
No usar comentarios al final de una asignacion: escribirlos en una linea aparte.
Se rechazan nombres desconocidos, asignaciones repetidas y comillas sin cerrar.
El archivo no puede cambiar PATH, opciones de Maven ni agentes de Java.

## Storage inicial

El ejemplo contiene los valores no secretos solicitados:

```dotenv
SUPABASE_STORAGE_URL=https://qcdxkmowlbptgbgjuywc.supabase.co/storage/v1
SUPABASE_PRODUCT_IMAGES_BUCKET=product-images
PRODUCT_IMAGES_CONNECT_TIMEOUT_SECONDS=5
PRODUCT_IMAGES_OPERATION_TIMEOUT_SECONDS=20
PRODUCT_IMAGES_CLEANUP_ENABLED=false
```

Completar `SUPABASE_STORAGE_SECRET_KEY` solo en el archivo privado o el gestor de
secretos. No copiar una credencial del frontend: debe ser una credencial privilegiada
de servidor del proyecto correcto. Verificar tambien que DB e issuer pertenecen al
mismo entorno; el launcher no demuestra pertenencia, permisos ni conectividad.

`false` suspende la limpieza, NO las cargas. El default runtime no se modifico:
el ejemplo local elige `false` para las comprobaciones iniciales. Para trabajar sin
Storage, dejar URL y clave ambas vacias; se conserva la indisponibilidad segura
de imagenes existente. Consultar [ADMIN Product Images](admin-product-images.md)
antes de habilitar limpieza o configurar el bucket. El launcher no aprovisiona
recursos, ejecuta migraciones ni carga imagenes.

## Seguridad y produccion

`.env` y `.env.*` estan ignorados por Git; `.env.example` contiene solo ejemplos,
sin secretos. El launcher nunca muestra configuracion y filtra contrasena, clave
Storage y URL JDBC conocidas en la salida normal de Maven. Preferir la contrasena
separada de la URL; no activar dumps del entorno, trazas de credenciales ni debug
de autenticacion. La redaccion del launcher no sustituye la configuracion segura
de otros procesos, logs externos o herramientas del IDE.

Un archivo ignorado sigue siendo texto local: limitar su acceso a la cuenta de
desarrollo y no compartirlo, adjuntarlo a reportes ni publicarlo. No copiarlo a
Next.js, `public`, recursos Java, `.env.example` o artefactos de despliegue.

En produccion inyectar las mismas variables desde el gestor de secretos y usar el
arranque habitual del artefacto. No desplegar `.env` ni este launcher local como
mecanismo de seleccion automatica de proyectos. La configuracion real del entorno
conserva la autoridad.

## Validacion aislada

Desde la raiz:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\unifood-backend\src\test\powershell\StartBackend.Tests.ps1
```

Los tests copian el launcher a directorios temporales propios, usan un Maven falso
y procesos Windows PowerShell 5.1. Comprueban valores literales y Unicode,
precedencia, restauracion, ausencia de secretos en stdout/stderr, fallos previos al
arranque y codigos de salida. Nunca leen el `.env` real ni ejecutan Maven/Supabase.

Desde `unifood-backend`:

```powershell
.\mvnw.cmd -Dtest=EnvironmentConfigurationTest test
```

Comprueba los placeholders reales y el binding desde variables sinteticas con
Spring, sin inicializar clientes externos ni usar el entorno del desarrollador.
