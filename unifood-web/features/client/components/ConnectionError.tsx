"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CONNECTION_FAILED } from "@/lib/messages";
import shared from "./ClientShopping.module.css";

/**
 * The server could not be reached: network, timeout or a 5xx answer. It says exactly that
 * and offers a retry, which is a different thing from having nothing to show (NoCafeterias).
 */
export default function ConnectionError() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section className={shared.empty} role="alert">
      <h1>{CONNECTION_FAILED}</h1>
      <p>Tu carrito se conserva.</p>
      <button
        type="button"
        className={shared.primaryButton}
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? "Reintentando…" : "Reintentar"}
      </button>
    </section>
  );
}
