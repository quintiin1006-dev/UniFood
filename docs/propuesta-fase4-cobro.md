# Propuesta Fase 4: visibilidad y modelo de cobro por cafetería

Estado: **borrador para aprobación del dueño**. Este documento no implementa nada.

- La migración 022 aparece abajo solo como texto. No está en `unifood-backend/supabase/migrations/`, así que ningún script ni prueba la recoge, y no se ha aplicado a ninguna base.
- Fecha: 2026-11-12.

## 1. Problema

Hoy `cafeterias.is_active` mezcla tres cosas:

1. **Visibilidad operativa.** Si la cafetería aparece al cliente y acepta pedidos nuevos (§5: contexto, menú y crear pedido).
2. **«Suscripción».** §5 la llama «ACTIVA/SUSCRITA», y el listado del super admin la expone como `subscribed`.
3. **Actividad administrativa de la 009.** Toda cafetería con `is_active = true` debe tener exactamente un ADMIN activo (`trg_*` de la 009). Sustituir un ADMIN exige hacerlo de forma atómica o desactivar la cafetería (`auth.md`).

Decisión nueva del dueño: la suscripción **no es obligatoria**. Una cafetería puede no pagar nada, pagar una suscripción o pagar una comisión fija por pedido (por ejemplo $1.000 COP). En el sistema no se cobra nada.

## 2. Decisión propuesta

| Concepto                  | Dónde vive                                                     | Quién lo cambia  |
| ------------------------- | -------------------------------------------------------------- | ---------------- |
| (a) Visibilidad operativa | `cafeterias.is_active` (se queda, con su nombre y sus valores) | Solo SUPER_ADMIN |
| (b) Modelo de cobro       | Tabla nueva `cafeteria_billing_settings`                       | Solo SUPER_ADMIN |
| Auditoría de (a) y (b)    | Tabla nueva `cafeteria_settings_audit`, escrita por trigger    | Nadie la edita   |

**Por qué (a) sigue en `is_active`:**

- Ya es exactamente la visibilidad que aplican el contexto, el menú y la creación de pedidos (`client/context-cafeterias.sql`, `client/menu-cafeteria.sql`, `client-orders/lock-cafeteria.sql`).
- La 009 ata a esa columna su invariante de ADMIN, y cambiarla obligaría a rehacer 007, 009 y sus pruebas.
- Renombrarla rompería SQL aplicado y migraciones que no se modifican.
- Solo cambia su significado documentado: «visible y operativa», no «suscrita».

**Qué pasa con el valor actual de `is_active`: nada.**

- Cada cafetería conserva su visibilidad actual.
- Ninguna cafetería se oculta ni se publica al aplicar la 022.

**Modelo de cobro inicial: `NONE` (sin cobro) para todas, también las visibles.**

- Hoy no existe ningún dato de cobro real. Deducir «suscripción» de `is_active = true` sería inventar datos.
- El super admin fija después el modelo real de cada una. Cada cambio queda auditado.
- Alternativa, si el dueño la prefiere: sembrar `SUBSCRIPTION` en las cafeterías visibles. Es una línea en la 022 (ver §8, pregunta 1).

**Desactivar con pedidos en curso: se mantiene lo decidido.**

- Los pedidos activos se terminan de atender. Las transiciones del worker y el cierre diario no leen `is_active`.
- Solo se bloquean los pedidos nuevos, con 403 `CAFETERIA_NOT_SUBSCRIBED`.
- El código de error se conserva por compatibilidad. Su mensaje fijo pasa a decir «Esta cafetería no está disponible en este momento.».

## 3. Tablas y columnas (migración 022)

### `public.cafeteria_billing_settings` (una fila por cafetería)

