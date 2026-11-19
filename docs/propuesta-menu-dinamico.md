# Propuesta: menú del día dinámico

Estado: **revisión 2, borrador de diseño para aprobación**. Rama `jj/menu-dinamico`, desde `develop`.
Fecha: 2026-11-18. Esta propuesta no contiene código de la app ni migraciones aplicadas.
La migración 030 es un borrador: no se aplica hasta revisión y prueba en una base temporal
local, y después en `unifood-staging`.

Base revisada: `features/availability`, `features/client` (`ClientHome`, `ClosedBanner`,
`ProductAddButton`, `CartLineItem`, `domain/cart.ts`, `domain/menu.ts`, `types.ts`),
`features/client-orders`, `features/shared/messages.ts`, `components/worker/OrderCard.tsx`,
backend `OrderEntity`, `OrderItemEntity`, `ClientOrderCreationService`, `ClientOrderRequests`,
`OrderService`, `DailyCloseService`, `DailyCloseScheduler`, `BusinessDate`, SQL de cierre diario,
migraciones 001, 011, 013, 016, 019, 021, 022, `docs/decisiones.md` y `docs/catalogo-feedback.md`.

### Decisiones incorporadas (revisión 2)

| Tema | Decisión |
| ---- | -------- |
| Freeze | Se mueve al **25 de noviembre**, solo para el menú dinámico (PR 1–8). El resto del código sigue con el freeze del sábado 21 |
| Feature flag | Todo el módulo detrás de `MENU_DINAMICO_ENABLED` (servidor y web, solo variable de servidor). Apagada, la demo sigue sin menú |
| Límite de texto | **350 caracteres por categoría**, suma de sus fichas. Sin contador visible. Se valida igual en servidor |
| Opciones | Máximo **20** por categoría |
| Obligatorias | Proteína y Principio. Saltables con «Ninguna»: Bebida y Complementos. Adiciones siempre saltable |
| Platos por pedido | Uno. Cuenta como una unidad de los límites 10/15; las adiciones no cuentan |
| Agotado con pedidos hechos | El pedido no cambia; se usa el rechazo con motivo existente (B18) |
| Copiar el de ayer | Copia solo ingredientes, no adiciones encendidas |
| Plato ya en el carrito | El botón del módulo dice «Actualizar carrito» |
| Precio del plato | Solo en el encabezado del módulo; cambia en la siguiente publicación |
| Precio de adición | Cambia en su siguiente encendido |
| Categorías del admin | Se desactivan, no se borran (fase admin) |
| Comas | Prohibidas en ingredientes (separan fichas) |
| Letrero | Encima del carrusel, en el hueco del banner de cerrada |
| Sin precio configurado | Aviso al worker; publicar deshabilitado; el cliente no ve nada |
| Quién publica | Solo el worker. La plantilla de categorías queda fija hasta la fase admin |
| Panel admin (PR 9) | Después de la demo |

---

## 1. Resumen y alcance

### Resumen

- Cada cafetería tiene **un** plato del día (p. ej. «Almuerzo del día») con **precio fijo**.
  Lo que cambia cada día son sus ingredientes.
- El plato tiene categorías de **una sola opción**: Proteína, Principio, Bebida y Complementos.
  Mientras no haya panel admin, la plantilla es fija y la misma en todas las cafeterías.
- Las categorías obligatorias no admiten saltarse. Las saltables muestran una ficha «Ninguna», así
  que la elección es siempre explícita y queda guardada.
- **Adiciones** es la única categoría de varias opciones, opcional, con precio extra fijado por el
  admin. El worker enciende cada día cuáles hay.
- El worker escribe los ingredientes de hoy en Disponibilidad y publica el menú. El menú se
  reinicia cada día a las 00:00 de Colombia porque todas las filas llevan `business_date`.
- El cliente ve un letrero «Menú del día» en Inicio. Lleva a `/cuenta/menu-del-dia`, un módulo
  propio con fichas. La barra inferior se queda en cuatro pestañas.
- El pedido guarda una **copia** de las opciones, de los precios y del precio del plato.

### Alcance de la demo

| Entra en la demo (si cabe el 25)                                                                                       | Se aplaza                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Migración 030 y siembra en staging (plato, 4 categorías, Adiciones, adiciones de ejemplo)                             | Pantalla de administración del menú (PR 9, después de la demo)            |
| Lectura del menú para el cliente: letrero y módulo                                                                    | Varios platos por pedido                                                  |
| Backend del worker: escribir ingredientes, encender adiciones, publicar, copiar ayer                                  | Ingredientes desde un catálogo reutilizable (hoy son texto libre)         |
| Worker: editor de ingredientes en Disponibilidad y botón de publicar                                                  | Historial del menú para el cliente                                        |
| Cliente: carrito y checkout con la elección, y pedido con copia                                                       | Corrección del cierre diario de pedidos (sección 8; va en PR aparte)      |
| Worker y cliente ven la elección en el pedido                                                                         |                                                                           |

### Calendario: lo que cabe (sección 7)

- Hoy es **miércoles 18**. El freeze para este módulo es el **miércoles 25**: siete días de
  calendario, con una sola sesión de Claude Code a la vez.
- El esfuerzo de los nueve PR suma **~17 días** de trabajo. Con una sola sesión no hay paralelismo,
  así que **no cabe completo** el 25. Lo que sí cabe, con la lista de recortes, está en la sección 7.

### Hallazgos del código que cambian el diseño

1. **El plato no se modela como fila de `lunches`.** Ese catálogo está atado a la enum de seis
   categorías fijas, a `stock` y a un precio por producto.
2. **`order_items.beverage_choice` no sirve.** La columna existe (001), se mapea en
   `OrderItemEntity`, pero ningún código la escribe.
3. **`order_items` no admite un ítem sin producto.** `lunch_id` es NOT NULL con FK compuesta (011).
   Las elecciones van en tablas propias.
4. **El total se calcula en servicio, no en la base.** `orders.total` lo fija la aplicación; el CHECK
   de 011 solo cubre cada línea de producto.
5. **El letrero puede ocupar el hueco del banner.** `ClientHome` ya pone el carrusel o el
   `ClosedBanner` en el mismo sitio.
6. **`OrderCard` está en `components/worker/`**, que es histórico. La vista de la elección va en un
   componente nuevo dentro de `features/daily-menu/`.
7. **El reinicio diario del menú sale gratis.** La 013 guarda cada día por `business_date`. Esto no
   aplica a los pedidos (sección 8).

---

## 2. Modelo de datos

### 2.1 Tablas

| Tabla                                | Qué guarda                                                                                  | Quién escribe                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `daily_menu_settings`                | Título y precio fijo del plato de la cafetería                                              | SQL de siembra (admin en fase 9)           |
| `daily_menu_categories`              | Plantilla: nombre, orden, tipo `SINGLE`/`ADDITIONS`, si se puede saltar, activa             | Siembra y la app al primer uso (admin en fase 9) |
| `daily_menu_additions`               | Catálogo de adiciones con su precio extra                                                   | SQL de siembra (admin en fase 9)           |
| `daily_menu_days`                    | Cabecera del día: publicado, versión, título y precio congelados al publicar                | WORKER                                     |
| `daily_menu_options`                 | Ingredientes de hoy, uno por fila, por categoría `SINGLE`                                   | WORKER                                     |
| `daily_menu_addition_availability`   | Qué adiciones hay hoy, con el precio que tenían al encenderse                               | WORKER                                     |
| `order_daily_menus`                  | Cabecera de la elección dentro del pedido: título y precio del plato copiados               | Spring, al crear el pedido                 |
| `order_daily_menu_choices`           | Una fila por elección: categoría, opción o «Ninguna» o adición, y precio copiado            | Spring, al crear el pedido                 |

