import shared from "./ClientShopping.module.css";

/** Shown when the backend cannot serve the menu. The cart stays in the browser meanwhile. */
export default function MenuUnavailable() {
  return (
    <section className={shared.empty} role="alert">
      <h1>No pudimos cargar el menú</h1>
      <p>Intenta de nuevo en un momento. Tu carrito se conserva.</p>
    </section>
  );
}
