"use client";

export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <h1>Servicio temporalmente no disponible</h1>
      <p role="alert">No pudimos cargar esta página. Inténtalo nuevamente.</p>
      <button type="button" onClick={() => retry()}>
        Volver a intentar
      </button>
    </main>
  );
}
