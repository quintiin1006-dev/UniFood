import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#08284e",
        color: "white",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "28px",
            fontWeight: 700,
          }}
        >
          UniFood
        </h1>

        <p
          style={{
            margin: 0,
            opacity: 0.85,
            fontSize: "16px",
          }}
        >
          Tu comida, sin filas.
        </p>

        <Link
          href="/worker"
          style={{
            color: "white",
            textDecoration: "none",
            padding: "14px 22px",
            borderRadius: "var(--radius-control)",
            background: "var(--accent)",
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          Ir al panel de trabajador
        </Link>
      </div>
    </main>
  );
}
