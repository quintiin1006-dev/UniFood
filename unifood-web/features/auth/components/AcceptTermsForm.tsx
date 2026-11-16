"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SESSION_CHECK_UNAVAILABLE } from "@/lib/messages";
import { TERMS_PATH } from "../legal";
import { loginPath, type AuthEntrypoint } from "../validation";
import styles from "./AuthScreen.module.css";

export const TERMS_TITLE = "Antes de seguir";
export const TERMS_DESCRIPTION =
  "Actualizamos los términos y condiciones de UniFood. Acéptalos para continuar.";
export const TERMS_CHECKBOX = "Acepto los términos y condiciones de UniFood.";
const TERMS_REQUIRED = "Marca la casilla para continuar.";
const SAVE_ERROR = "No pudimos guardar tu aceptación. Inténtalo de nuevo.";
const CONNECTION_ERROR =
  "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.";

/** "pending": the checkbox. "unavailable": the state could not be read, so only a retry. */
export type InitialTermsState = "pending" | "unavailable";

/**
 * The acceptance step, shown inside the login card and on /aceptar-terminos, so both look
 * the same. It only ever leaves this screen after the server stored the acceptance, which
 * keeps a client who has not accepted away from every other screen (fail closed).
 */
export default function AcceptTermsForm({
  destination,
  initialState = "pending",
  entrypoint = "client",
}: {
  destination: string;
  initialState?: InitialTermsState;
  entrypoint?: AuthEntrypoint;
}) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [unreadable, setUnreadable] = useState(initialState === "unavailable");
  const [error, setError] = useState(
    initialState === "unavailable" ? SESSION_CHECK_UNAVAILABLE : "",
  );
  const [hint, setHint] = useState("");
  const inFlight = useRef(false);
  const errorId = useId();
  const hintId = useId();
  // The browser leaves for the client home; the button stays busy until it does.
  const working = busy || leaving;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || inFlight.current) return;
    if (!accepted) return setHint(TERMS_REQUIRED);
    inFlight.current = true;
    setBusy(true);
    setError("");
    setHint("");
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
      // Stored: straight to the home, with no screen in between.
      setLeaving(true);
      window.location.assign(destination);
    } catch {
      setError(CONNECTION_ERROR);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // Only for a state that could not be read: ask the server again.
  async function retry() {
    if (working || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/me/terms", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        setError(SESSION_CHECK_UNAVAILABLE);
        return;
      }
      const data = await response.json();
      if (data.accepted === true) {
        setLeaving(true);
        window.location.assign(destination);
        return;
      }
      setUnreadable(false);
    } catch {
      setError(CONNECTION_ERROR);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function logout() {
    if (working || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entrypoint }),
      });
      if (!response.ok) {
        setError("No se pudo cerrar la sesión. Inténtalo de nuevo.");
        return;
      }
      window.dispatchEvent(new Event("unifood:logout"));
      setLeaving(true);
      window.location.replace(loginPath(entrypoint));
    } catch {
      setError(CONNECTION_ERROR);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      onKeyDown={(event) => {
        // Enter cannot submit while the only submit button is disabled.
        if (event.key === "Enter" && !accepted && !working && !unreadable)
          setHint(TERMS_REQUIRED);
      }}
      className={styles.form}
      aria-busy={working}
    >
      {unreadable ? (
        <>
          <p id={errorId} className={styles.error} role="alert">
            {error || SESSION_CHECK_UNAVAILABLE}
          </p>
          <button
            type="button"
            className={`${styles.primary} ${styles.continue}`}
            onClick={retry}
            disabled={working}
          >
            {working ? "Comprobando…" : "Reintentar"}
            {!working && <ArrowRight size={21} />}
          </button>
        </>
      ) : (
        <>
          <label className={styles.remember}>
            <input
              type="checkbox"
              name="terms"
              checked={accepted}
              disabled={working}
              aria-describedby={hint ? hintId : undefined}
              onChange={(event) => {
                setAccepted(event.target.checked);
                setHint("");
              }}
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
          {hint && (
            <p id={hintId} className={styles.error} role="alert">
              {hint}
            </p>
          )}
          {error && (
            <p id={errorId} className={styles.error} role="alert">
              {error}
            </p>
          )}
          {/* A disabled button swallows the click, so the wrapper explains why. */}
          <span
            className={styles.submitGuard}
            onClick={() => {
              if (!accepted && !working) setHint(TERMS_REQUIRED);
            }}
          >
            <button
              type="submit"
              className={`${styles.primary} ${styles.continue}`}
              disabled={!accepted || working}
            >
              {working ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  Guardando…
                </>
              ) : (
                <>
                  Aceptar y continuar
                  <ArrowRight size={21} />
                </>
              )}
            </button>
          </span>
        </>
      )}
      <button
        type="button"
        className={styles.link}
        onClick={logout}
        disabled={working}
      >
        Cerrar sesión
      </button>
    </form>
  );
}
