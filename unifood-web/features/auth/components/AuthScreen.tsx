"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Info,
  LockKeyhole,
  Mail,
} from "lucide-react";
import {
  loginPath,
  normalizeIdentifier,
  passwordRules,
  validEmail,
  validPassword,
  validRegistrationEmail,
  normalizeOtp,
  OTP_LENGTH,
  type AuthEntrypoint,
  type ClientType,
} from "../validation";
import Brand, { Waves } from "./Brand";
import { Field } from "./AuthField";
import AcceptTermsForm, {
  TERMS_DESCRIPTION,
  TERMS_TITLE,
  type InitialTermsState,
} from "./AcceptTermsForm";
import { PanelAuthHero } from "./PanelAuthHero";
import { useAuthHydration } from "../useAuthHydration";
import {
  clearRecoveryEmail,
  handRecoveryEmail,
  readRecoveryEmail,
  readRecoverySent,
} from "../recoveryHandoff";
import {
  PASSWORD_UPDATED,
  RECOVERY_CODE_LABEL,
  RECOVERY_CODE_SENT,
  RECOVERY_CONFIRM_PASSWORD,
  RECOVERY_NEW_PASSWORD,
  RECOVERY_RESEND,
  RECOVERY_SEND,
  RECOVERY_STEP_TWO_NOTE,
  RECOVERY_SUBMIT,
  RECOVERY_TITLE,
  recoveryResendIn,
  recoverySendTo,
} from "../../shared/messages";
import styles from "./AuthScreen.module.css";

type Mode = "login" | "register" | "recover";
// Must match Auth's Email OTP expiration of 900 s and the email templates.
const OTP_VALIDITY_MINUTES = 15;
const RESEND_WAIT_SECONDS = 60;
/** Changing the password: «Reenviar código» waits 30 s, visibly. */
const RECOVERY_RESEND_SECONDS = 30;
/** Toasts hide by themselves after 5 s. */
const TOAST_MS = 5000;
// Supabase also rate-limits; this keeps one screen from spending that budget.
const MAX_RESENDS = 3;
type DomainCheck =
  | { state: "idle" | "checking" | "denied" }
  | { state: "allowed"; clientType: ClientType };
// Firefox-only button attribute, absent from the React types: without it the
// back button sits outside the form and Firefox restores its disabled state.
const NO_FIREFOX_STATE_RESTORE = { autoComplete: "off" };
const t = {
  panelTitle: "Acceso al panel",
  panelNote: "Inicia sesión con tu cuenta de trabajo.",
  panelLabel: "Panel UniFood",
  panelHeading: "Tu cafetería, en un solo lugar.",
  panelDescription: "Organiza el trabajo diario y mantén tu operación al día.",
  food: "Tu comida,",
  noLines: "sin filas",
  tagline: "Pide, recoge y sigue con tu día.",
  identifier: "Usuario o correo institucional",
  password: "Contraseña",
  confirm: "Confirmar contraseña",
  remember: "Mantener sesión iniciada",
  forgot: "¿Olvidaste tu contraseña?",
  login: "Iniciar sesión",
  or: "o",
  noAccount: "¿No tienes una cuenta?",
  register: "Registrarse como estudiante",
  next: "Continuar",
  useEmail: "Usa tu correo",
  institutional: "institucional",
  emailNote:
    "Te enviaremos un código de verificación para confirmar tu cuenta.",
  onlyInstitutional:
    "Usa tu correo @ustavillavo.edu.co o @ustavillavicencio.edu.co.",
  checking: "Comprobando tu correo…",
  studentAccount: "Correo válido: cuenta de estudiante.",
  staffAccount: "Correo válido: cuenta de docente o administrativo.",
  denied:
    "Este correo no está habilitado. Usa tu correo institucional, sin «+».",
  validity: `El código vence en ${OTP_VALIDITY_MINUTES} minutos.`,
  resendLimit:
    "Ya pediste varios códigos. Espera unos minutos y revisa tu correo, incluida la carpeta de spam.",
  createPassword: "Crea una contraseña",
  secure: "segura",
  passwordNote: "Debe tener al menos 8 caracteres.",
  include: "Tu contraseña debe incluir:",
  rules: [
    "Mínimo 8 caracteres",
    "Una letra mayúscula",
    "Una letra minúscula",
    "Un número",
  ],
  verify: "Verifica",
  yourEmail: "tu correo",
  sent: "Te enviamos un código de 6 dígitos a",
  notReceived: "¿No recibiste el código?",
  resend: "Reenviar código",
  verifyButton: "Verificar",
  code: "Código de verificación",
  recovery: "Recupera tu",
  account: "cuenta",
  recoveryNote:
    "Ingresa tu correo institucional para restablecer tu contraseña.",
  sendCode: "Enviar código",
  reset: "Restablecer contraseña",
  resetDone: "Tu contraseña se actualizó. Ya puedes iniciar sesión.",
  wait: "Un momento…",
  entering: "Entrando…",
  back: "Volver",
  show: "Mostrar contraseña",
  hide: "Ocultar contraseña",
  progress: "Progreso del registro",
  steps: ["Correo institucional", "Verificación", "Tus datos"],
  invalidEmail: "Escribe un correo institucional válido.",
  invalidPassword:
    "La contraseña debe cumplir los requisitos y no superar 128 caracteres.",
  mismatch: "Las contraseñas no coinciden.",
  invalidCode: "Ingresa los 6 dígitos del código.",
  connection: "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.",
  resendDone: "Enviamos un nuevo código. Revisa también tu carpeta de spam.",
  verifyLink: "Verificar mi correo",
  recoverySent:
    "Si existe una cuenta con este correo, recibirás un código para recuperar el acceso.",
};