### 2.2 Reglas

- **Una opción por categoría `SINGLE`.** Por pedido, cada categoría `SINGLE` activa tiene exactamente
  una elección: una opción o «Ninguna». «Ninguna» solo si `can_skip = true`. Se valida en servicio
  bajo bloqueo; un índice único parcial impide dos elecciones de la misma categoría en un pedido.
- **Adiciones:** solo una categoría `ADDITIONS` por cafetería (índice único parcial). Cero o más
  adiciones, sin repetir. Siempre saltable.
- **Obligatoriedad y publicación.** Un menú solo se publica si tiene precio fijo y cada categoría
  `SINGLE` activa y no saltable (Proteína, Principio) tiene al menos una opción hoy. Si después de
  publicar se vacía una obligatoria, el menú queda **incompleto**: el letrero se oculta y el worker
  ve qué falta. Se calcula al leer, no se guarda.
- **Reinicio diario del menú.** Solo cuentan las filas con `business_date` igual al día de negocio de
  Spring (America/Bogota). Lo de ayer queda como historial y no se muestra.
- **Precios congelados.**
  - El precio del plato y el título se copian en `daily_menu_days` al **publicar**. Un cambio del
    admin aplica desde la siguiente publicación.
  - El precio de cada adición se copia en `daily_menu_addition_availability` al **encenderla**.
- **Textos del worker.** Cada opción: quitar espacios de los extremos, colapsar espacios internos,
  1 a 350 caracteres, **sin comas** (la coma separa fichas). No se admiten duplicados sin distinguir
  mayúsculas (`lower(btrim(label))`) dentro de la categoría del día. Máximo **20 opciones** por
  categoría.
- **Límite de 350 caracteres por categoría.** Es la suma de los caracteres de las fichas de esa
  categoría (sin contar separadores, que no se guardan). Un disparador lo aplica en la base; el
  servicio lo valida antes para dar un error claro. No hay contador visible.

### 2.3 Cómo se guarda la elección del cliente en el pedido

El pedido guarda una **copia** de lo elegido: título, categoría, opción o «Ninguna», adición y su
precio, y el precio del plato. Así el historial no cambia cuando el worker edita el menú del día.

| Opción | Descripción | Ventajas | Contras |
| ------ | ----------- | -------- | ------- |
| **A. Tablas normalizadas con copia (recomendada)** | `order_daily_menus` (cabecera) y `order_daily_menu_choices` (una fila por elección), con snapshots y referencias de origen sin FK | Consultable por el worker y en reportes. CHECK por tipo de elección e índices únicos que protegen la regla «una por categoría». Inmutable por disparador. Se integra con la FK compuesta de `orders` (011) | Dos tablas más y más inserts por pedido |
| B. `jsonb` en `orders` | Una columna `orders.daily_menu` con el arreglo de elecciones | Una sola escritura, sin joins | Sin FK ni CHECK por elemento. La regla queda solo en la aplicación |
| C. Filas en `order_items` | El plato y las adiciones como líneas con `lunch_id` nulo | Reusa el total por línea | La 011 exige `lunch_id` NOT NULL con FK a `lunches`; rompería la integridad que la 011 cerró |
| D. Solo IDs de origen | Guardar IDs de opciones y reconstruir | Muy poco espacio | Las opciones se borran al día siguiente: el historial se pierde |

**Recomendación: A.** Las referencias de origen (`source_option_id`, `source_addition_id`) no tienen
FK a propósito: borrar un ingrediente de hoy no debe fallar por un pedido de hoy. La copia es lo que
se muestra y lo que cuenta.

### 2.4 Permisos y RLS

- Las ocho tablas nuevas siguen el patrón de la 013: `ENABLE ROW LEVEL SECURITY` sin políticas y
  `REVOKE ALL ... FROM PUBLIC, anon, authenticated`. El navegador no lee ni escribe nada de esto.
- Spring es el único que lee y escribe, con el mismo rol que ya usa para `orders` y
  `daily_item_availability`. Las comprobaciones de rol, cafetería y día se hacen en el backend.
- Las funciones de disparador tienen `REVOKE ALL ... FROM PUBLIC, anon, authenticated`.
- No hay secuencias: los IDs son `gen_random_uuid()`.

### 2.5 Borrador de la migración 030

Archivo previsto: `unifood-backend/supabase/migrations/030_daily_menu.sql`. Es el siguiente número
libre; **no se tocan 027, 028 ni 029**. Este bloque es un borrador para revisar, no un archivo
aplicable.