| Columna             | Tipo                                                | Regla                                                                            |
| ------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `cafeteria_id`      | `uuid` PK, FK → `cafeterias(id)` ON DELETE RESTRICT | Una configuración por cafetería                                                  |
| `billing_model`     | `text NOT NULL DEFAULT 'NONE'`                      | CHECK en `('NONE','SUBSCRIPTION','PER_ORDER_FEE')`                               |
| `per_order_fee_cop` | `integer NULL`                                      | CHECK: no nula **solo** con `PER_ORDER_FEE`, entre 1 y 1.000.000 (pesos enteros) |
| `version`           | `integer NOT NULL DEFAULT 0`                        | Concurrencia optimista; sube con cada cambio                                     |
| `updated_at`        | `timestamptz NOT NULL`                              | Lo escribe Spring con su `TimeProvider`                                          |
| `updated_by`        | `uuid NULL`, FK → `users(id)`                       | Super admin; NULL solo en la siembra de la 022                                   |

- **Pesos enteros:** el COP no usa centavos en la práctica y así se evitan redondeos al calcular la comisión más adelante.
- **Pensada para crecer sin rehacer tablas:**
  - Cuando se calcule la comisión por pedido, se añadirá a `orders` un snapshot inmutable (`platform_fee_cop integer NULL` y `billing_model_snapshot text NULL`), copiado de esta tabla al crear el pedido, como `client_code` en la 021.
  - Esta tabla no cambia: sigue siendo la configuración vigente, y la auditoría guarda su historia.
  - Un modelo nuevo (por ejemplo un porcentaje) es un valor más del CHECK y una columna opcional.
- **Fila por cafetería:** la 022 inserta una fila `NONE` por cada cafetería existente. Un trigger crea la fila `NONE` de cada cafetería nueva, así que nunca falta.

### `public.cafeteria_settings_audit` (solo inserción)

| Columna        | Tipo                                                      | Regla                                                                         |
| -------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `id`           | `bigint GENERATED ALWAYS AS IDENTITY` PK                  |                                                                               |
| `cafeteria_id` | `uuid NOT NULL`, FK → `cafeterias(id)` ON DELETE RESTRICT |                                                                               |
| `setting`      | `text NOT NULL`                                           | CHECK en `('VISIBILITY','BILLING')`                                           |
| `old_value`    | `jsonb NOT NULL`                                          | Por ejemplo `{"visible": true}` o `{"model": "NONE", "perOrderFeeCop": null}` |
| `new_value`    | `jsonb NOT NULL`                                          | Igual                                                                         |
| `changed_by`   | `uuid NULL`, FK → `users(id)`                             | De `SET LOCAL unifood.actor_id`; NULL si fue SQL manual                       |
| `changed_at`   | `timestamptz NOT NULL DEFAULT now()`                      | Hora de la base: una auditoría no confía en el reloj de la aplicación         |
| `source`       | `text NOT NULL`                                           | `'API'` si llegó `unifood.actor_id`; `'SQL'` en otro caso                     |

**La escriben triggers, no Spring.**

- `AFTER UPDATE OF is_active ON cafeterias` y `AFTER INSERT OR UPDATE ON cafeteria_billing_settings` escriben la fila en la **misma transacción** que el cambio.
- Así queda auditado **todo** cambio, también el SQL manual de emergencia (§13, punto 3), con `source = 'SQL'` y `changed_by = NULL`.
- Spring hace `SET LOCAL unifood.actor_id = '<uuid del super admin>'` dentro de la transacción. Ese uuid sale del JWT verificado y de una lectura de la base.

**Inmutable.** Un trigger `BEFORE UPDATE OR DELETE` rechaza cualquier cambio con el error `cafeteria_settings_audit_immutable`, y `TRUNCATE` queda revocado.

## 4. Borrador de la migración 022 (no aplicada)

Formato de 018, 020, 021 y 023: BEGIN/COMMIT, REVOKE explícito y bloque `-- Reverse:` comentado. Al aprobarse, se guarda como `unifood-backend/supabase/migrations/022_cafeteria_visibility_billing.sql`.

- **Se aplica con el control de migraciones:** `scripts/supabase/apply-migrations.ps1 -AllowOutOfOrder 022`. La 023 ya está aplicada y el script exige permitir la 022 fuera de orden. El dueño corre `-PlanOnly` primero.
- **Pruebas antes:** se prueba en bases temporales locales (PGlite y PostgreSQL nativo) y luego en `unifood-staging`. Nunca se estrena en el proyecto real.

