"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  IdCard,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import {
  passwordRules,
  validFullName,
  validInstitutionalCode,
  validPassword,
  type PendingRegistration,
} from "../validation";
import Brand, { Waves } from "./Brand";
import { Field } from "./AuthField";
import { useAuthHydration } from "../useAuthHydration";
import styles from "./AuthScreen.module.css";

const t = {
  title: "Completa tu",
  titleEm: "registro",
  note: "Tu correo ya está verificado. Faltan tus datos y tu contraseña.",
  name: "Nombre completo",
  studentCode: "Código estudiantil",
  staffCode: "Código institucional (opcional)",
  privacyBefore: "Acepto el tratamiento de mis datos personales según la ",
  privacyLink: "política de privacidad",
  password: "Contraseña",
  confirm: "Confirmar contraseña",
  include: "Tu contraseña debe incluir:",
  rules: [
    "Mínimo 8 caracteres",
    "Una letra mayúscula",
    "Una letra minúscula",
    "Un número",
  ],
  submit: "Crear mi cuenta",
  wait: "Un momento…",
  invalidName: "Escribe tu nombre completo (entre 3 y 150 caracteres).",
  privacy: "Debes aceptar el tratamiento de tus datos personales.",
  invalidPassword:
    "La contraseña debe cumplir los requisitos y no superar 128 caracteres.",
  mismatch: "Las contraseñas no coinciden.",
  connection: "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.",
  recover: "Recibir un código nuevo",
  progress: "Progreso del registro",
  steps: ["Correo institucional", "Verificación", "Tus datos"],
};

// These two failures need a fresh code session, which only recovery provides.
const needsCode = new Set([
  "REGISTRATION_NOT_AUTHENTICATED",
  "REGISTRATION_OTP_SESSION_REQUIRED",
]);

function codeHint(rules: PendingRegistration) {
  const length =
    rules.minCodeLength === rules.maxCodeLength
      ? `${rules.minCodeLength} dígitos`
      : `entre ${rules.minCodeLength} y ${rules.maxCodeLength} dígitos`;
  return rules.codeRequired
    ? `Solo números, ${length}.`
    : `Opcional. Solo números, ${length}.`;
}

export default function CompleteRegistration({
  rules,
}: {
  rules: PendingRegistration;
}) {
  const hydrated = useAuthHydration();
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoverable, setRecoverable] = useState(false);
  const student = rules.clientType === "STUDENT";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated || busy) return;
    setError("");
    setRecoverable(false);
    const trimmedCode = code.trim();
    if (!validFullName(fullName)) return setError(t.invalidName);
    if (!validInstitutionalCode(trimmedCode, rules))
      return setError(codeHint(rules));
    if (!privacy) return setError(t.privacy);
    if (!validPassword(password)) return setError(t.invalidPassword);
    if (password !== confirm) return setError(t.mismatch);
    setBusy(true);
    try {
      const response = await fetch("/api/auth/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entrypoint: "client",
          fullName: fullName.trim(),
          code: trimmedCode,
          privacy: true,
          password,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        // Fields stay filled: a retry needs no new code while the session lasts.
        setRecoverable(needsCode.has(data.code));
        setError(data.message || t.connection);
        return;
      }
      window.location.assign(data.redirect);
    } catch {
      setError(t.connection);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen} lang="es">
      <div className={styles.canvas}>
        <div className={styles.content}>
          <Brand entrypoint="client" large={false} />
          <h1 className={styles.heading}>
            {t.title} <em>{t.titleEm}</em>
          </h1>
          <p className={styles.description}>{t.note}</p>
          <form
            method="post"
            autoComplete="off"
            onSubmit={submit}
            className={styles.form}
            aria-busy={busy}
          >
            <div className={styles.fields}>
              <Field
                language="es"
                icon={<UserRound size={21} />}
                label={t.name}
                name="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                required
                minLength={3}
                maxLength={150}
                disabled={!hydrated || busy}
              />
              <Field
                language="es"
                icon={<IdCard size={21} />}
                label={student ? t.studentCode : t.staffCode}
                name="institutional-code"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
                inputMode="numeric"
                required={rules.codeRequired}
                minLength={rules.minCodeLength}
                maxLength={rules.maxCodeLength}
                disabled={!hydrated || busy}
                aria-describedby="code-hint"
              />
              <Field
                language="es"
                icon={<LockKeyhole size={21} />}
                label={t.password}
                password
                name="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                disabled={!hydrated || busy}
                aria-describedby="password-rules"
              />
              <Field
                language="es"
                icon={<LockKeyhole size={21} />}
                label={t.confirm}
                password
                name="confirm-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                disabled={!hydrated || busy}
              />
            </div>
            <p id="code-hint" className={styles.note}>
              {codeHint(rules)}
            </p>
            <div id="password-rules" className={styles.requirements}>
              <p>{t.include}</p>
              <ul>
                {t.rules.map((rule, index) => (
                  <li
                    key={rule}
                    className={
                      passwordRules(password)[index] ? styles.passed : ""
                    }
                  >
                    <CheckCircle2 size={14} />
                    {rule}
                    <span className={styles.srOnly}>
                      {passwordRules(password)[index] ? " ✓" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <label className={styles.remember}>
              <input
                type="checkbox"
                name="privacy"
                checked={privacy}
                onChange={(event) => setPrivacy(event.target.checked)}
                disabled={!hydrated || busy}
                required
              />
              <span>
                {t.privacyBefore}
                <Link
                  className={styles.link}
                  href="/privacidad"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.privacyLink}
                </Link>
                .
              </span>
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {recoverable && (
              <Link
                className={styles.link}
                href="/recuperar-contrasena?entrypoint=client"
              >
                {t.recover}
              </Link>
            )}
            <button
              className={`${styles.primary} ${styles.passwordContinue}`}
              type="submit"
              disabled={!hydrated || busy}
            >
              {busy ? t.wait : t.submit}
              {!busy && <ArrowRight size={21} />}
            </button>
          </form>
          <ol className={styles.progress} aria-label={t.progress}>
            {t.steps.map((label, index) => (
              <li
                key={label}
                aria-current={index === 2 ? "step" : undefined}
                className={index < 2 ? styles.complete : ""}
              >
                <span className={styles.dot} />
                <span className={styles.srOnly}>
                  {index + 1}. {label}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <Waves />
      </div>
    </main>
  );
}