```sql
BEGIN;

-- 1. Plato del día por cafetería: título y precio fijo vigente. Cambia solo para la
--    siguiente publicación; cada día publicado guarda su copia en daily_menu_days.
CREATE TABLE public.daily_menu_settings (
  cafeteria_id uuid PRIMARY KEY REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  title varchar(100) NOT NULL DEFAULT 'Almuerzo del día',
  plate_price numeric(12,2),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_daily_menu_settings_title
    CHECK (title = btrim(title) AND length(title) BETWEEN 1 AND 100),
  CONSTRAINT chk_daily_menu_settings_price
    CHECK (plate_price IS NULL OR plate_price > 0)
);

-- 2. Plantilla de categorías por cafetería. SINGLE: una opción por pedido. ADDITIONS: varias.
--    Position único y diferible para poder reordenar en una transacción.
CREATE TABLE public.daily_menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  label varchar(60) NOT NULL,
  kind text NOT NULL,
  position integer NOT NULL,
  can_skip boolean NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_menu_categories_id_cafeteria UNIQUE (id, cafeteria_id),
  CONSTRAINT uq_daily_menu_categories_position
    UNIQUE (cafeteria_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT chk_daily_menu_categories_kind CHECK (kind IN ('SINGLE', 'ADDITIONS')),
  CONSTRAINT chk_daily_menu_categories_label
    CHECK (label = btrim(label) AND length(label) BETWEEN 1 AND 60),
  CONSTRAINT chk_daily_menu_categories_position CHECK (position >= 0),
  CONSTRAINT chk_daily_menu_categories_additions_optional
    CHECK (kind = 'SINGLE' OR can_skip)
);
CREATE UNIQUE INDEX uq_daily_menu_categories_one_additions
  ON public.daily_menu_categories(cafeteria_id) WHERE kind = 'ADDITIONS';
CREATE UNIQUE INDEX uq_daily_menu_categories_label
  ON public.daily_menu_categories(cafeteria_id, lower(label));

-- 3. Catálogo de adiciones con precio extra definido por el admin.
CREATE TABLE public.daily_menu_additions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  name varchar(100) NOT NULL,
  extra_price numeric(12,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_menu_additions_id_cafeteria UNIQUE (id, cafeteria_id),
  CONSTRAINT chk_daily_menu_additions_name
    CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 100),
  CONSTRAINT chk_daily_menu_additions_price CHECK (extra_price > 0)
);
CREATE UNIQUE INDEX uq_daily_menu_additions_name
  ON public.daily_menu_additions(cafeteria_id, lower(name));

-- 4. Cabecera del día. Se crea con la primera escritura del worker. Publicar congela el
--    título y el precio. version lo incrementa Spring con WHERE version = esperada.
CREATE TABLE public.daily_menu_days (
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  title_snapshot varchar(100),
  plate_price_snapshot numeric(12,2),
  published_at timestamptz,
  published_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cafeteria_id, business_date),
  CONSTRAINT chk_daily_menu_days_publication CHECK (
    (published_at IS NULL) = (published_by IS NULL)
    AND (published_at IS NULL
         OR (title_snapshot IS NOT NULL AND plate_price_snapshot > 0))
  )
);

-- 5. Ingredientes de hoy. Reemplazo completo por categoría dentro de una transacción con
--    la cabecera bloqueada (FOR UPDATE). label_key implementa la regla de duplicados.
--    Una ficha puede tener hasta 350 caracteres: no puede superar el total de su categoría.
CREATE TABLE public.daily_menu_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cafeteria_id uuid NOT NULL,
  business_date date NOT NULL,
  category_id uuid NOT NULL,
  label varchar(350) NOT NULL,
  label_key text GENERATED ALWAYS AS (lower(btrim(label))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_daily_menu_options_day FOREIGN KEY (cafeteria_id, business_date)
    REFERENCES public.daily_menu_days(cafeteria_id, business_date) ON DELETE RESTRICT,
  CONSTRAINT fk_daily_menu_options_category FOREIGN KEY (category_id, cafeteria_id)
    REFERENCES public.daily_menu_categories(id, cafeteria_id) ON DELETE RESTRICT,
  CONSTRAINT uq_daily_menu_options_label
    UNIQUE (cafeteria_id, business_date, category_id, label_key),
  CONSTRAINT chk_daily_menu_options_label CHECK (
    label = btrim(label)
    AND length(label) BETWEEN 1 AND 350
    AND position(',' IN label) = 0
  )
);

CREATE FUNCTION public.guard_daily_menu_option()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  category_kind text;
  used integer;
BEGIN
  SELECT c.kind INTO category_kind
    FROM public.daily_menu_categories c WHERE c.id = NEW.category_id;
  IF category_kind IS DISTINCT FROM 'SINGLE' THEN
    RAISE EXCEPTION 'Daily menu options belong to SINGLE categories only'
      USING ERRCODE = '23514', CONSTRAINT = 'daily_menu_option_category_kind';
  END IF;
  -- Suma de caracteres de las fichas de la categoría del día: máximo 350.
  SELECT coalesce(sum(length(o.label)), 0)::integer INTO used
    FROM public.daily_menu_options o
    WHERE o.cafeteria_id = NEW.cafeteria_id
      AND o.business_date = NEW.business_date
      AND o.category_id = NEW.category_id
      AND o.id IS DISTINCT FROM NEW.id;
  IF used + length(NEW.label) > 350 THEN
    RAISE EXCEPTION 'Daily menu category text exceeds 350 characters'
      USING ERRCODE = '23514', CONSTRAINT = 'daily_menu_option_text_budget';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_daily_menu_option() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_daily_menu_option_guard BEFORE INSERT OR UPDATE ON public.daily_menu_options
  FOR EACH ROW EXECUTE FUNCTION public.guard_daily_menu_option();

-- 6. Adiciones encendidas hoy. extra_price es el precio de ese día (copia al encender).
CREATE TABLE public.daily_menu_addition_availability (
  cafeteria_id uuid NOT NULL,
  business_date date NOT NULL,
  addition_id uuid NOT NULL,
  is_available boolean NOT NULL,
  extra_price numeric(12,2) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (addition_id, business_date),
  CONSTRAINT chk_daily_menu_addition_price CHECK (extra_price > 0),
  CONSTRAINT fk_daily_menu_addition_day FOREIGN KEY (cafeteria_id, business_date)
    REFERENCES public.daily_menu_days(cafeteria_id, business_date) ON DELETE RESTRICT,
  CONSTRAINT fk_daily_menu_addition_item FOREIGN KEY (addition_id, cafeteria_id)
    REFERENCES public.daily_menu_additions(id, cafeteria_id) ON DELETE RESTRICT
);

-- 7. Snapshot del pedido: cabecera (una por pedido con menú).
CREATE TABLE public.order_daily_menus (
  order_id uuid PRIMARY KEY,
  cafeteria_id uuid NOT NULL,
  business_date date NOT NULL,
  title_snapshot varchar(100) NOT NULL,
  plate_price numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_order_daily_menus_order_cafeteria UNIQUE (order_id, cafeteria_id),
  CONSTRAINT fk_order_daily_menu_order FOREIGN KEY (order_id, cafeteria_id)
    REFERENCES public.orders(id, cafeteria_id) ON DELETE RESTRICT,
  CONSTRAINT chk_order_daily_menu_price CHECK (plate_price > 0)
);

-- 8. Snapshot del pedido: una fila por elección (opción, «Ninguna» o adición).
--    category_id, source_option_id y source_addition_id no tienen FK a propósito:
--    son trazabilidad y no deben impedir borrar ingredientes de hoy.
CREATE TABLE public.order_daily_menu_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  cafeteria_id uuid NOT NULL,
  line_kind text NOT NULL,
  category_id uuid NOT NULL,
  category_label varchar(60) NOT NULL,
  option_label varchar(350),
  extra_price numeric(12,2),
  source_option_id uuid,
  source_addition_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_choice_order_menu FOREIGN KEY (order_id, cafeteria_id)
    REFERENCES public.order_daily_menus(order_id, cafeteria_id) ON DELETE RESTRICT,
  CONSTRAINT chk_choice_shape CHECK (
    (line_kind = 'OPTION' AND option_label IS NOT NULL AND extra_price IS NULL
       AND source_option_id IS NOT NULL AND source_addition_id IS NULL)
    OR (line_kind = 'NONE' AND option_label IS NULL AND extra_price IS NULL
       AND source_option_id IS NULL AND source_addition_id IS NULL)
    OR (line_kind = 'ADDITION' AND option_label IS NOT NULL AND extra_price > 0
       AND source_addition_id IS NOT NULL AND source_option_id IS NULL)
  )
);
CREATE UNIQUE INDEX uq_choice_one_per_category
  ON public.order_daily_menu_choices(order_id, category_id)
  WHERE line_kind IN ('OPTION', 'NONE');
CREATE UNIQUE INDEX uq_choice_addition_once
  ON public.order_daily_menu_choices(order_id, source_addition_id)
  WHERE line_kind = 'ADDITION';

-- 9. Inmutabilidad de lo copiado (mismo criterio que sync_order_cancellation_source, 021).
CREATE FUNCTION public.forbid_daily_menu_snapshot_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Daily menu order snapshots are immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'order_daily_menu_immutable';
END;
$$;
REVOKE ALL ON FUNCTION public.forbid_daily_menu_snapshot_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_order_daily_menus_immutable
  BEFORE UPDATE OR DELETE ON public.order_daily_menus
  FOR EACH ROW EXECUTE FUNCTION public.forbid_daily_menu_snapshot_change();
CREATE TRIGGER trg_order_daily_menu_choices_immutable
  BEFORE UPDATE OR DELETE ON public.order_daily_menu_choices
  FOR EACH ROW EXECUTE FUNCTION public.forbid_daily_menu_snapshot_change();

-- 10. Cierre: RLS sin políticas y ningún privilegio para el navegador (patrón de la 013).
ALTER TABLE public.daily_menu_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menu_additions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menu_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menu_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_menu_addition_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_daily_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_daily_menu_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE
  public.daily_menu_settings, public.daily_menu_categories, public.daily_menu_additions,
  public.daily_menu_days, public.daily_menu_options, public.daily_menu_addition_availability,
  public.order_daily_menus, public.order_daily_menu_choices
  FROM PUBLIC, anon, authenticated;

COMMIT;

-- Reverso (orden inverso; solo en base temporal):
-- BEGIN;
-- DROP TABLE IF EXISTS public.order_daily_menu_choices, public.order_daily_menus,
--   public.daily_menu_addition_availability, public.daily_menu_options,
--   public.daily_menu_days, public.daily_menu_additions, public.daily_menu_categories,
--   public.daily_menu_settings;
-- DROP FUNCTION IF EXISTS public.forbid_daily_menu_snapshot_change();
-- DROP FUNCTION IF EXISTS public.guard_daily_menu_option();
-- COMMIT;
```

