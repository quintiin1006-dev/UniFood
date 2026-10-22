# Catálogo ADMIN

## Modelo y alcance

El catálogo físico permanece en public.lunches. El nombre procede del esquema
inicial; las órdenes, las FK y la persistencia existente usan esa tabla. La UI
habla de productos sin crear otra fuente de catálogo ni renombrar relaciones.

La proyección utiliza id (uuid), name (varchar(150)), description (text nullable),
price (numeric(12,2), mayor que cero), image_url (text nullable),
category (public.catalog_category), is_active (boolean) y version (bigint).
cafeteria_id es la FK obligatoria que delimita la consulta; no se publica.
Desde 013 la categoría es obligatoria, tras clasificación humana explícita.

Las categorías son DEL_DIA, CORRIENTE, EJECUTIVO, ESPECIAL y DESAYUNO.
Se presentan como Del día, Corriente, Ejecutivo, Especial y Desayuno.
No existen BEBIDAS, orden manual ni bebidas destacadas.

is_active expresa actividad comercial. La lectura no usa stock ni infiere
disponibilidad diaria. WORKER conserva la autoridad para habilitar productos.
La reactivación comercial deshabilita únicamente la disponibilidad del día actual
en la misma transacción; una habilitación anterior no reaparece automáticamente.
Los snapshots lunch_name/unit_price de order_items y las FK de 011 no cambian.
CLIENT conserva su catálogo actual; esta lectura no lo conecta a PostgreSQL.

## Autoridad y consulta

Browser → Next/BFF → Spring → PostgreSQL.

GET /api/admin/catalog existe en Next y Spring. Solo el subject del JWT verificado
entra al caso de uso. Los parámetros y headers del navegador no eligen cafetería
ni usuario. Spring exige un usuario business activo, rol exactamente ADMIN y una
sola asignación, utilizando AuthorizationQueryPort como ADMIN Profile.
No modifica las políticas WORKER, CLIENT ni de órdenes.

La transacción es readOnly, REPEATABLE_READ y timeout de 15 segundos. La decisión
de autorización y la lectura comparten snapshot: una consulta de autorización
y una consulta parametrizada con LEFT JOIN cafeterias/lunches, sin N+1.
La cafetería inexistente se rechaza; una cafetería existente sin productos
devuelve products vacío. Una cafetería administrativamente inactiva sigue siendo
legible y conserva el aviso del shell.

Se incluyen productos activos e inactivos y se ordenan por nombre COLLATE "C"
e id, sin persistir un orden comercial nuevo.
El índice existente idx_lunches_cafeteria_active tiene cafeteria_id como prefijo;
también existe la unicidad (cafeteria_id,name). No se añaden índices.
La migración 016 incorpora la revisión monotónica descrita más adelante.

## Contrato

Ejemplo, con campos opcionales representados explícitamente por null:

```json
{
  "products": [
    {
      "id": "10000000-0000-0000-0000-000000000001",
      "name": "Ejecutivo de la casa",
      "description": null,
      "price": "18500.25",
      "category": "EJECUTIVO",
      "imageUrl": null,
      "active": true,
      "version": "0"
    }
  ]
}
```

price es un string decimal exacto de PostgreSQL/BigDecimal, no un número financiero
binario de JavaScript. La vista redondea a pesos enteros mediante aritmética BigInt
para mostrar, por ejemplo, $ 18.500. El contrato conserva los centavos originales;
el editor utiliza ese precio original. version también es un string decimal,
sin conversión a Number ni pérdida de precisión.

El BFF verifica la identidad con Auth y la admisión mediante current_auth_profile.
Spring vuelve a resolver la autorización business y la asignación.
No se usan grants de tablas business del navegador. No se reenvían query params,
tokens aportados por el caller, cookies upstream ni campos ajenos al contrato.
El transporte de panel-profile no se fuerza aquí porque añade email al perfil,
campo innecesario para esta respuesta.

Todas las respuestas de la aplicación usan no-store; redirects upstream bloqueados,
timeout BFF 15 s y timeout de navegador 30 s. Errores:
401 sin identidad válida, 403 sin autorización, 503 temporal con Retry-After
acotado (fallback 5), 500 interno sanitizado y 502 para un contrato inválido.
El advice Spring está limitado a AdminCatalogController.
Un 503 permite reintentar y no borra la sesión; 401 muestra el acceso contextual
al login y 403 no ofrece reintentar permisos.

## Interfaz

/admin/catalogo reutiliza el shell, header, sidebar, drawer y el contexto de perfil
existentes. Presenta tarjetas, búsqueda por nombre, categoría y estado comercial.
No hay métricas ni contadores agregados. Se permite crear, editar los campos
comerciales y activar/desactivar con confirmación, sin borrar productos.
Carga, error, catálogo vacío y filtros sin resultados tienen estados distintos.