```sql
BEGIN;

-- Separates the two concepts mixed in cafeterias.is_active (docs/decisiones.md §5):
-- is_active stays the operational visibility (and the 009 ADMIN invariant), and the billing
-- model moves to its own table. Nothing is charged in the system. Every change of either is
-- audited by trigger in the same transaction, also when it is made with manual SQL.

CREATE TABLE IF NOT EXISTS public.cafeteria_billing_settings (
  cafeteria_id uuid PRIMARY KEY REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  billing_model text NOT NULL DEFAULT 'NONE',
  per_order_fee_cop integer,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_cafeteria_billing_model
    CHECK (billing_model IN ('NONE', 'SUBSCRIPTION', 'PER_ORDER_FEE')),
  CONSTRAINT chk_cafeteria_billing_fee
    CHECK ((billing_model = 'PER_ORDER_FEE') = (per_order_fee_cop IS NOT NULL)
           AND (per_order_fee_cop IS NULL OR per_order_fee_cop BETWEEN 1 AND 1000000)),
  CONSTRAINT chk_cafeteria_billing_version CHECK (version >= 0)
);

CREATE TABLE IF NOT EXISTS public.cafeteria_settings_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cafeteria_id uuid NOT NULL REFERENCES public.cafeterias(id) ON DELETE RESTRICT,
  setting text NOT NULL CHECK (setting IN ('VISIBILITY', 'BILLING')),
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('API', 'SQL'))
);

CREATE INDEX IF NOT EXISTS idx_cafeteria_settings_audit_cafeteria
  ON public.cafeteria_settings_audit (cafeteria_id, changed_at DESC, id DESC);

-- Every existing cafeteria starts without billing; its visibility (is_active) is untouched.
INSERT INTO public.cafeteria_billing_settings (cafeteria_id)
SELECT c.id FROM public.cafeterias c
ON CONFLICT (cafeteria_id) DO NOTHING;

-- Spring sets unifood.actor_id with SET LOCAL; manual SQL leaves it empty.
CREATE OR REPLACE FUNCTION public.cafeteria_settings_actor()
RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT NULLIF(current_setting('unifood.actor_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.audit_cafeteria_visibility()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    INSERT INTO public.cafeteria_settings_audit
      (cafeteria_id, setting, old_value, new_value, changed_by, source)
    VALUES (NEW.id, 'VISIBILITY',
            jsonb_build_object('visible', OLD.is_active),
            jsonb_build_object('visible', NEW.is_active),
            public.cafeteria_settings_actor(),
            CASE WHEN public.cafeteria_settings_actor() IS NULL THEN 'SQL' ELSE 'API' END);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.audit_cafeteria_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.billing_model IS NOT DISTINCT FROM OLD.billing_model
     AND NEW.per_order_fee_cop IS NOT DISTINCT FROM OLD.per_order_fee_cop THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.cafeteria_settings_audit
    (cafeteria_id, setting, old_value, new_value, changed_by, source)
  VALUES (NEW.cafeteria_id, 'BILLING',
          CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb
               ELSE jsonb_build_object('model', OLD.billing_model,
                                       'perOrderFeeCop', OLD.per_order_fee_cop) END,
          jsonb_build_object('model', NEW.billing_model,
                             'perOrderFeeCop', NEW.per_order_fee_cop),
          public.cafeteria_settings_actor(),
          CASE WHEN public.cafeteria_settings_actor() IS NULL THEN 'SQL' ELSE 'API' END);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.reject_cafeteria_settings_audit_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Cafeteria settings audit is append-only'
    USING ERRCODE = '23514', CONSTRAINT = 'cafeteria_settings_audit_immutable';
END $$;

-- A new cafeteria always gets its billing row (NONE), audited like any other change.
CREATE OR REPLACE FUNCTION public.create_cafeteria_billing_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.cafeteria_billing_settings (cafeteria_id) VALUES (NEW.id)
  ON CONFLICT (cafeteria_id) DO NOTHING;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_cafeterias_visibility_audit ON public.cafeterias;
CREATE TRIGGER trg_cafeterias_visibility_audit
  AFTER UPDATE OF is_active ON public.cafeterias
  FOR EACH ROW EXECUTE FUNCTION public.audit_cafeteria_visibility();

DROP TRIGGER IF EXISTS trg_cafeterias_billing_row ON public.cafeterias;
CREATE TRIGGER trg_cafeterias_billing_row
  AFTER INSERT ON public.cafeterias
  FOR EACH ROW EXECUTE FUNCTION public.create_cafeteria_billing_settings();

DROP TRIGGER IF EXISTS trg_cafeteria_billing_audit ON public.cafeteria_billing_settings;
CREATE TRIGGER trg_cafeteria_billing_audit
  AFTER INSERT OR UPDATE ON public.cafeteria_billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_cafeteria_billing();

DROP TRIGGER IF EXISTS trg_cafeteria_settings_audit_immutable ON public.cafeteria_settings_audit;
CREATE TRIGGER trg_cafeteria_settings_audit_immutable
  BEFORE UPDATE OR DELETE ON public.cafeteria_settings_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_cafeteria_settings_audit_change();

COMMENT ON COLUMN public.cafeterias.is_active IS
  'Operational visibility: visible to clients and accepting new orders (decisiones §5). '
  'Also the 009 administrative activity that requires exactly one active ADMIN.';
COMMENT ON TABLE public.cafeteria_billing_settings IS
  'Current billing model per cafeteria. Nothing is charged by the system.';
COMMENT ON TABLE public.cafeteria_settings_audit IS
  'Append-only audit of visibility and billing changes, written by trigger.';

-- Business tables stay closed to the browser: only Spring (service connection) reads them.
ALTER TABLE public.cafeteria_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cafeteria_settings_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cafeteria_billing_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cafeteria_settings_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cafeteria_settings_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_cafeteria_visibility() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_cafeteria_billing() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_cafeteria_settings_audit_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_cafeteria_billing_settings() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Reverse:
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_cafeteria_settings_audit_immutable ON public.cafeteria_settings_audit;
-- DROP TRIGGER IF EXISTS trg_cafeteria_billing_audit ON public.cafeteria_billing_settings;
-- DROP TRIGGER IF EXISTS trg_cafeterias_billing_row ON public.cafeterias;
-- DROP TRIGGER IF EXISTS trg_cafeterias_visibility_audit ON public.cafeterias;
-- DROP FUNCTION IF EXISTS public.create_cafeteria_billing_settings();
-- DROP FUNCTION IF EXISTS public.reject_cafeteria_settings_audit_change();
-- DROP FUNCTION IF EXISTS public.audit_cafeteria_billing();
-- DROP FUNCTION IF EXISTS public.audit_cafeteria_visibility();
-- DROP FUNCTION IF EXISTS public.cafeteria_settings_actor();
-- DROP TABLE IF EXISTS public.cafeteria_settings_audit;   -- deletes the audit history
-- DROP TABLE IF EXISTS public.cafeteria_billing_settings;
-- COMMENT ON COLUMN public.cafeterias.is_active IS NULL;
-- COMMIT;
```