Notas sobre el borrador:

- Las categorías por defecto no se siembran en la migración. La aplicación las crea con
  `INSERT ... ON CONFLICT DO NOTHING` la primera vez que la cafetería abre su configuración.
  Mientras no haya panel admin, la plantilla fija la crea la siembra de staging.
- Los ingredientes del día son texto libre. Un catálogo reutilizable queda fuera de la demo.
- La regla «una por categoría» y «obligatoria» se valida en servicio bajo bloqueo. La base garantiza
  lo que puede garantizar sin leer otras tablas: un registro por categoría en un pedido, adiciones sin
  repetir, forma correcta de cada elección, límite de 350 por categoría e inmutabilidad.

### 2.6 Pruebas de la migración (base temporal, nunca el proyecto)

- RLS activa y sin privilegios para `anon` y `authenticated` en las ocho tablas.
- Disparador de opciones: rechaza una opción en una categoría `ADDITIONS`; rechaza que la suma de
  caracteres de una categoría pase de 350; acepta exactamente 350.
- Índices: dos categorías `ADDITIONS` en una cafetería fallan; dos elecciones `OPTION`/`NONE` de la
  misma categoría en un pedido fallan; la misma adición dos veces en un pedido falla.
- CHECK de forma: `OPTION` sin `source_option_id` falla; `ADDITION` con precio 0 falla; `NONE` con
  etiqueta falla.
- FKs compuestas: una opción de otra cafetería, o un día sin cabecera, falla.
- Inmutabilidad: `UPDATE` y `DELETE` sobre snapshots fallan con `order_daily_menu_immutable`.
- Regresión: `uq_orders_one_active_per_client`, 011 y 021 siguen en verde.

---

## 3. Backend

### 3.1 Activación y endpoints

**Variable `MENU_DINAMICO_ENABLED`** (servidor, por defecto `false`). Propiedad
`menu.dinamico.enabled=${MENU_DINAMICO_ENABLED:false}`. Con `false`:

- Las lecturas y escrituras del menú responden 404 `DAILY_MENU_DISABLED`.
- Un pedido con `dailyMenu` responde 409 `DAILY_MENU_DISABLED`; el pedido sin menú funciona como hoy.
- El BFF web lee la misma variable en servidor (sin `NEXT_PUBLIC_`) y oculta el letrero, el módulo y
  el editor. Así el navegador nunca recibe la bandera y no hace falta una variable pública.
- Al implementar, la variable se añade a la lista de variables de `CLAUDE.md`.

Rutas nuevas bajo `/api/me` y `/api/worker` (y `/api/admin` en fase 9), con el estilo de
`ClientCatalogController`, `AvailabilityController` y `ClientOrderController`.

| Método y ruta | Rol | Qué hace | PR |
| ------------- | --- | -------- | -- |
| `GET /api/me/daily-menu?cafeteriaId=` | CLIENT | Menú publicado y completo de hoy, solo opciones disponibles | PR 2 |
| `GET /api/me/menu` (ampliar) | CLIENT | Añade `dailyMenu: { available }` para el letrero | PR 2 |
| `POST /api/me/orders` (ampliar) | CLIENT | Acepta `dailyMenu` opcional en el cuerpo | PR 4 |
| `GET /api/worker/daily-menu/today` | WORKER | Estado del día: categorías, opciones, adiciones, publicado, completo, versión | PR 3 |
| `PUT /api/worker/daily-menu/today/categories/{categoryId}/options` | WORKER | Reemplaza las opciones de una categoría `SINGLE` | PR 3 |
| `PUT /api/worker/daily-menu/today/additions/{additionId}` | WORKER | Enciende o apaga una adición; copia su precio | PR 3 |
| `POST /api/worker/daily-menu/today/copy-yesterday` | WORKER | Copia las opciones de ayer solo a categorías vacías hoy | PR 3 |
| `POST /api/worker/daily-menu/today/publish` | WORKER | Publica si está completo; congela título y precio | PR 3 |
| `POST /api/worker/daily-menu/today/unpublish` | WORKER | Oculta el menú para pedidos nuevos; los pedidos en curso no cambian | PR 3 |
| `GET/PUT /api/admin/daily-menu/...` | ADMIN | Plato, categorías y adiciones | PR 9 (después de la demo) |

Todas las escrituras del worker llevan `expectedVersion`. El servicio bloquea la cabecera del día con
`FOR UPDATE`, compara la versión y la incrementa. Si no coincide, responde 409
`DAILY_MENU_VERSION_CONFLICT` y el BFF resincroniza con un GET.

### 3.2 Contratos JSON

**Cliente — `GET /api/me/daily-menu?cafeteriaId=`** (200; 404 `DAILY_MENU_NOT_PUBLISHED` si no está
publicado o no está completo)

```json
{
  "cafeteria": { "id": "uuid", "name": "Cafetería Central", "open": true },
  "businessDate": "2026-11-18",
  "title": "Almuerzo del día",
  "price": 9500.0,
  "categories": [
    { "id": "uuid", "label": "Proteína", "kind": "SINGLE", "canSkip": false,
      "options": [{ "id": "uuid", "label": "Pollo a la plancha" }] },
    { "id": "uuid", "label": "Bebida", "kind": "SINGLE", "canSkip": true, "options": [] },
    { "id": "uuid", "label": "Adiciones", "kind": "ADDITIONS", "canSkip": true,
      "additions": [{ "id": "uuid", "name": "Huevo frito", "extraPrice": 2000.0 }] }
  ]
}
```

- `options: []` con `canSkip: true` significa que el cliente solo ve «Ninguna».
- Las categorías `ADDITIONS` sin adiciones encendidas se omiten. Una categoría `SINGLE` obligatoria
  nunca llega vacía, porque el menú no se puede publicar así.

**Cliente — `POST /api/me/orders`** (cuerpo ampliado; los demás campos no cambian)

```json
{
  "cafeteriaId": "uuid",
  "items": [{ "productId": "uuid", "quantity": 2 }],
  "dailyMenu": {
    "businessDate": "2026-11-18",
    "choices": [
      { "categoryId": "uuid", "optionId": "uuid" },
      { "categoryId": "uuid", "skip": true }
    ],
    "additionIds": ["uuid"]
  },
  "note": "sin cebolla",
  "requestedPickupAt": null
}
```

