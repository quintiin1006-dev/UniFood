"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  Mail,
} from "lucide-react";
import Brand from "@/features/auth/components/Brand";
import { Field } from "@/features/auth/components/AuthField";
import { PanelAuthHero } from "@/features/auth/components/PanelAuthHero";
import { useAuthHydration } from "@/features/auth/useAuthHydration";
import {
  passwordRules,
  validEmail,
  validPassword,
} from "@/features/auth/validation";
import styles from "@/features/auth/components/AuthScreen.module.css";
import { createRecoveryClient } from "./client";
import type { RecoveryConfig } from "./config";
import { PanelRecoveryFlow } from "./flow";
import { RECOVERY_MESSAGES, RecoveryError } from "./errors";

export function PanelRecoveryScreen({
  config,
  mode,
}: {
  config: RecoveryConfig | null;
  mode: "request" | "password";
}) {
  const hydrated = useAuthHydration();
  const [flow] = useState(
    () =>
      new PanelRecoveryFlow(
        () => {
          if (!config) throw new RecoveryError("temporary");
          return createRecoveryClient(config).auth;
        },
        async () => {
          const response = await fetch("/api/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entrypoint: "panel" }),
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) throw new RecoveryError("temporary");
        },
      ),
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(mode === "password");
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);
  const verification = useRef<Promise<void> | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (mode !== "password") return;
    if (!verification.current) {
      const url = new URL(window.location.href);
      const codes = url.searchParams.getAll("code");
      const code =
        !url.searchParams.has("error") && !url.hash && codes.length === 1
          ? codes[0]
          : null;
      // Remove one-use evidence and provider error text before rendering a form.
      window.history.replaceState(
        window.history.state,
        "",
        "/panel/nueva-contrasena",
      );
      verification.current = flow.verify(code);
    }
    let active = true;
    verification.current
      .then(() => {
        if (active) {
          setVerified(true);
          setChecking(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setChecking(false);
          setInvalid(true);
          setError(
            cause instanceof RecoveryError
              ? cause.message
              : RECOVERY_MESSAGES.temporary,
          );
        }
      });
    return () => {
      active = false;
    };
  }, [flow, mode]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (mode === "request") {
        if (!validEmail(email.trim())) throw new RecoveryError("email");
        await flow.request(email, window.location.origin);
        setSent(true);
      } else {
        if (!updated) {
          if (!verified) throw new RecoveryError("invalid");
          if (!validPassword(password)) throw new RecoveryError("password");
          if (password !== confirm) throw new RecoveryError("mismatch");
          await flow.update(password);
          setPassword("");
          setConfirm("");
          setUpdated(true);
        }
        await flow.finish();
        window.location.replace("/panel/login?password=updated");
      }
    } catch (cause) {
      const failure =
        cause instanceof RecoveryError ? cause : new RecoveryError("temporary");
      setError(failure.message);
      if (failure.kind === "invalid") {
        setInvalid(true);
        setVerified(false);
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const disabled = !hydrated || busy;
  const title =
    mode === "request" ? "Recupera tu cuenta" : "Crea una nueva contraseña";
  return (
    <main
      className={`${styles.screen} ${styles.panelScreen} ${styles.panelLogin}`}
      lang="es"
    >
      <div className={`${styles.canvas} ${styles.panelCanvas}`}>
        <PanelAuthHero />
        <div className={`${styles.content} ${styles.panelContent}`}>
          <div className={styles.topbar}>
            <Link
              href="/panel/login"
              className={styles.back}
              aria-label="Volver al login del panel"
            >
              <ArrowLeft size={23} aria-hidden="true" />
            </Link>
          </div>
          <Brand entrypoint="panel" />
          <h1 className={styles.heading}>{title}</h1>
          <p className={styles.description}>
            {mode === "request"
              ? "Ingresa tu correo para recibir las instrucciones de recuperación."
              : "Define una nueva contraseña segura para tu cuenta."}
          </p>
          {checking && (
            <p role="status">Validando el enlace de recuperación…</p>
          )}
          {error && (
            <p
              className={styles.error}
              role="alert"
              ref={errorRef}
              tabIndex={-1}
            >
              {error}
            </p>
          )}
          {sent && (
            <p className={styles.success} role="status">
              <CheckCircle2 size={20} aria-hidden="true" />
              {RECOVERY_MESSAGES.neutral}
            </p>
          )}
          {updated && (
            <p className={styles.success} role="status">
              Tu contraseña se actualizó. Estamos finalizando la recuperación.
            </p>
          )}
          {invalid ? (
            <Link className={styles.link} href="/panel/recuperar">
              Solicitar un nuevo enlace
            </Link>
          ) : (
            !checking &&
            !sent && (
              <form
                method="post"
                autoComplete="off"
                noValidate
                onSubmit={submit}
                className={styles.form}
                aria-busy={busy}
              >
                <div className={styles.fields}>
                  {mode === "request" ? (
                    <Field
                      language="es"
                      icon={<Mail size={21} aria-hidden="true" />}
                      label="Correo electrónico"
                      type="email"
                      name="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={254}
                      disabled={disabled}
                      required
                    />
                  ) : (
                    !updated && (
                      <>
                        <Field
                          language="es"
                          icon={<LockKeyhole size={21} aria-hidden="true" />}
                          label="Nueva contraseña"
                          name="new-password"
                          password
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          autoComplete="new-password"
                          minLength={8}
                          maxLength={128}
                          disabled={disabled || !verified}
                          required
                          aria-describedby="recovery-password-rules"
                        />
                        <Field
                          language="es"
                          icon={<LockKeyhole size={21} aria-hidden="true" />}
                          label="Confirmar contraseña"
                          name="confirm-password"
                          password
                          value={confirm}
                          onChange={(event) => setConfirm(event.target.value)}
                          autoComplete="new-password"
                          minLength={8}
                          maxLength={128}
                          disabled={disabled || !verified}
                          required
                        />
                      </>
                    )
                  )}
                </div>
                {mode === "password" && !updated && (
                  <ul
                    className={styles.recoveryRules}
                    id="recovery-password-rules"
                  >
                    {[
                      "Entre 8 y 128 caracteres",
                      "Una letra mayúscula",
                      "Una letra minúscula",
                      "Un número",
                    ].map((rule, index) => (
                      <li
                        key={rule}
                        className={
                          passwordRules(password)[index] &&
                          password.length <= 128
                            ? styles.passed
                            : ""
                        }
                      >
                        {rule}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="submit"
                  className={styles.primary}
                  disabled={disabled || (mode === "password" && !verified)}
                >
                  {busy
                    ? "Procesando…"
                    : updated
                      ? "Finalizar recuperación"
                      : mode === "request"
                        ? "Enviar instrucciones"
                        : "Actualizar contraseña"}
                  <ArrowRight size={19} aria-hidden="true" />
                </button>
              </form>
            )
          )}
          {sent && (
            <Link className={styles.link} href="/panel/login">
              Volver al login del panel
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
