# Términos y condiciones: aceptación y versión

> **Borrador pendiente de revisión legal.** El texto de `/terminos` no es definitivo. Debe revisarlo
> un profesional del derecho antes del piloto, en particular por la **Ley 1581 de 2012** (tratamiento
> de datos personales) y las reglas de consumo aplicables a la venta de alimentos.

## Decisión

- Los términos y la política de tratamiento de datos son **dos aceptaciones separadas**, cada una con
  su casilla y su enlace, en el paso 2 del registro (`unifood-web/features/auth/components/CompleteRegistration.tsx`).
  La autorización de datos debe ser expresa y distinguible, por eso no se unen.
- La casilla de aceptación del **carrito** se elimina. Los términos ya se aceptaron al registrarse, así
  que confirmar un pedido no exige nada más. Bajo el botón de confirmar queda un recordatorio con enlace:
  «Recuerda recoger tu pedido a tiempo. Al pedir aceptas los términos y condiciones».
- Quien ya tenía cuenta antes de esta versión, o aceptó una versión anterior, ve **un diálogo único**
  antes de entrar a `/cuenta` (`unifood-web/app/cuenta/layout.tsx` y `features/client/components/TermsGate.tsx`).
  Al aceptar se guarda la versión y el diálogo no vuelve a aparecer hasta que cambie la versión.

## Versión vigente

- Constante única: `CURRENT_TERMS_VERSION` en `unifood-web/features/auth/legal.ts` (hoy `2026-11-v1`).
- El servidor web la envía a la base de datos al registrarse y al aceptar. La base de datos guarda lo que
  recibe y solo valida su forma (`^[A-Za-z0-9._-]{1,32}$`); no decide cuál es la vigente.
- Para publicar una versión nueva: cambiar la constante, revisar `/terminos` y su número de versión.
  Todos los clientes verán el diálogo otra vez.

## Datos guardados

Tabla `public.clients` (migración `unifood-backend/supabase/migrations/024_client_terms_acceptance.sql`):

| Columna | Qué guarda |
| --- | --- |
| `terms_accepted_at` | Cuándo aceptó los términos. |
| `terms_version` | Versión aceptada (p. ej. `2026-11-v1`). |
| `privacy_accepted_at` | Autorización de datos (migración 018, sin cambios). |

Las dos columnas de términos son nulas a la vez o no lo son (`chk_clients_terms_pair`).

Funciones (`SECURITY DEFINER`, con `REVOKE` explícito y `GRANT` solo a `authenticated`):

- `complete_registration(full_name, institutional_code, privacy_accepted, terms_accepted, terms_version)`:
  sustituye la firma de la 018. Rechaza con `REGISTRATION_TERMS_REQUIRED` si no hay aceptación o la versión no es válida.
- `client_terms_accepted(current_version)`: indica si el cliente aceptó exactamente esa versión.
- `accept_client_terms(current_version)`: registra la aceptación solo para la fila del propio cliente.

## Texto de «Condiciones de recogida»

Estaba en la casilla del carrito («He revisado mi pedido y acepto las condiciones de recogida») y pasa
íntegro a la sección «Condiciones de recogida» de `/terminos`:

> Revisa los productos, las cantidades y la cafetería. Recoge tu pedido y paga en efectivo en caja. El
> total final lo calcula la cafetería al recibirlo.

## Pendiente antes del piloto

- Razón social, NIT, correo y teléfono del operador (`[PENDIENTE]` en `/terminos`).
- Responsabilidades frente a la cafetería, reclamos y devoluciones, ley aplicable y jurisdicción.
- Revisión legal de la política de tratamiento (`/privacidad`), que sigue como borrador.