- `dailyMenu` es opcional. Sin él, el pedido se comporta como hoy.
- `skip: true` y `optionId` son excluyentes. Nunca se envía un precio ni un total.
- `ClientOrderRequests` lee solo estos campos. `Normalized.hash()` incluye `dailyMenu`: repetir la
  clave de idempotencia con otro menú responde `IDEMPOTENCY_KEY_CONFLICT`.

**Worker — `GET /api/worker/daily-menu/today`**

```json
{
  "businessDate": "2026-11-18",
  "version": 7,
  "published": false,
  "complete": false,
  "missingCategories": ["Principio"],
  "priceSet": true,
  "title": "Almuerzo del día",
  "price": 9500.0,
  "categories": [
    { "id": "uuid", "label": "Principio", "kind": "SINGLE", "canSkip": false,
      "options": [{ "id": "uuid", "label": "Arroz" }], "textUsed": 4 }
  ],
  "additions": [
    { "id": "uuid", "name": "Huevo frito", "extraPrice": 2000.0, "available": true }
  ]
}
```

**Worker — `PUT .../categories/{categoryId}/options`**

```json
{ "expectedVersion": 7, "options": ["Arroz", "Lentejas"] }
```

El servidor normaliza cada texto, rechaza duplicados, comas y excesos (sección 2.2), y responde con
el estado nuevo del día y `version: 8`.

### 3.3 Validaciones del servidor

- **Escritura de opciones:** cafetería del worker desde `cafeteria_users`; la categoría existe,
  pertenece a la cafetería, está activa y es `SINGLE`; máximo 20 opciones; cada texto 1–350 tras
  normalizar; sin comas; sin duplicados por `label_key`; suma ≤ 350; versión esperada.
- **Publicar:** precio fijo presente; cada categoría `SINGLE` activa no saltable tiene al menos una
  opción hoy; si falta algo responde 409 `DAILY_MENU_INCOMPLETE` con `missingCategories`. Sin precio,
  409 `DAILY_MENU_PRICE_NOT_SET`.
- **Adición:** existe, activa en el catálogo, y el precio es > 0 al encenderla.
- **Copiar ayer:** solo rellena categorías que hoy no tienen opciones; devuelve cuáles omitió. No
  copia el encendido de adiciones.
- **Pedido:**
  - `businessDate` igual al día de negocio de Spring; si no, 409 `DAILY_MENU_DATE_CHANGED`.
  - Cafetería abierta y visible (reglas actuales de 022).
  - Día publicado y completo; si no, 409 `DAILY_MENU_NOT_PUBLISHED`.
  - Una elección por cada categoría `SINGLE` activa: opción existente hoy o «Ninguna» si `canSkip`;
    si no, 400 `DAILY_MENU_SELECTION_INVALID`.
  - Adiciones sin repetir, encendidas hoy; si no, 409 `DAILY_MENU_ADDITION_UNAVAILABLE`.
  - Como máximo **un** plato por pedido (400 si llega más de uno). Cuenta como 1 unidad del límite de 15.

### 3.4 Total calculado en el servidor

```
total = Σ items.subtotal                                  (productos, como hoy)
      + daily_menu_days.plate_price_snapshot              (precio del plato publicado hoy)
      + Σ daily_menu_addition_availability.extra_price    (adiciones elegidas hoy)
```

- Orden de bloqueo (extiende el de §11 de `decisiones.md`): cafetería → productos → cabecera del día
  con `FOR SHARE` → opciones y disponibilidad de hoy. El worker bloquea la cabecera con `FOR UPDATE`,
  así un pedido nunca ve un menú a medio publicar.
- La transacción `@Transactional(timeout = 15)` y la idempotencia actual siguen igual.
- Las filas de `order_daily_menus` y `order_daily_menu_choices` se insertan en la misma transacción
  que `orders` y `order_items`.

### 3.5 Respuesta del pedido

`OrderResponse` añade `dailyMenu`, que es `null` si el pedido no tiene menú:

```json
"dailyMenu": {
  "title": "Almuerzo del día",
  "price": 9500.0,
  "choices": [
    { "category": "Proteína", "kind": "OPTION", "label": "Pollo a la plancha", "extraPrice": null },
    { "category": "Bebida", "kind": "NONE", "label": null, "extraPrice": null },
    { "category": "Adiciones", "kind": "ADDITION", "label": "Huevo frito", "extraPrice": 2000.0 }
  ]
}
```

### 3.6 Códigos de error (`MÓDULO_MOTIVO`)

Cada código necesita texto en `features/shared/messages.ts`; `tests/messages-catalog.test.mjs` falla
si falta.

| Código | HTTP | Cuándo |
| ------ | ---- | ------ |
| `DAILY_MENU_DISABLED` | 404 / 409 | `MENU_DINAMICO_ENABLED=false` |
| `DAILY_MENU_NOT_PUBLISHED` | 404 / 409 | No publicado, incompleto o cafetería sin menú |
| `DAILY_MENU_INCOMPLETE` | 409 | Publicar con una categoría obligatoria vacía |
| `DAILY_MENU_PRICE_NOT_SET` | 409 | Publicar sin precio fijo |
| `DAILY_MENU_VERSION_CONFLICT` | 409 | `expectedVersion` distinto |
| `DAILY_MENU_OPTION_INVALID` | 400 | Vacía, más de 350, con coma o más de 20 opciones |
| `DAILY_MENU_OPTION_DUPLICATED` | 400 | Repetida sin distinguir mayúsculas |
| `DAILY_MENU_TEXT_TOO_LONG` | 400 | Suma de la categoría > 350 |
| `DAILY_MENU_CATEGORY_NOT_FOUND` | 404 | Categoría inexistente, ajena o inactiva |
| `DAILY_MENU_SELECTION_INVALID` | 400 | Falta elección, opción ajena o «Ninguna» no permitida |
| `DAILY_MENU_ADDITION_UNAVAILABLE` | 409 | Adición apagada o inexistente hoy |
| `DAILY_MENU_DATE_CHANGED` | 409 | El día de negocio cambió entre la vista y el envío |

### 3.7 Pruebas (backend)

Nombres según convención: `*Test`, `*AuthorizationTest`, `*PostgresTest`.

- **Unitarias (`DailyMenuRulesTest`):** normalización (espacios, mayúsculas, comas), duplicados,
  límite de 350 con exactamente 350 y con 351, máximo de 20 opciones, regla «una por categoría»,
  «Ninguna» solo si `canSkip`, adiciones sin repetir, total con redondeo a 2 decimales, bandera
  apagada.
- **Servicio (`DailyMenuServiceTest`):** publicar incompleto, republicar, copiar ayer sin pisar,
  conflicto de versión, pedido con fecha cambiada, pedido con adición apagada.
- **Autorización (`DailyMenuAuthorizationTest`):** worker de otra cafetería no lee ni escribe;
  cliente no escribe en worker ni admin; cafetería oculta no sirve menú (regla 022).
- **Postgres (`DailyMenuPostgresTest`, clúster temporal local):** sección 2.6 y una prueba de
  concurrencia: dos escrituras de opciones con la misma versión; una gana y la otra recibe 409.
- **Pedido con menú (`ClientOrderDailyMenuPostgresTest`):** el total coincide con
  `items + precio + adiciones`; el snapshot no cambia cuando el worker borra la opción después;
  repetición idempotente devuelve el mismo pedido.

Comandos (desde `unifood-backend/`):