export default function AuthScreen({
  initialMode,
  usernameDomain,
  entrypoint,
  passwordUpdated = false,
}: {
  initialMode: Mode;
  usernameDomain: string;
  entrypoint: AuthEntrypoint;
  passwordUpdated?: boolean;
}) {
  // The server HTML must not accept credentials before React attaches events.
  const hydrated = useAuthHydration();
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [rulesAnswer, setRulesAnswer] = useState<{
    address: string;
    result: DomainCheck;
  } | null>(null);
  const [resends, setResends] = useState(0);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    passwordUpdated
      ? "Tu contrase\u00f1a se actualiz\u00f3 correctamente. Inicia sesi\u00f3n con tu nueva contrase\u00f1a."
      : "",
  );
  const [unverified, setUnverified] = useState(false);
  // The address is known (handed from the login or «Mi perfil»): step 1 shows it, no field.
  const [knownEmail, setKnownEmail] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set only when the server says this client has to accept the terms before going on.
  const [termsStep, setTermsStep] = useState<{
    destination: string;
    state: InitialTermsState;
  } | null>(null);
  const [confirmingLogin, setConfirmingLogin] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // One request at a time, even between a state update and its re-render.
  const inFlight = useRef(false);
  // The last complete code sent automatically, so the same code is never sent twice.
  const autoSubmitted = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isLogin = mode === "login";
  const isRecovery = mode === "recover";
  // Registration here is step 1 only: email, then the code. Step 2 has its own page.
  const isRegisterEmail = mode === "register" && step === 0;
  const isOtp = !isLogin && step === 1;
  // Recovery is one screen after the email: the code and the new password together.
  const isPassword = isRecovery && step === 1;

  const typedAddress = email.trim().toLowerCase();
  const typedValid = validRegistrationEmail(typedAddress);
  // Derived on render: only the server's answer for this exact address is state.
  const domain: DomainCheck = !typedValid
    ? { state: typedAddress.includes("@") ? "denied" : "idle" }
    : rulesAnswer?.address === typedAddress
      ? rulesAnswer.result
      : { state: "checking" };

  useEffect(() => {
    if (!isRegisterEmail || !typedValid) return;
    const address = typedAddress;
    let current = true;
    // Debounced, and stale answers are ignored. Only domain facts come back.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/auth/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: address, entrypoint }),
        });
        const data = await response.json();
        if (!current) return;
        setRulesAnswer({
          address,
          result:
            response.ok &&
            data.allowed === true &&
            (data.clientType === "STUDENT" || data.clientType === "STAFF")
              ? { state: "allowed", clientType: data.clientType }
              : { state: response.ok ? "denied" : "idle" },
        });
      } catch {
        if (current) setRulesAnswer({ address, result: { state: "idle" } });
      }
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [typedAddress, typedValid, entrypoint, isRegisterEmail]);

  useEffect(() => {
    // Coming from the login or «Mi perfil» with the address: step 1 shows it instead of a field.
    // From «Mi perfil» the code already went out, so the screen opens on step 2.
    if (!hydrated || !isRecovery || step !== 0) return;
    const handed = readRecoveryEmail();
    if (!handed || !validEmail(handed)) return;
    const sent = readRecoverySent();
    const timer = setTimeout(() => {
      clearRecoveryEmail();
      setEmail(handed);
      setKnownEmail(true);
      if (sent) {
        setResends(0);
        next();
        startCountdown(RECOVERY_RESEND_SECONDS);
        showToast(RECOVERY_CODE_SENT);
      }
    }, 0);
    return () => clearTimeout(timer);
    // Only on arrival: the recovery screen reads the handed address once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    if (!resendAt) return;
    const tick = () =>
      setCountdown(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  useEffect(() => {
    // The code screen focuses its labelled field so the keyboard opens at once.
    if (isOtp) codeRef.current?.focus();
    else if (step > 0) headingRef.current?.focus();
  }, [step, isOtp]);

  useEffect(() => {
    // Six digits typed, pasted or autofilled send the form once, through the same
    // submit handler and its guards as the Verify button.
    // In recovery the code waits for the new password, so it is never sent alone.
    if (!isOtp || isRecovery || !hydrated || code.length !== OTP_LENGTH) return;
    if (autoSubmitted.current === code || inFlight.current) return;
    autoSubmitted.current = code;
    formRef.current?.requestSubmit();
  }, [code, isOtp, isRecovery, hydrated]);

  async function request(action: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/auth/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, entrypoint }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.code === "email_not_confirmed") setUnverified(true);
      throw new Error(data.message || t.connection);
    }
    return data;
  }

  /** Sends the recovery code and opens the code + new password screen. */
  async function sendRecoveryCode(address: string) {
    await request("recover", { email: address });
    setEmail(address.trim().toLowerCase());
    setResends(0);
    next();
    startCountdown(RECOVERY_RESEND_SECONDS);
    // The same answer whether or not the address has an account.
    showToast(RECOVERY_CODE_SENT);
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), TOAST_MS);
  }

  function startCountdown(seconds = RESEND_WAIT_SECONDS) {
    setResendAt(Date.now() + seconds * 1000);
    setCountdown(seconds);
  }
  function next() {
    setStep((current) => current + 1);
    setError("");
    setNotice("");
  }
  // Client navigation: the login form keeps its «Entrando…» state until the destination is ready,
  // and no full-page reload flashes a blank screen (ola 4 · destello).
  const router = useRouter();
  function navigate(path: string) {
    router.prefetch(path);
    router.replace(path);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated || busy || inFlight.current) return;
    inFlight.current = true;
    setError("");
    setNotice("");
    setBusy(true);
    let failedOnCode = false;
    try {
      if (isLogin) {
        setUnverified(false);
        const data = await request("login", { email, password, remember });
        // A client who still owes the current terms accepts them here, in this same card,
        // and only then moves on. No client screen is rendered in between.
        if (data.terms === "pending" || data.terms === "unavailable")
          setTermsStep({ destination: data.redirect, state: data.terms });
        else navigate(data.redirect);
      } else if (isOtp && isRecovery) {
        failedOnCode = true;
        if (code.length !== OTP_LENGTH) throw new Error(t.invalidCode);
        if (!validPassword(password)) throw new Error(t.invalidPassword);
        if (password !== confirm) throw new Error(t.mismatch);
        const data = await request("verify", { email, code, recovery: true });
        failedOnCode = false;
        // A registration left before step 2 continues there with this code session.
        if (data.redirect) {
          navigate(data.redirect);
          return;
        }
        await request("reset", { password });
        // Done: back to signing in, with a short confirmation on top.
        setMode("login");
        setStep(0);
        setCode("");
        setPassword("");
        setConfirm("");
        showToast(PASSWORD_UPDATED);
      } else if (isOtp) {
        failedOnCode = true;
        if (code.length !== OTP_LENGTH) throw new Error(t.invalidCode);
        const data = await request("verify", {
          email,
          code,
          recovery: isRecovery,
          ...(confirmingLogin ? { remember } : {}),
        });
        // Signup and a recovery left before step 2 continue on the server's redirect.
        failedOnCode = false;
        if (data.terms === "pending" || data.terms === "unavailable")
          setTermsStep({ destination: data.redirect, state: data.terms });
        else if (data.redirect) navigate(data.redirect);
        else {
          setPassword("");
          setConfirm("");
          next();
        }
      } else if (isPassword) {
        if (!validPassword(password)) throw new Error(t.invalidPassword);
        if (password !== confirm) throw new Error(t.mismatch);
        await request("reset", { password });
        setMode("login");
        setStep(0);
        setPassword("");
        setConfirm("");
        setNotice(t.resetDone);
      } else if (isRegisterEmail) {
        const address = email.trim().toLowerCase();
        if (!validRegistrationEmail(address)) throw new Error(t.denied);
        // The server generates the step 1 password; the browser never sees it.
        await request("register", { email: address });
        setEmail(address);
        setResends(0);
        startCountdown();
        next();
      } else {
        if (!validEmail(email.trim())) throw new Error(t.invalidEmail);
        await sendRecoveryCode(email);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.connection);
    } finally {
      inFlight.current = false;
      setBusy(false);
      // Back to the code after a rejected one, once the field is enabled again.
      if (failedOnCode) setTimeout(() => codeRef.current?.select(), 0);
    }
  }

  async function resend(fromLogin = false) {
    if (busy || (!fromLogin && countdown > 0)) return;
    if (!fromLogin && resends >= MAX_RESENDS) {
      setNotice("");
      setError(t.resendLimit);
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const normalized = normalizeIdentifier(email, usernameDomain);
      await request("resend", { email: normalized, recovery: isRecovery });
      setEmail(normalized);
      setCode("");
      autoSubmitted.current = "";
      setResends((count) => (fromLogin ? 0 : count + 1));
      if (isRecovery) {
        startCountdown(RECOVERY_RESEND_SECONDS);
        showToast(RECOVERY_CODE_SENT);
      } else {
        startCountdown();
        setNotice(t.resendDone);
      }
      if (fromLogin) {
        setConfirmingLogin(true);
        setMode("register");
        setStep(1);
        setPassword("");
        setUnverified(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.connection);
    } finally {
      setBusy(false);
    }
  }

  function back() {
    if (busy) return;
    setError("");
    setNotice("");
    if (isOtp || step === 0) navigate(loginPath(entrypoint));
    else {
      setStep((current) => current - 1);
      setPassword("");
      setConfirm("");
    }
  }

  function updateCode(value: string) {
    setCode(normalizeOtp(value));
  }

  const title = termsStep ? (
    TERMS_TITLE
  ) : isLogin ? (
    entrypoint === "panel" ? (
      t.panelTitle
    ) : (
      <>
        {t.food}
        <br />
        <em>{t.noLines}</em>
      </>
    )
  ) : isRecovery ? (
    RECOVERY_TITLE
  ) : isOtp ? (
    <>
      {t.verify} <em>{t.yourEmail}</em>
    </>
  ) : isPassword ? (
    <>
      {t.createPassword}
      <br />
      <em>{t.secure}</em>
    </>
  ) : isRecovery ? (
    <>
      {t.recovery}
      <br />
      <em>{t.account}</em>
    </>
  ) : (
    <>
      {t.useEmail}
      <br />
      <em>{t.institutional}</em>
    </>
  );
  const description = termsStep ? (
    TERMS_DESCRIPTION
  ) : isLogin ? (
    entrypoint === "panel" ? (
      t.panelNote
    ) : (
      t.tagline
    )
  ) : isRecovery ? (
    step === 0 ? (
      knownEmail ? (
        recoverySendTo(email)
      ) : (
        t.recoveryNote
      )
    ) : (
      RECOVERY_STEP_TWO_NOTE
    )
  ) : isOtp ? (
    <>
      {t.sent}
      <span className={styles.email}>{email}</span>
    </>
  ) : isPassword ? (
    t.passwordNote
  ) : isRecovery ? (
    t.recoveryNote
  ) : (
    t.emailNote
  );
  const buttonText = busy
    ? isLogin
      ? t.entering
      : t.wait
    : isLogin
      ? t.login
      : isOtp
        ? isRecovery
          ? RECOVERY_SUBMIT
          : t.verifyButton
        : isRecovery
          ? step === 0
            ? RECOVERY_SEND
            : RECOVERY_SUBMIT
          : t.next;

  return (
    <main
      className={`${styles.screen} ${entrypoint === "panel" ? `${styles.panelScreen} ${styles.panelLogin}` : ""}`}
      lang="es"
    >
      {/* Short confirmations: on top, announced, gone after 5 s. */}
      {(isRecovery || toast) && (
        <div className={styles.toastRegion} role="status" aria-live="polite">
          {toast && <p className={styles.toast}>{toast}</p>}
        </div>
      )}
      <div
        className={`${styles.canvas} ${entrypoint === "panel" ? styles.panelCanvas : ""}`}
      >
        {entrypoint === "panel" && (
          <PanelAuthHero
            label={t.panelLabel}
            heading={t.panelHeading}
            description={t.panelDescription}
          />
        )}
        <div
          className={`${styles.content} ${entrypoint === "panel" ? styles.panelContent : ""}`}
        >
          {(!isLogin || entrypoint === "client") && (
            <div className={styles.topbar}>
              {!isLogin && (
                <button
                  type="button"
                  {...NO_FIREFOX_STATE_RESTORE}
                  className={styles.back}
                  onClick={back}
                  disabled={!hydrated || busy}
                  aria-label={t.back}
                >
                  <ArrowLeft size={23} />
                </button>
              )}
            </div>
          )}
          <Brand
            entrypoint={entrypoint}
            large={isLogin && entrypoint === "client"}
          />
          <h1
            ref={headingRef}
            tabIndex={-1}
            className={`${styles.heading} ${isLogin && entrypoint === "client" ? styles.hero : ""}`}
          >
            {title}
          </h1>
          <p className={styles.description}>{description}</p>
          {termsStep ? (
            <AcceptTermsForm
              destination={termsStep.destination}
              initialState={termsStep.state}
              entrypoint={entrypoint}
            />
          ) : (
            <>
              {/* Firefox must not restore disabled attributes before hydration. */}
              <form
                ref={formRef}
                method="post"
                autoComplete="off"
                onSubmit={submit}
                className={`${styles.form} ${isLogin ? styles.loginForm : ""}`}
                aria-busy={busy}
              >
                <div className={styles.fields}>
                  {isLogin && (
                    <>
                      <Field
                        icon={<Mail size={21} />}
                        label={t.identifier}
                        name="username"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        required
                        maxLength={254}
                        disabled={!hydrated || busy}
                      />
                      <Field
                        icon={<LockKeyhole size={21} />}
                        label={t.password}
                        password
                        name="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                        required
                        maxLength={128}
                        disabled={!hydrated || busy}
                      />
                    </>
                  )}
                  {(isRegisterEmail ||
                    (isRecovery && step === 0 && !knownEmail)) && (
                    <Field
                      icon={<Mail size={21} />}
                      label={`usuario@${usernameDomain}`}
                      aria-label={t.institutional}
                      type="email"
                      name="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      maxLength={254}
                      disabled={!hydrated || busy}
                    />
                  )}
                  {isOtp && (
                    <div className={styles.otp}>
                      <label
                        htmlFor="otp-code"
                        className={isRecovery ? styles.otpLabel : styles.srOnly}
                      >
                        {isRecovery ? RECOVERY_CODE_LABEL : t.code}
                      </label>
                      {/* One field: iOS and Android autofill the whole code into it. */}
                      <input
                        ref={codeRef}
                        id="otp-code"
                        name="one-time-code"
                        type="text"
                        value={code}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern={`[0-9]{${OTP_LENGTH}}`}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        required
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? "auth-error" : undefined}
                        disabled={!hydrated}
                        // Read-only while sending keeps the keyboard open on mobile.
                        readOnly={busy}
                        onChange={(event) => updateCode(event.target.value)}
                        onPaste={(event) => {
                          event.preventDefault();
                          updateCode(event.clipboardData.getData("text"));
                        }}
                      />
                    </div>
                  )}
                  {isPassword && (
                    <>
                      <Field
                        icon={<LockKeyhole size={21} />}
                        label={RECOVERY_NEW_PASSWORD}
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
                        icon={<LockKeyhole size={21} />}
                        label={RECOVERY_CONFIRM_PASSWORD}
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
                    </>
                  )}
                </div>
                {isLogin && (
                  <div className={styles.options}>
                    <label className={styles.remember}>
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(event) => setRemember(event.target.checked)}
                        disabled={!hydrated || busy}
                      />
                      {t.remember}
                    </label>
                    <Link
                      className={styles.link}
                      href={
                        entrypoint === "panel"
                          ? "/panel/recuperar"
                          : "/recuperar-contrasena?entrypoint=client"
                      }
                      onClick={() => {
                        // The address typed here goes with the student, who gets the code at once.
                        if (entrypoint === "client")
                          handRecoveryEmail(
                            normalizeIdentifier(email, usernameDomain),
                          );
                      }}
                    >
                      {t.forgot}
                    </Link>
                  </div>
                )}
                {isRegisterEmail && (
                  <p className={styles.note} aria-live="polite">
                    <Info
                      size={20}
                      style={{
                        fill: "var(--color-brand)",
                        stroke: "var(--color-on-color)",
                      }}
                    />
                    {domain.state === "checking"
                      ? t.checking
                      : domain.state === "allowed"
                        ? domain.clientType === "STUDENT"
                          ? t.studentAccount
                          : t.staffAccount
                        : domain.state === "denied"
                          ? t.denied
                          : t.onlyInstitutional}
                  </p>
                )}
                {isPassword && (
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
                          <CheckCircle2 size={20} />
                          {rule}
                          <span className={styles.srOnly}>
                            {passwordRules(password)[index] ? " ✓" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {isOtp && (
                  <p className={styles.resend}>
                    {t.validity}
                    <br />
                    {t.notReceived}
                    <br />
                    <button
                      className={styles.link}
                      type="button"
                      disabled={
                        !hydrated ||
                        busy ||
                        countdown > 0 ||
                        resends >= MAX_RESENDS
                      }
                      onClick={() => resend()}
                    >
                      {isRecovery ? (
                        countdown > 0 ? (
                          recoveryResendIn(countdown)
                        ) : (
                          RECOVERY_RESEND
                        )
                      ) : (
                        <>
                          {t.resend}
                          {countdown > 0 &&
                            ` (${String(Math.floor(countdown / 60)).padStart(2, "0")}:${String(countdown % 60).padStart(2, "0")})`}
                        </>
                      )}
                    </button>
                    {resends >= MAX_RESENDS && (
                      <>
                        <br />
                        {t.resendLimit}
                      </>
                    )}
                  </p>
                )}
                {error && (
                  <p
                    id="auth-error"
                    className={styles.error}
                    role="alert"
                    aria-live="assertive"
                  >
                    {error}
                  </p>
                )}
                {unverified && isLogin && (
                  <button
                    className={styles.link}
                    type="button"
                    disabled={!hydrated || busy}
                    onClick={() => resend(true)}
                  >
                    {t.verifyLink}
                  </button>
                )}
                {notice && (
                  <p className={styles.success} role="status">
                    {notice}
                  </p>
                )}
                <button
                  className={`${styles.primary} ${!isLogin ? (isPassword ? styles.passwordContinue : styles.continue) : ""}`}
                  type="submit"
                  disabled={!hydrated || busy}
                  aria-busy={busy || undefined}
                >
                  {busy && isLogin ? (
                    <span className={styles.loginSpinner} aria-hidden="true" />
                  ) : null}
                  {buttonText}
                  {!busy && <ArrowRight size={21} />}
                </button>
              </form>
              {isLogin && entrypoint === "client" ? (
                <>
                  <div className={styles.divider}>{t.or}</div>
                  <div className={styles.register}>
                    {t.noAccount}
                    <Link href="/registro" className={styles.link}>
                      {t.register}
                    </Link>
                  </div>
                </>
              ) : (
                mode === "register" &&
                entrypoint === "client" && (
                  <ol className={styles.progress} aria-label={t.progress}>
                    {t.steps.map((label, index) => (
                      <li
                        key={label}
                        aria-current={index === step ? "step" : undefined}
                        className={index < step ? styles.complete : ""}
                      >
                        <span className={styles.dot} />
                        <span className={styles.srOnly}>
                          {index + 1}. {label}
                        </span>
                      </li>
                    ))}
                  </ol>
                )
              )}
            </>
          )}
        </div>
        <Waves />
      </div>
    </main>
  );
}
