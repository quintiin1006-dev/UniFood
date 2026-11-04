# WORKER: diagnóstico de imágenes de productos durante P4.3

## Conclusión y alcance

Hay una incompatibilidad reproducible entre las imágenes gestionadas por ADMIN
y la proyección de disponibilidad WORKER. ADMIN usa `image_asset_id`; WORKER
continúa leyendo únicamente `image_url`. Si el producto tiene un asset gestionado
y su URL antigua es nula, WORKER recibe `image: null` y presenta «Sin imagen».
Si conserva una URL antigua, puede presentar la imagen anterior o descartarla
según su formato.

Esto explica un caso verificable en el código, pero no identifica el registro
concreto observado por el usuario: no se consultó Supabase real ni se recibió una
URL o respuesta de red de esa prueba manual. No se modificaron WORKER, backend,
BFF, endpoints, políticas, credenciales, imágenes ni registros.

## Recorrido de datos encontrado

1. ADMIN carga imágenes mediante `AdminCatalogImageService`. Los bytes normalizados
   se guardan en Storage, por defecto en `product-images`, con clave que contiene
   cafetería, producto y asset. `CatalogImagePersistenceAdapter` asocia
   `lunches.image_asset_id`. Al asociar un asset conserva el `image_url` anterior;
   no escribe en ese campo una URL pública nueva.
2. `AdminCatalogPersistenceAdapter` usa `CatalogImage.source`: si existe asset,
   publica `/api/admin/catalog/{productId}/image/{assetId}`; en otro caso usa la URL
   antigua. La ruta de lectura privada verifica producto, asset y cafetería.
3. `DailyAvailabilityPersistenceAdapter` usa `sql/availability/today.sql`, que
   selecciona `l.image_url` y no selecciona `image_asset_id`. No ejecuta la misma
   resolución de imágenes que ADMIN. `TodayAvailabilityResponse` entrega ese valor
   en `items[].image`.
4. El BFF WORKER y `features/availability/contracts.ts` preservan `image`, incluso
   cuando es nulo. El `id` del producto también se conserva. La consulta limita
   productos a la cafetería autorizada.
5. `features/availability/presentation.ts::productImageSource` solo acepta rutas
   locales con extensión de imagen. Descarta URLs HTTPS públicas o firmadas, URLs
   privadas ADMIN sin extensión y valores nulos antes de intentar la descarga.
6. `ProductCard.tsx` presenta «Sin imagen» si el origen no es admitido o falla la
   carga. Para rutas locales admitidas utiliza `next/image` con optimización.

## URLs, permisos y Next.js

ADMIN utiliza `adminImageSource` y `managedCatalogImage` para reconocer rutas
privadas del producto esperado. `AdminProductCard` usa `unoptimized` para ellas;
los bytes se solicitan mediante su BFF autenticado. Storage se lee desde Spring
Boot por una ruta autenticada; no se entrega una credencial al navegador ni se
genera una URL pública o firmada en este recorrido.

La ruta ADMIN no sirve como solución directa para WORKER: tanto el BFF
`features/admin-catalog/server/images.ts` como `AdminCatalogImageService.authorize`
exigen exclusivamente ADMIN. Cambiar solo el filtro visual de WORKER produciría
un acceso denegado para ese rol, según el código de autorización.

`next.config.ts` no configura `images.remotePatterns`. Pero añadir un dominio por
sí solo tampoco resuelve el problema: WORKER descarta las URLs remotas antes de
renderizar y su consulta no proyecta el asset gestionado. No hay evidencia de un
403 o un objeto inexistente en Storage real; no se hicieron peticiones allí.

## Evidencia reproducida

Se ejecutó un diagnóstico Node de solo lectura con seis aserciones y sin red:

| Entrada o recorrido de fixture                       | Resultado                            |
| ---------------------------------------------------- | ------------------------------------ |
| Ruta privada correcta para ADMIN y producto esperado | Admitida por `adminImageSource`      |
| Misma ruta privada en WORKER                         | Descartada por `productImageSource`  |
| URL HTTPS de Storage ficticio en WORKER              | Descartada antes de descargar        |
| `/unifood-logo.png` en WORKER                        | Admitida como imagen local           |
| Proyección de disponibilidad                         | Conserva el id del producto          |
| Imagen nula en esa proyección                        | Permanece nula, sin inventar una URL |

El catálogo ADMIN y la disponibilidad WORKER leen el mismo producto, pero resuelven
su imagen de forma diferente. No se verificó la correspondencia entre un objeto
real de Storage y el producto de la prueba manual. La accesibilidad de ese objeto
y la respuesta del navegador real quedan pendientes.

## Origen de la incidencia

Se comparó `e064a45`, base anterior a los cinco commits del Dashboard, con HEAD
`618d47c`. No hay cambios en WORKER, la consulta de disponibilidad, la asociación
de assets, la política de imágenes del catálogo ni `next.config.ts`. Los archivos
también permanecen intactos frente a la línea base de P4.3.

La política local de WORKER ya estaba presente en `b4d455f`
(`feat(availability): add worker availability interface`). La separación entre
assets ADMIN y URL antigua WORKER existía antes de esta rama de Dashboard.
No se encontró una regresión introducida por P1–P4.3 que explique esta incompatibilidad.

La configuración y los datos de diferentes entornos podrían variar: un producto
con una ruta local antigua puede verse mientras otro con asset gestionado y
`image_url` nulo no. No se inspeccionaron valores de `.env` ni se atribuye la
incidencia a credenciales, puertos o políticas de un entorno concreto sin evidencia.

## Corrección propuesta por separado

Rama sugerida: `fix/worker-product-images`, sin crearla en esta tarea.

Resolver el asset actual en la proyección WORKER y ofrecer una lectura autenticada
para WORKER, limitada a su cafetería y al producto/asset asociado. Reutilizar la
lectura de Storage y actualizar la presentación para reconocer esa ruta, evitando
la optimización compartida de imágenes privadas. Conservar la ruta ADMIN y sus
restricciones actuales. Esto requiere revisar backend, BFF y WORKER fuera de P4.3;
no se ejecutó esa corrección.

Antes de implementarla, contrastar una respuesta real de disponibilidad y el
producto observado mediante lecturas autorizadas, y verificar su asset sin exponer
URLs firmadas o credenciales. Añadir pruebas de lectura por rol/cafetería, asociación
del producto, reemplazo de imagen, legado, ausencia y recurso inaccesible.

Este diagnóstico puede acompañar la revisión del Dashboard sin mezclar una
corrección funcional de WORKER dentro de sus commits.