**Puntos a confirmar al implementar.**

- **Truncado de tablas:** revisar si el `TRUNCATE` de `cafeterias` está bloqueado por las 007 y 009 (lo está para los usuarios); si no, el `ON DELETE RESTRICT` lo cubre.
- **`audit_business_integrity.sql`:** se amplía con las dos tablas, como pide §10.
- **Comprobaciones antes de aplicar:** que ninguna cafetería quede sin fila de cobro y que ningún `per_order_fee_cop` exista sin `PER_ORDER_FEE`.

## 5. Endpoints y roles

Todos son **solo SUPER_ADMIN**: activo, con rol exclusivo y sin cafetería asignada, leído de la base en cada llamada y nunca del JWT. Es la misma política que el listado actual.

- **Errores de identidad:** sin sesión o con token inválido, 401. Cualquier otra cuenta, 403 `SUPER_ADMIN_FORBIDDEN`.
- **Fallos temporales:** 503 `SUPER_ADMIN_TEMPORARILY_UNAVAILABLE` con `Retry-After`.
- **Transacciones:** las mutaciones usan `@Transactional(timeout = 15)`, bloquean la fila (`FOR UPDATE`) y hacen `SET LOCAL unifood.actor_id`.

| Método y ruta                                         | Cuerpo                                     | Respuesta                                                                                                           | Errores                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/super-admin/cafeterias` (existe; se amplía) | —                                          | Cada cafetería añade `visible` y `billing {model, perOrderFeeCop, version}`                                         | —                                                                                                                                                                                             |
| `PATCH /api/super-admin/cafeterias/{id}/visibility`   | `{visible, expectedVisible}`               | La cafetería actualizada                                                                                            | 400 `SUPER_ADMIN_INVALID_REQUEST`; 404 `CAFETERIA_NOT_FOUND`; 409 `VISIBILITY_STATE_CHANGED` (otro la cambió); 409 `CAFETERIA_REQUIRES_ADMIN` (hacerla visible sin ADMIN activo viola la 009) |
| `PUT /api/super-admin/cafeterias/{id}/billing`        | `{model, perOrderFeeCop, expectedVersion}` | La cafetería actualizada                                                                                            | 400 `BILLING_INVALID_REQUEST` (monto ausente con comisión, presente sin ella, fuera de 1–1.000.000 o no entero); 404 `CAFETERIA_NOT_FOUND`; 409 `BILLING_STATE_CHANGED`                       |
| `GET /api/super-admin/cafeterias/{id}/audit?limit=20` | —                                          | `{entries: [{setting, oldValue, newValue, changedAt, changedBy: {name} \| null, source}]}`, la más reciente primero | 400 `SUPER_ADMIN_INVALID_REQUEST`; 404 `CAFETERIA_NOT_FOUND`                                                                                                                                  |

- **Sin `subscribed`:** el campo `subscribed` del listado se retira y lo reemplaza `visible`. El único consumidor es `features/super-admin`, que se cambia en el mismo PR.
- **Idempotencia:** repetir el mismo valor responde 200 sin escribir ni auditar, igual que la cancelación repetida del cliente.
- **Lo que expone la auditoría:** el nombre del super admin, nunca su correo ni su id.
- **BFF (`app/api/super-admin/**`):**
  - `sameOrigin` en PATCH y PUT;
  - sesión y rol SUPER_ADMIN;
  - validación estricta del cuerpo: claves exactas y tipos;
  - `fetch` con `cache: "no-store"`, `redirect: "error"` y timeout;
  - mensajes fijos, sin cuerpos de Spring.

## 6. Panel del super admin

Sobre el listado de solo lectura que ya existe (`features/super-admin`), cada cafetería añade:

**Interruptor «Visible para los clientes»**

- Al ocultarla, pide confirmación: «Los pedidos en curso se terminarán de atender. Los clientes no podrán hacer pedidos nuevos en esta cafetería.».
- Al hacerla visible sin ADMIN activo, muestra: «Asigna un administrador activo antes de hacer visible esta cafetería.».

**Selector «Modelo de cobro»**

- Opciones: «Sin cobro», «Suscripción» y «Comisión por pedido».
- Con comisión aparece el campo «Comisión por pedido (COP)»: entero, de $1 a $1.000.000.
- Botón «Guardar».
- Texto fijo debajo: «UniFood no cobra desde la aplicación; esto solo registra el acuerdo.».

**Historial «Últimos cambios»**

- Muestra quién, cuándo, el valor anterior y el nuevo.
- Los cambios hechos por SQL aparecen como «Cambio manual (SQL)».

**Mensajes fijos**

| Situación                  | Mensaje                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Guardado                   | «Cambios guardados.»                                                               |
| 409 por cambio concurrente | «Otra persona cambió esta cafetería. Revisa el valor actual e inténtalo de nuevo.» |
| 400 del monto              | «Escribe una comisión entera entre $1 y $1.000.000.»                               |
| Fallo temporal             | «No pudimos guardar el cambio. Inténtalo de nuevo.»                                |

## 7. Cambios de texto en `docs/decisiones.md`

**§5, «Suscripción y estado de cafetería» → «Visibilidad y modelo de cobro de la cafetería»**

- **VISIBLE/OCULTA:** interruptor de SUPER_ADMIN, en `cafeterias.is_active`, sin vencimiento. Una cafetería oculta no aparece al cliente. Su WORKER y su ADMIN sí entran y configuran el catálogo. El backend rechaza menú, preferencia y crear pedido con 403 `CAFETERIA_NOT_SUBSCRIBED`; el código se conserva y el mensaje fijo es nuevo. Al ocultarla, los pedidos en curso se atienden hasta su estado final, incluido el cierre diario.
- **Modelo de cobro:** «Sin cobro», «Suscripción» o «Comisión por pedido» con monto en COP. Solo lo cambia SUPER_ADMIN y no afecta la visibilidad. No se cobra nada en el sistema. La comisión por pedido no se calcula ni se guarda por pedido todavía: se añadirá como snapshot en `orders`.
- **Auditoría:** cada cambio de visibilidad o de cobro queda en `cafeteria_settings_audit` (quién, cuándo, valor anterior y nuevo), en la misma transacción, también si se hace por SQL.
- Se retira la nota «Demo (2026-11-08): … deuda antes del piloto», que la 022 resuelve.

**§11**

- Se sustituye la fila inexistente `PATCH /api/super-admin/cafeterias/{id}/subscription` por las tres rutas de §5 de este documento, y el campo `subscribed` del listado por `visible` y `billing`.
- La fila `POST /api/super-admin/credentials` sigue como pendiente, fuera de esta fase.

**§10:** se añade la fila de la 022 a la tabla de migraciones.

## 8. Preguntas para el dueño antes del PR G

1. **Modelo inicial.** ¿`NONE` para todas (propuesto, sin inventar datos) o `SUBSCRIPTION` para las visibles?
2. **Tope de la comisión.** ¿Vale de $1 a $1.000.000 en pesos enteros, o la comisión puede llevar centavos?
3. **Visibilidad y cobro independientes.** ¿Se acepta que una cafetería visible pueda estar «Sin cobro»? Es lo propuesto: el cobro no condiciona la visibilidad.
4. **Auditoría por trigger.** ¿Se acepta que también registre los cambios por SQL manual con `source = 'SQL'` y sin autor?
5. **Retirar `subscribed`.** ¿Se retira del listado ya, o se conserva un PR como alias de `visible`?

## 9. Pruebas previstas para el PR G

- **Migración (PGlite y PostgreSQL nativo):**
  - la 022 se aplica sobre 001–023, se repite sin efecto y su bloque Reverse deja el esquema anterior;
  - siembra `NONE` y conserva `is_active`;
  - los CHECK del monto;
  - cada cafetería nueva recibe su fila;
  - auditoría con `API` y con `SQL`;
  - la auditoría es inmutable;
  - permisos cerrados para `anon` y `authenticated`.
- **Servicio:**
  - cambios de visibilidad y de cobro;
  - repetición idempotente;
  - conflictos con `expected*`;
  - `CAFETERIA_REQUIRES_ADMIN`;
  - validación del monto.
- **Controlador y autorización:** cada rol, SUPER_ADMIN inactivo o con cafetería, sin sesión y token inválido; ninguno escribe ni audita.
- **Postgres de extremo a extremo:**
  - ocultar con pedidos en curso: se siguen atendiendo y un pedido nuevo da 403;
  - auditoría en la misma transacción, y su rollback ante un fallo.
- **Web:**
  - BFF con `sameOrigin`, validación estricta y mensajes fijos;
  - panel con el interruptor, la confirmación, el selector, el monto, los errores y el historial;
  - e2e del panel del super admin.