```sh
./mvnw -o test "-Dtest=!*PostgresTest"
./mvnw -o spotless:check
./mvnw -o test -Dtest=DailyMenuPostgresTest        # clúster temporal local
./mvnw -o test -Dtest=ClientOrderDailyMenuPostgresTest
```

---

## 4. BFF y pantallas

### 4.1 BFF (`unifood-web`)

Patrón de `features/availability/server/forward.ts` y de las rutas del worker: sesión verificada,
rol exclusivo, `sameOrigin` en cada mutación, validación estricta de cuerpo y tipos, `fetch` con
`cache: "no-store"`, `redirect: "error"` y timeout. Sin errores crudos: los códigos se traducen con
`messages.ts`. Solo se reenvían campos publicados.

- Worker: `app/api/worker/daily-menu/today/...` (GET y los PUT/POST de la sección 3.1).
- Cliente: lectura con `features/client/server/menu.ts` ampliado o una ruta hermana; el pedido se
  envía con `features/client/server/orderForward.ts`, que solo añade `dailyMenu` al cuerpo.
- Cafetería, actividad administrativa, día y bandera se resuelven en servidor.

### 4.2 Estructura de archivos

```
features/daily-menu/
  api.ts  contracts.ts  errors.ts  state.ts  types.ts  presentation.ts
  useDailyMenu.ts               (worker: lectura y escritura con cola de cambios)
  useClientDailyMenu.ts         (cliente: lectura)
  server/forward.ts
  components/
    DailyMenuEditor.tsx         (worker, dentro de Disponibilidad)
    DailyMenuChips.tsx          (fichas: radio para SINGLE, toggle para adiciones)
    DailyMenuSummary.tsx        (elección en el pedido: worker y cliente)
    DailyMenuLetrero.tsx        (letrero de Inicio)
    DailyMenuModule.tsx         (/cuenta/menu-del-dia)
```

`features/availability/components/AvailabilityPanel.tsx` monta `DailyMenuEditor` debajo de las
categorías de catálogo. No se toca `components/worker/`.

### 4.3 Worker: editor en Disponibilidad

- **Por cada categoría `SINGLE`:** título, un recuadro con las fichas creadas y un campo de texto.
  Enter o coma crea una ficha; los espacios de los extremos se quitan.
- **Límite de 350:** si la suma de fichas más el texto pendiente pasa de 350, el recuadro se pone
  rojo con el aviso «Superaste el máximo de 350 caracteres». No se crea la ficha. **Publicar queda
  deshabilitado** mientras algún recuadro esté en rojo. Sin contador visible.
- **Sin micrófono.**
- **Duplicado:** no crea ficha y avisa junto al campo, con foco en el campo.
- **Límite de 20 opciones:** al llegar a 20 no crea más fichas y avisa en el campo.
- **Guardado:** cada ficha creada o borrada hace un `PUT` de esa categoría, con el overlay optimista de
  `features/availability/README.md`. Las escrituras se encolan para no pisar `expectedVersion`.
- **Adiciones:** interruptores (`role="switch"`) con el nombre y «+ $2.000». Encender guarda el precio de hoy.
- **«Copiar el de ayer»:** en la cabecera del editor. Rellena solo categorías vacías; dice cuáles omitió.
  No copia adiciones.
- **Publicar / Despublicar:** Publicar muestra los motivos si falta algo («Falta una opción en
  Principio»). Sin precio: «Falta el precio del plato» y publicar deshabilitado (P14 resuelta).
- **Pedido con menú:** la elección aparece en la tarjeta del worker (sección 4.7).
- **Errores:** `VERSION_CONFLICT` vuelve a leer el día; «Sin conexión. Reintentando…» conserva el
  último estado confirmado.

### 4.4 Cliente: letrero en Inicio

- **Dónde:** encima del carrusel, en el mismo hueco que el `ClosedBanner` cuando la cafetería está
  cerrada. Son mutuamente excluyentes: el letrero exige cafetería abierta.
- **Cuándo se muestra:** `dailyMenu.available === true` (publicado, completo, abierta y bandera
  encendida). Llega con el refresco de 30 s que ya tiene `useCafeteriaMenu`.
- **Contenido:** tarjeta de ancho completo con «Menú del día» y una flecha; enlace a
  `/cuenta/menu-del-dia?cafeteria=…`. Sin precio.
- **Si no está disponible:** no se renderiza nada; el carrusel ocupa el hueco como hoy.

### 4.5 Cliente: módulo `/cuenta/menu-del-dia`

- **Encabezado:** título del plato y **precio fijo, mostrado una sola vez** (P9). Debajo, el texto de
  cafetería abierta o el `CLOSED_NOTICE` existente.
- **Categorías:** en el orden de la plantilla. Las `ADDITIONS` sin adiciones se omiten; las `SINGLE`
  saltables con solo «Ninguna» muestran esa ficha. Nunca aparece «no hay».
- **Fichas `SINGLE`:** `role="radiogroup"` con `role="radio"` y `aria-checked`. Elegida: fondo
  `#0B5FFF` y texto blanco (contraste 5,1:1, cumple AA para texto normal). Sin elegir: borde gris y
  texto oscuro. Flechas para moverse, foco visible, mínimo 44 px de alto.
- **Fichas `ADDITIONS`:** `role="checkbox"` con `aria-checked`, mismo estilo. Muestran el precio extra
  dentro de la ficha: «Huevo frito · + $2.000».
- **Botón único «Agregar al carrito»**, deshabilitado mientras falte algo. El motivo va en texto visible
  y en `aria-live`: «Falta elegir: Principio».
- **Plato ya en el carrito:** el módulo abre con sus elecciones cargadas y el botón dice «Actualizar carrito» (P8).
- **Cafetería cerrada:** el módulo se ve con `CLOSED_NOTICE` y el botón muestra «Cerrada».
- **Sin menú publicado:** «El menú de hoy aún no está listo» (texto nuevo en `messages.ts`).

### 4.6 Carrito, checkout y `CartLineItem`

- **Tipo de línea:** `CartLine` pasa a ser una unión. Las líneas de producto se quedan igual; la nueva
  `MenuLine` es `{ kind: "menu", businessDate, choices: {categoryId: optionId | "NONE"}, additionIds }`.
  Las líneas antiguas no tienen `kind` y se tratan como producto.
- **Clave de almacenamiento:** se conserva `unifood.client.cart.v2`. La restauración valida la forma
  de la línea nueva y descarta lo que no entienda.
- **Un plato por carrito** (P4).
- **`validateCart`:** para la línea de menú comprueba que el menú publicado sigue igual. Si algo
  cambió, la línea queda marcada («Ya no está disponible» o «El menú cambió: vuelve a elegir») y
  bloquea el pago hasta que el cliente la corrija. Nunca hay sustitución silenciosa.
- **`CartLineItem`:** título, elecciones (incluido «Ninguna»), adiciones con su precio e importe.
- **Checkout:** el resumen suma plato y adiciones con los precios publicados; el servidor recalcula.
- **Límites:** el plato cuenta como una unidad (P5); las adiciones no cuentan.

### 4.7 Ver la elección en el pedido

- **Worker:** `DailyMenuSummary` dentro de la tarjeta y del detalle del pedido:

  ```
  Almuerzo del día · $9.500
  Proteína: Pollo a la plancha
  Principio: Arroz
  Bebida: Ninguna
  Adiciones: Huevo frito (+$2.000)
  ```

  «Ninguna» aparece siempre que el cliente la eligió.
