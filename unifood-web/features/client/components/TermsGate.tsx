"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TERMS_PATH } from "@/features/auth/legal";
import { Spinner } from "@/components/ui/Spinner";
import styles from "./TermsGate.module.css";

const SAVE_ERROR = "No pudimos guardar tu aceptación. Inténtalo de nuevo.";
const CONNECTION_ERROR =
  "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.";

/**
 * Asked once per terms version, before the client's first screen. It has no way to close:
 * the only way on is to accept, and the server stores that acceptance for good.
 */
export default function TermsGate() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checkbox = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const errorId = useId();

  useEffect(() => {
    checkbox.current?.focus();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accepted || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/me/terms", {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        setError(SAVE_ERROR);
        return;
      }
      // The layout re-reads the acceptance on the server and stops rendering this dialog.
      router.refresh();
    } catch {
      setError(CONNECTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
      >
        <h2 id={titleId}>Antes de seguir</h2>
        <p>
          Lee y acepta los términos y condiciones de UniFood para usar la app.
        </p>
        <form onSubmit={save} className={styles.form}>
          <label className={styles.check}>
            <input
              ref={checkbox}
              type="checkbox"
              checked={accepted}
              disabled={busy}
              required
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              Acepto los{" "}
              <Link
                href={TERMS_PATH}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
              >
                términos y condiciones
              </Link>{" "}
              de UniFood.
            </span>
          </label>
          {error && (
            <p id={errorId} role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <button
            type="submit"
            className={styles.primary}
            disabled={!accepted || busy}
            aria-busy={busy || undefined}
          >
            {busy && <Spinner />}
            {busy ? "Un momento…" : "Aceptar y continuar"}
          </button>
        </form>
      </section>
    </div>
  );
}
