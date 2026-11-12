"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import shared from "./ClientShopping.module.css";

/**
 * Shown when the backend cannot serve the menu or the context. The message is fixed: Spring
 * text never reaches the screen. The cart stays in the browser meanwhile.
 */
export default function MenuUnavailable({
  title = "No pudimos cargar el menú",
}: {
  title?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section className={shared.empty} role="alert">
      <h1>{title}</h1>
      <p>Intenta de nuevo en un momento. Tu carrito se conserva.</p>
      <button
        type="button"
        className={shared.primaryButton}
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? "Reintentando…" : "Volver a intentar"}
      </button>
    </section>
  );
}