- **Cliente:** el mismo bloque en «Mi pedido» y en el historial, de solo lectura.
- `HistoryOrderCard` usa el mismo componente.

---

## 5. Casos límite

| Caso | Comportamiento | Dónde se valida |
| ---- | -------------- | --------------- |
| **Opción agotada después de que el cliente la escogió (pedido ya creado)** | El pedido no cambia. El worker lo ve y, si no puede cumplirlo, usa el rechazo con motivo (B18) | Snapshot (2.3) |
| **Opción agotada con el carrito sin enviar** | Al enviar, `DAILY_MENU_SELECTION_INVALID`. La línea queda marcada y el cliente vuelve a elegir | `validateCart` y servicio |
| **Categoría obligatoria sin opciones hoy** | No se publica (`DAILY_MENU_INCOMPLETE`). Si se vacía después, el menú queda incompleto: el letrero se oculta y el worker ve qué falta | Publicar y lectura calculada |
| **Categoría saltable sin opciones hoy** | Solo aparece «Ninguna» | Lectura del cliente |
| **Cafetería cerrada** | Letrero oculto. El módulo se ve sin poder añadir. El pedido responde `CAFETERIA_CLOSED` | Lectura y 022 |
| **Cafetería oculta por SUPER_ADMIN** | Sin menú; el pedido responde `CAFETERIA_NOT_SUBSCRIBED` como hoy | 022 |
| **Cambio de menú con pedidos activos** | Los pedidos en curso conservan su copia. Publicar o despublicar solo afecta a pedidos nuevos | Snapshot y `unpublish` |
| **Cambio de precio del plato con pedidos activos** | El pedido conserva su precio; el nuevo aplica en la siguiente publicación | `daily_menu_days` |
| **Adición apagada después de que el cliente la eligió** | Si se apaga antes de enviar: `DAILY_MENU_ADDITION_UNAVAILABLE`. Si ya está enviado, no cambia | Servicio y snapshot |
| **Adición cuyo precio cambió entre la vista y el envío** | No cambia: el precio de hoy es el copiado al encender | `daily_menu_addition_availability` |
| **Opciones repetidas** (`Arroz` y ` arroz `) | `DAILY_MENU_OPTION_DUPLICATED` en servidor; en el editor no crea ficha y avisa | Normalización y `label_key` |
| **Opciones con comas** (`Arroz, lentejas`) | En el editor, la coma separa en dos fichas. Una coma por API responde `DAILY_MENU_OPTION_INVALID` | Editor y servidor |
| **Texto de más de 350 por categoría** | El editor pone el recuadro en rojo y bloquea «Publicar». El servidor responde `DAILY_MENU_TEXT_TOO_LONG` y no trunca | Editor, servicio y disparador |
| **Más de 20 opciones** | No se crea la ficha número 21; `DAILY_MENU_OPTION_INVALID` | Editor y servidor |
| **Dos workers editan a la vez** | Uno gana; el otro recibe `DAILY_MENU_VERSION_CONFLICT` y vuelve a leer | `expectedVersion` y `FOR UPDATE` |
| **Cambio de día con el cliente en el módulo** | El pedido responde `DAILY_MENU_DATE_CHANGED`; el cliente recarga | Servidor (3.3) |
| **Pedido repetido por red (misma clave)** | Misma respuesta; si el menú cambió en el cuerpo, `IDEMPOTENCY_KEY_CONFLICT` | `Normalized.hash()` |
| **Más de un plato por pedido** | Rechazado en el carrito y en el servidor | Carrito y servicio |
| **Menú de ayer** | Nunca se muestra: todas las consultas filtran por `business_date` | Consultas |
| **Bandera apagada** | Endpoints 404 `DAILY_MENU_DISABLED`; web sin letrero ni módulo ni editor | Servidor y BFF |
| **Pedido de ayer activo (no es del menú)** | Ver sección 8 | Cierre diario |

---

## 6. Plan de implementación

Una sola sesión de Claude Code a la vez: los PR van en serie. El orden está pensado para que **cada
paso deje la app en un estado usable** y para que, si hay que recortar, se sepa qué se pierde.

| # | PR | Contenido | Esfuerzo | Sin él, qué no funciona |
| - | -- | --------- | -------- | ----------------------- |
| 1 | `menu-dia-db` | Migración 030, pruebas de base, siembra de staging con `SET unifood.seed_target = 'staging'`, bandera | 2 d | Nada del menú |
| 2 | `menu-dia-lectura` | Backend: `GET /api/me/daily-menu`, `dailyMenu` en `/api/me/menu`, pruebas | 1 d | El cliente no ve el menú |
| 5 | `menu-dia-letrero-modulo` | Web: BFF de lectura, letrero en Inicio, módulo en solo lectura (fichas, sin carrito) | 2,5 d | El cliente no ve el menú |
| 3 | `menu-dia-worker-api` | Backend: escrituras del worker, publicar, copiar ayer, autorización y concurrencia | 2,5 d | El worker no puede publicar |
| 7 | `menu-dia-editor` | Web: `DailyMenuEditor` en Disponibilidad, BFF del worker, publicar | 3 d | El worker publica solo por API o SQL |
| 4 | `menu-dia-pedido` | Backend: validación del pedido, total, snapshots, `OrderResponse.dailyMenu` | 3 d | El cliente no puede pedir el menú |
| 6 | `menu-dia-carrito` | Web: `MenuLine`, `validateCart`, `CartLineItem`, checkout, `orderForward` | 2 d | El cliente no puede pedir el menú |
| 8 | `menu-dia-ver-pedido` | Web: `DailyMenuSummary` en la tarjeta del worker y en «Mi pedido» | 1 d | El worker no ve la elección |
| 9 | `menu-dia-admin` | Panel admin: plato, categorías, adiciones | 3 d | Después de la demo |

El orden de ejecución es 1 → 2 → 5 → 3 → 7 → 4 → 6 → 8. El PR 5 va antes que el 3 para que el
cliente vea el menú cuanto antes y la lectura se pruebe sin esperar al worker.

**Qué primero para cada objetivo:**
- **Que el worker publique:** PR 1, 3 y 7 (≈ 7,5 d).
- **Que el cliente pida:** PR 1, 2, 4, 5 y 6 (≈ 10,5 d). Sin PR 8, el pedido se guarda pero el worker no
  ve la elección en su tarjeta, así que el PR 8 no es opcional para operar; sí lo es para la demo.
- **Mínimo útil para la demo:** PR 1, 2, 5 y 3 (≈ 8 d). El cliente ve el menú y el worker puede publicar
  por API o SQL.

**Recorte si hace falta:** primero se quita el «Copiar el de ayer» (dentro del PR 7); después, los
interruptores de adiciones; después, el PR 8 a solo la tarjeta del worker. No se recortan la regla
«una por categoría», el snapshot ni la validación de servidor, porque son las que protegen el cobro.

**Criterio por PR:** `npm run lint`, `npx tsc --noEmit --incremental false`,
`npx prettier --check <archivos>` y `npm test` (web); `./mvnw -o test "-Dtest=!*PostgresTest"`,
`./mvnw -o spotless:check` y las pruebas Postgres del área (backend). Las suites completas se
ejecutan al cerrar el módulo, no en cada PR.

---

