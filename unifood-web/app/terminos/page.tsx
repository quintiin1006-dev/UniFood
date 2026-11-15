import Link from "next/link";
import { CURRENT_TERMS_VERSION } from "@/features/auth/legal";

export const metadata = {
  title: "Términos y condiciones (borrador) | UniFood",
};

// DRAFT pending legal review. Data the operator must supply is marked [PENDIENTE]; nothing
// here is invented. The personal-data part is in /privacidad (Ley 1581 de 2012).
export default function TermsPage() {
  return (
    <main
      lang="es"
      style={{
        maxWidth: 680,
        margin: "0 auto",
        padding: "32px 16px 48px",
        lineHeight: 1.6,
        color: "var(--color-ink)",
      }}
    >
      <p
        role="note"
        style={{
          padding: "11px 14px",
          borderRadius: 11,
          background: "var(--color-brand-tint)",
          color: "var(--color-brand-hover)",
          fontWeight: 600,
        }}
      >
        Borrador, pendiente de revisión legal. Este texto no son los términos
        definitivos de UniFood.
      </p>
      <h1>Términos y condiciones</h1>
      <p>Versión {CURRENT_TERMS_VERSION}.</p>

      <h2>Quién opera UniFood</h2>
      <p>
        UniFood es un servicio para pedir almuerzo en las cafeterías de tu
        institución. Lo opera [PENDIENTE: razón social y NIT del operador].
      </p>
      <p>Contacto: [PENDIENTE: correo] · [PENDIENTE: teléfono].</p>

      <h2>Uso del servicio</h2>
      <p>
        Puedes usar UniFood con tu correo institucional y tu código
        institucional. Tu cuenta es personal: no la compartas. Eres responsable
        de los pedidos que hagas con ella.
      </p>

      <h2>Pedidos y cancelación</h2>
      <p>
        Un pedido se crea con los productos, las cantidades y la cafetería que
        elijas. Puedes escribir una nota de hasta 200 caracteres y, si quieres,
        una hora de recogida de hoy. Solo un pedido pendiente puede cancelarse
        desde la app; un pedido que ya está en preparación no puede cancelarse.
      </p>

      <h2>Pago en efectivo en la cafetería</h2>
      <p>
        El pago se hace en efectivo al recoger el pedido, en la caja de la
        cafetería. El total final lo calcula la cafetería al recibirlo.
      </p>

      <h2>Condiciones de recogida</h2>
      <p>
        Revisa los productos, las cantidades y la cafetería. Recoge tu pedido y
        paga en efectivo en caja. El total final lo calcula la cafetería al
        recibirlo.
      </p>

      <h2>Datos personales</h2>
      <p>
        Tratamos tus datos personales según la{" "}
        <Link href="/privacidad">política de tratamiento de datos</Link>, que
        también aceptas al registrarte.
      </p>

      <h2>Cambios a estos términos</h2>
      <p>
        Si cambiamos estos términos, cambiaremos la versión y te pediremos
        aceptarla de nuevo antes de seguir usando la app.
      </p>

      <h2>Pendiente de definir en la revisión legal</h2>
      <ul>
        <li>Responsabilidades frente a la cafetería y al operador.</li>
        <li>Procedimiento de reclamos y devoluciones.</li>
        <li>Ley aplicable y jurisdicción.</li>
      </ul>

      <p>
        <Link href="/login">Volver a UniFood</Link>
      </p>
    </main>
  );
}
