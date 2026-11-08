import Link from "next/link";

export const metadata = {
  title: "Tratamiento de datos personales (borrador) | UniFood",
};

// DRAFT pending legal review (Ley 1581 de 2012). Not definitive legal text: it lists
// only what the app stores today, and the open points stay marked as pending.
export default function PrivacyPage() {
  return (
    <main
      lang="es"
      style={{
        maxWidth: 680,
        margin: "0 auto",
        padding: "32px 16px 48px",
        lineHeight: 1.6,
        color: "#172b23",
      }}
    >
      <p
        role="note"
        style={{
          padding: "11px 14px",
          borderRadius: 11,
          background: "#fff4e5",
          color: "#7a4b00",
          fontWeight: 600,
        }}
      >
        Borrador, pendiente de revisión legal. Este texto no es la política
        definitiva de tratamiento de datos personales de UniFood.
      </p>
      <h1>Tratamiento de datos personales</h1>
      <h2>Datos que registramos</h2>
      <ul>
        <li>Tu correo institucional.</li>
        <li>Tu nombre completo.</li>
        <li>
          Tu código institucional, obligatorio para estudiantes y opcional para
          docentes y administrativos.
        </li>
        <li>La fecha en que aceptaste este tratamiento.</li>
        <li>Tus pedidos en las cafeterías de tu sede.</li>
      </ul>
      <h2>Para qué los usamos</h2>
      <p>
        Para crear tu cuenta, verificar que perteneces a tu institución y
        gestionar tus pedidos. La cafetería ve solo tu nombre y tu código
        institucional, o tu nombre y tu tipo de cuenta si no tienes código.
      </p>
      <h2>Pendiente de definir en la revisión legal</h2>
      <ul>
        <li>Responsable del tratamiento y datos de contacto.</li>
        <li>Plazo de conservación de los datos.</li>
        <li>
          Procedimiento para consultar, corregir o eliminar tus datos, y para
          revocar esta autorización.
        </li>
      </ul>
      <p>
        <Link href="/login">Volver a UniFood</Link>
      </p>
    </main>
  );
}