La búsqueda local ignora mayúsculas y diacríticos y se combina con ambos filtros.
Se descarga el catálogo completo de una única cafetería; cambiar filtros no
realiza nuevas consultas. Es una decisión de simplicidad para un catálogo
operativo pequeño/mediano, no una garantía de cardinalidad del esquema.
No se midió volumen productivo y no hay un límite de filas en la base. Si crece
hasta producir payloads o renders costosos, medir y evolucionar a consulta
paginada en servidor, sin truncar resultados silenciosamente ni añadir índices
preventivos.

La política de imágenes y los valores/labels de categorías se reutilizan de
los helpers existentes de Disponibilidad, sin reutilizar su estado ni lógica diaria.
Solo se admiten rutas locales seguras de imágenes raster. image_url no impone un
origen remoto a nivel SQL; URLs vacías, remotas, no soportadas o imágenes fallidas
muestran Sin imagen. No se amplía Next remotePatterns, no se administra Storage
ni se fabrican referencias. Un origen remoto futuro requiere una decisión
explícita y una allowlist restringida.

Grid de una columna en móvil, dos en tablet, tres/cuatro según espacio desktop.
Labels visibles, foco de teclado, heading de cada producto y estados textuales
conservan el acceso sin depender del color.

## Escrituras y concurrencia

POST /api/admin/catalog recibe name, price y category; description es opcional.
PATCH /api/admin/catalog/{productId} reemplaza el formulario comercial completo
y exige expectedVersion. PATCH /api/admin/catalog/{productId}/status recibe
active explícito y expectedVersion. price y expectedVersion son strings decimales.
No se aceptan selectores de cafetería, campos desconocidos, JSON inválido ni cuerpos
de más de 16 KiB. Nombre sin espacios exteriores, máximo 150 caracteres Unicode;
descripción nullable de hasta 2.000 caracteres para valores nuevos; precio positivo
hasta 9999999999.99 con máximo dos decimales, sin redondeo implícito.
Los valores históricos no se truncan. La unicidad conserva la semántica SQL actual.

La creación fija is_active=true, stock=0 e image_url=NULL y no habilita una fila
diaria. La conexión del catálogo CLIENT y su checkout productivo sigue fuera de
este módulo; no se añade una integración de pedidos CLIENT.

Cada comando utiliza READ_COMMITTED, timeout 15 s y el orden:
guard de perfiles FOR SHARE → autorización actual → cafetería FOR SHARE activa
→ producto propio FOR UPDATE → comparación y UPDATE WHERE version=expectedVersion.
Las consultas son parametrizadas y devuelven RETURNING; no se utiliza el save
genérico de Lunch. El guard compartido coordina revocaciones con los triggers
de 009. La cafetería se bloquea antes del producto, compatible con FIFO y WORKER.

016 fija revisión inicial 0, y un trigger incrementa OLD.version+1 en cada UPDATE,
incluso privilegiado; no acepta revisiones elegidas en INSERT. El trigger invalida
versiones anteriores, pero no sustituye el predicado CAS de los comandos.
No cambia ownership, imágenes, stock ni snapshots de órdenes en una edición.

Al pasar de inactivo a activo, el bloqueo exclusivo del producto coordina con
el FOR SHARE del WORKER y se pone is_available=false en la fila existente del día
actual America/Bogota. Se conservan fechas anteriores y filas ausentes; no se crea
ninguna habilitación. Un WORKER posterior puede habilitarlo explícitamente.
Solicitar active=true sobre un producto ya activo no reinicia una habilitación nueva.
Un error al reiniciar la disponibilidad revierte también estado y versión.

Errores de comandos: 400 ADMIN_CATALOG_INVALID_REQUEST; 404
ADMIN_CATALOG_PRODUCT_NOT_FOUND para producto ajeno o inexistente; 409
ADMIN_CATALOG_STALE_VERSION o ADMIN_CATALOG_DUPLICATE_NAME; 403
ADMIN_CATALOG_CAFETERIA_INACTIVE para escrituras con cafetería inactiva.
Los demás contratos de autenticación, indisponibilidad y errores internos se conservan.
El BFF exige mismo origen, identidad verificada y admisión ADMIN; no reintenta escrituras.

El drawer modal gestiona foco, Escape, retorno de foco y descarte explícito del
borrador. Un refresco temporal del perfil conserva el editor, pero bloquea escrituras
hasta verificar el contexto; una denegación definitiva retira el contenido protegido.
La cafetería inactiva conserva lectura y deshabilita todos los comandos.
Solo se muestra éxito con una representación confirmada. Un GET obsoleto pendiente
no puede reemplazar esa representación. Ante conflicto o resultado de red incierto
se conserva el borrador y se ofrece revisar el catálogo, sin reenvío automático.

## Evolución posterior

BEBIDAS requeriría una migración nueva del enum y actualización de contratos/labels.
El orden manual necesitaría persistencia y reglas de ordenación; las bebidas
destacadas necesitarían un campo/relación y restricciones de categoría y cafetería.
Estas decisiones no están implementadas en este módulo.
