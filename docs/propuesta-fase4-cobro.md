# Fase 4: visibilidad y modelo de cobro por cafetería

Estado: **implementado** (PR G, rama `jj/fase4-cobro`, 2026-11-12). Este archivo queda como
registro de la decisión. Las reglas vigentes están en `docs/decisiones.md` §5, §10 y §11; si
algo difiere, manda `decisiones.md`.

## 1. Problema

`cafeterias.is_active` mezclaba la visibilidad operativa, la «suscripción» (`subscribed` en el
listado del super admin) y la actividad administrativa de la 009, que exige un ADMIN activo.
El dueño decidió que la suscripción no es obligatoria: una cafetería puede no pagar nada,
pagar una suscripción o pagar una comisión fija por pedido. En el sistema no se cobra nada.

## 2. Decisión

| Concepto                  | Dónde vive                                           | Quién lo cambia  |
| ------------------------- | ---------------------------------------------------- | ---------------- |
| (a) Visibilidad operativa | `cafeterias.is_active` (se queda con su nombre)      | Solo SUPER_ADMIN |
| (b) Modelo de cobro       | `cafeteria_billing_settings`, una fila por cafetería | Solo SUPER_ADMIN |
| Auditoría de (a) y (b)    | `cafeteria_settings_audit`, inmutable, por trigger   | Nadie la edita   |

## 3. Respuestas del dueño a las preguntas de la propuesta

1. **Modelo inicial:** `NONE` para todas las cafeterías, también las visibles.
2. **Montos:** pesos enteros; comisión por pedido de $1 a $1.000.000.
3. **Independencia:** visibilidad y cobro son independientes; una visible puede estar sin cobro.
4. **Auditoría por trigger:** también registra el SQL manual, con `source = 'SQL'` y sin autor.
5. **`subscribed`:** se retira ya del listado; lo reemplazan `visible` y `billing`.

**Cambio posterior a la propuesta:** la suscripción puede registrar un monto mensual opcional,
`subscription_fee_cop integer NULL`, solo con `SUBSCRIPTION` y de $1 a $100.000.000. La
comisión sigue siendo obligatoria solo con `PER_ORDER_FEE`. La auditoría guarda los dos montos.

## 4. Qué se implementó

- **Migración** `unifood-backend/supabase/migrations/022_cafeteria_visibility_billing.sql`
  (no aplicada a ninguna base remota): tablas, CHECK de modelo y montos, siembra `NONE`,
  trigger de fila por cafetería nueva, triggers de auditoría, auditoría inmutable (UPDATE,
  DELETE y TRUNCATE), fila de cobro imborrable, RLS y `REVOKE` a `PUBLIC`, `anon` y
  `authenticated`. Se aplica con `apply-migrations.ps1 -AllowOutOfOrder 022`; el bootstrap
  del registro la detecta y `staging-check.sql` revisa sus objetos.
- **Spring:** `PATCH …/{id}/visibility`, `PUT …/{id}/billing` y `GET …/{id}/audit?limit=20`,
  y el listado con `visible` y `billing`. `CAFETERIA_NOT_SUBSCRIBED` se conserva con el mensaje
  «Esta cafetería no está disponible en este momento.».
- **BFF y panel** (`features/super-admin`): interruptor con confirmación, modelo de cobro con
  sus montos, historial «Últimos cambios» y los textos SA1, SA2 y SA5 de `docs/ui-paneles.md`.

## 5. Decisiones tomadas al implementar

- **Repetir el valor actual** responde 200 sin escribir ni auditar aunque el valor esperado
  ya no coincida: es el reintento de un cambio que ya ocurrió. Si el valor es otro y lo
  esperado no coincide, 409.
- **La fila de cobro no se borra** (`cafeteria_billing_settings_required`), para que «una fila
  por cafetería» se cumpla siempre. Como las claves foráneas son `RESTRICT`, una cafetería con
  fila de cobro o con historial tampoco se borra.
- **Autor en el historial:** no existe un nombre del personal en las tablas públicas; se usa el
  `full_name` de los metadatos de Auth o, si falta, «Administrador global». Nunca el correo ni
  el id.
- **Orden de locks:** la visibilidad toma la fila guardia de la 009 en exclusiva antes de la
  cafetería, como el aprovisionamiento; el cobro, en compartido.

## 6. Panel del super admin

- «Gestionar» abre la configuración de una cafetería.
- Interruptor «Visible para los clientes». Al ocultar, diálogo: «Los pedidos en curso se
  terminarán de atender. Los clientes no podrán hacer pedidos nuevos en esta cafetería.». Sin
  ADMIN activo: «Asigna un administrador activo antes de hacer visible esta cafetería.».
- «Modelo de cobro»: «Sin cobro», «Suscripción» (con «Monto mensual (COP)», opcional) o
  «Comisión por pedido» (con «Comisión por pedido (COP)»). Botón «Guardar». Texto fijo:
  «UniFood no cobra desde la aplicación; esto solo registra el acuerdo.».
- «Últimos cambios»: quién, cuándo, valor anterior y nuevo; el SQL aparece como «Cambio manual
  (SQL)».
- Mensajes: «Cambios guardados.» (región `aria-live`); 409: «Otra persona cambió esta
  cafetería. Revisa el valor actual e inténtalo de nuevo.»; montos: «Escribe una comisión
  entera entre $1 y $1.000.000.» y «Escribe un monto mensual entero entre $1 y $100.000.000, o
  déjalo vacío.»; fallo temporal: «No pudimos guardar el cambio. Inténtalo de nuevo.».

## 7. Pendiente

- Aplicar la 022 en `unifood-staging` (primero `-PlanOnly`) y después en el proyecto real.
- Snapshot de la comisión en `orders` cuando se calcule por pedido.
- `POST /api/super-admin/credentials`, fuera de esta fase.