## 7. Cronograma (una sola sesión a la vez)

Fechas en días de calendario, sin paralelismo. Cada día cuenta como un día de trabajo completo;
no hay margen para revisiones ni para errores de pruebas.

| Día | Trabajo | Acumulado | Estado |
| --- | ------- | --------- | ------ |
| Mié 18 | Revisión 2 de la propuesta | — | Hoy |
| Jue 19 – vie 20 | PR 1: migración, pruebas, siembra | 2 d | Cabe |
| Sáb 21 | PR 2: lectura del backend | 3 d | Cabe |
| Dom 22 – lun 23 | PR 5: letrero y módulo de solo lectura | 5,5 d | Cabe |
| Mar 24 – mié 25 | PR 3: escrituras del worker (2,5 d) | 8 d | **No cabe del todo**: el último medio día cae el jueves 26 |

**Respuesta honesta:** con una sola sesión, **no cabe el módulo completo el 25**. Lo que cabe es el
mínimo de la demo con un medio día de retraso en PR 3. El cliente ve el menú; el worker publica
por API o SQL, no por pantalla; **nadie puede pedir el menú**.

**Qué quedaría fuera, en el orden en que se perdería:**

1. PR 4 y PR 6: el pedido con menú y el carrito. Sin ellos la demo no muestra el flujo de compra.
2. PR 7: el editor del worker. Publicar sigue funcionando por API o SQL.
3. PR 8: la elección en el pedido.
4. PR 9: admin (ya estaba después de la demo).

**Si el 25 es innegociable para el flujo completo:** la fecha realista del módulo completo con una
sesión es **~5 de diciembre** (17 días a partir del 19). Eso deja el 28 de noviembre con la demo sin
pedidos, o con el menú en solo lectura. Hay que elegir antes de empezar (P1).

---

## 8. Pedidos de días anteriores visibles en el worker

**Síntoma:** el worker sigue viendo pedidos del día anterior hasta 24 horas.

### 8.1 Causa probable

No es el menú del día ni su filtro por `business_date`. Son los **pedidos activos** (PENDING, PREPARING,
READY, CALLED) que nunca se cerraron. Hay tres piezas:

1. **El listado es intencionalmente amplio.** `OrderService.getOperationalOrders` llama a
   `findOperational`, que devuelve todos los activos de cualquier día y solo los entregados de hoy. Así
   lo exige `decisiones.md` §6: «Un pedido activo atascado de otro día nunca queda invisible».
2. **El cierre diario corre solo cuando el backend está levantado.** `DailyCloseScheduler` lo ejecuta al
   arrancar y luego cada `orders.daily-close.interval` (`PT1H` por defecto). El propio comentario del
   código dice que «en la demo el backend está apagado de noche». Si está apagado a medianoche, el
   cierre no se ejecuta hasta que vuelva a arrancar.
3. **El corte del cierre es el inicio del día de negocio** (`BusinessDate` en America/Bogota). Un pedido
   de ayer se cancela o se marca `NOT_COLLECTED` solo en la primera ejecución posterior a medianoche.

**Por qué puede llegar a 24 horas:** si el backend se apaga por la noche y se reinicia por la mañana,
el cierre corre al arrancar y el margen es de unas horas. Un margen de un día completo ocurre si el
backend no arrancó ese día o si una ejecución falló. Los fallos se registran como `WARN` con solo el
nombre de la excepción (`DailyCloseScheduler`), así que no se ven sin mirar los logs. **No puedo
confirmar cuál de los dos casos pasa en producción:** no tengo acceso a los logs ni a las variables de
despliegue (`DAILY_CLOSE_ENABLED`, `DAILY_CLOSE_INTERVAL`).

### 8.2 Qué arregla el filtro por `business_date` del menú

**Nada de esto.** El filtro del menú solo oculta el menú de ayer. Un pedido activo de ayer no tiene
`business_date` que filtrar: el listado no filtra activos por fecha, y debe seguir así. Si lo filtráramos,
el pedido seguiría activo en la base y el worker no lo vería; además, el índice
`uq_orders_one_active_per_client` (020) **impediría al cliente hacer un pedido nuevo** mientras ese
pedido siga activo. Ocultarlo empeora el problema.

### 8.3 Solución propuesta

En orden de prioridad, en un PR aparte (`jj/cierre-diario-medianoche`), fuera del freeze del menú:

1. **Confirmar la configuración de producción:** valores reales de `DAILY_CLOSE_ENABLED` y
   `DAILY_CLOSE_INTERVAL`, y si el backend se apaga de noche. Sin esto no se sabe qué caso ocurre.
2. **Ejecutar el cierre a las 00:00 de Bogotá sin depender del backend:** `pg_cron` con
   `scripts/supabase/close-stale-orders.sql` (ya existe con la misma regla), programado para la
   medianoche de America/Bogota. Ya estaba previsto usar `pg_cron` en `decisiones.md` §3. Requiere OK
   explícito porque toca Supabase remoto (CLAUDE.md: no tocar Supabase remoto sin mostrar el comando y
   recibir OK).
3. **Mantener el cierre en Spring** como respaldo, pero con un `WARN` que incluya el número de pedidos
   afectados, para verlo en los logs.
4. **Mostrar al worker un aviso** cuando haya activos de días anteriores («Hay N pedidos de ayer sin
   cerrar»), sin ocultarlos. Es un cambio de UI pequeño.

Ninguna de estas opciones cambia el listado: los pedidos siguen visibles hasta que se cierran.

---

## 9. Preguntas abiertas

Las resueltas en la revisión 2 ya no aparecen. Quedan estas:

**Q1. Cronograma y freeze (sección 7).** Con una sola sesión, el 25 cabe la demo mínima (el cliente ve
el menú y el worker publica por API o SQL), y no cabe el flujo de pedido. Opciones:
- **(a) Recomendada:** el 25 se cumple solo para el mínimo (PR 1, 2, 5 y 3). El pedido con menú (PR 4, 6,
  7, 8) queda para después de la demo.
- **(b)** Mover el freeze del módulo al **5 de diciembre** y demostrar el flujo completo ese día.
- **(c)** Demo del 28 con el menú sembrado en solo lectura y sin ningún pedido.

*Necesito tu elección porque cambia qué se muestra el 28.*

**Q2. Pedidos de ayer (sección 8).** ¿Autorizas revisar la configuración de producción (`DAILY_CLOSE_ENABLED`,
`DAILY_CLOSE_INTERVAL`) y, si hace falta, mover el cierre a `pg_cron` a medianoche? Para ver la
configuración necesito que me la confirmes tú; no la leo de ningún archivo `.env`.

**Q3. Pedidos atascados y el cliente.** Un pedido activo de ayer bloquea al cliente para hacer un pedido
nuevo (`uq_orders_one_active_per_client`). ¿Quieres que el cierre a medianoche (Q2) sea prioritario
por eso, aunque la demo no dependa de ello?

**Q4. Adiciones con precio distinto por día.** Propuesto: el precio se fija al encender la adición. Si el
admin cambia el precio a mitad de día, el cliente ve el precio que tenía al encenderse. ¿Confirmas?

**Q5. Plantilla fija hasta el panel admin.** Las categorías y las adiciones de ejemplo las pone la
siembra en staging. Si en una cafetería real hace falta otra plantilla antes de la fase 9, hay que
cargarla con SQL controlado. ¿Es aceptable para el piloto?
