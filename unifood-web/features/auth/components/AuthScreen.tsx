"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
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
import { PanelAuthHero } from "./PanelAuthHero";
import { useAuthHydration } from "../useAuthHydration";
import styles from "./AuthScreen.module.css";

type Mode = "login" | "register" | "recover";
// Must match Auth's Email OTP expiration of 900 s and the email templates.
const OTP_VALIDITY_MINUTES = 15;
const RESEND_WAIT_SECONDS = 60;
// Supabase also rate-limits; this keeps one screen from spending that budget.
const MAX_RESENDS = 3;
type DomainCheck =
  | { state: "idle" | "checking" | "denied" }
  | { state: "allowed"; clientType: ClientType };
// Firefox-only button attribute, absent from the React types: without it the
// back button sits outside the form and Firefox restores its disabled state.
const NO_FIREFOX_STATE_RESTORE = { autoComplete: "off" };
const copy = {
  es: {
    panelTitle: "Acceso al panel",
    panelNote: "Inicia sesión con tu cuenta de trabajo.",
    panelLabel: "Panel UniFood",
    panelHeading: "Tu cafetería, en un solo lugar.",
    panelDescription:
      "Organiza el trabajo diario y mantén tu operación al día.",
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
  },
  en: {
    panelTitle: "Panel sign in",
    panelNote: "Sign in with your work account.",
    panelLabel: "UniFood panel",
    panelHeading: "Your cafeteria, in one place.",
    panelDescription:
      "Organize your daily work and keep your operation up to date.",
    food: "Your food,",
    noLines: "no waiting",
    tagline: "Order, pick up, and get on with your day.",
    identifier: "Username or institutional email",
    password: "Password",
    confirm: "Confirm password",
    remember: "Keep me signed in",
    forgot: "Forgot your password?",
    login: "Sign in",
    or: "or",
    noAccount: "Don't have an account?",
    register: "Register as a student",
    next: "Continue",
    useEmail: "Use your",
    institutional: "institutional email",
    emailNote: "We'll send you a verification code to confirm your account.",
    onlyInstitutional:
      "Use your @ustavillavo.edu.co or @ustavillavicencio.edu.co email.",
    checking: "Checking your email…",
    studentAccount: "Valid email: student account.",
    staffAccount: "Valid email: faculty or staff account.",
    denied:
      "This email is not enabled. Use your institutional email, without “+”.",
    validity: `The code expires in ${OTP_VALIDITY_MINUTES} minutes.`,
    resendLimit:
      "You already requested several codes. Wait a few minutes and check your email, including spam.",
    createPassword: "Create a",
    secure: "secure password",
    passwordNote: "Use at least 8 characters.",
    include: "Your password must include:",
    rules: [
      "At least 8 characters",
      "An uppercase letter",
      "A lowercase letter",
      "A number",
    ],
    verify: "Verify",
    yourEmail: "your email",
    sent: "We sent a 6-digit code to",
    notReceived: "Didn't receive a code?",
    resend: "Resend code",
    verifyButton: "Verify",
    code: "Verification code",
    recovery: "Recover your",
    account: "account",
    recoveryNote: "Enter your institutional email to reset your password.",
    sendCode: "Send code",
    reset: "Reset password",
    resetDone: "Your password was updated. You can now sign in.",
    wait: "One moment…",
    back: "Go back",
    show: "Show password",
    hide: "Hide password",
    progress: "Registration progress",
    steps: ["Institutional email", "Verification", "Your details"],
    invalidEmail: "Enter a valid institutional email.",
    invalidPassword:
      "Your password must meet the requirements and contain no more than 128 characters.",
    mismatch: "Passwords do not match.",
    invalidCode: "Enter all 6 digits of the code.",
    connection: "Unable to connect. Check your connection and try again.",
    resendDone: "A new code was sent. Check your spam folder too.",
    verifyLink: "Verify my email",
    recoverySent:
      "If an account exists with this email, you'll receive a recovery code.",
  },
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
  const [language, setLanguage] = useState<"es" | "en">("es");
  const t = copy[language];
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
  const isPassword = isRecovery && step === 2;

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
    if (!isOtp || !hydrated || code.length !== OTP_LENGTH) return;
    if (autoSubmitted.current === code || inFlight.current) return;
    autoSubmitted.current = code;
    formRef.current?.requestSubmit();
  }, [code, isOtp, hydrated]);

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

  function startCountdown() {
    setResendAt(Date.now() + RESEND_WAIT_SECONDS * 1000);
    setCountdown(RESEND_WAIT_SECONDS);
  }
  function next() {
    setStep((current) => current + 1);
    setError("");
    setNotice("");
  }
  function navigate(path: string) {
    window.location.assign(path);
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
        navigate(data.redirect);
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
        if (data.redirect) navigate(data.redirect);
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
        await request("recover", { email });
        setEmail(email.trim().toLowerCase());
        setResends(0);
        next();
        startCountdown();
        setNotice(t.recoverySent);
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
      startCountdown();
      setNotice(t.resendDone);
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

  const title = isLogin ? (
    entrypoint === "panel" ? (
      t.panelTitle
    ) : (
      <>
        {t.food}
        <br />
        <em>{t.noLines}</em>
      </>
    )
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
  const description = isLogin ? (
    entrypoint === "panel" ? (
      t.panelNote
    ) : (
      t.tagline
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
    ? t.wait
    : isLogin
      ? t.login
      : isOtp
        ? t.verifyButton
        : isRecovery
          ? step === 0
            ? t.sendCode
            : t.reset
          : t.next;

  return (
    <main
      className={`${styles.screen} ${entrypoint === "panel" ? `${styles.panelScreen} ${styles.panelLogin}` : ""}`}
      lang={language}
    >
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
              {entrypoint === "client" && (
                <label className={styles.language}>
                  <span className={styles.srOnly}>Idioma / Language</span>
                  <select
                    value={language}
                    onChange={(event) =>
                      setLanguage(event.target.value as "es" | "en")
                    }
                  >
                    <option value="es">Español</option>
                    <option value="en">English</option>
                  </select>
                  <ChevronDown size={17} />
                </label>
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
                    language={language}
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
                    language={language}
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
              {(isRegisterEmail || (isRecovery && step === 0)) && (
                <Field
                  language={language}
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
              {isPassword && (
                <>
                  <Field
                    language={language}
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
                    language={language}
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
                </>
              )}
              {isOtp && (
                <div className={styles.otp}>
                  <label htmlFor="otp-code" className={styles.srOnly}>
                    {t.code}
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
                >
                  {t.forgot}
                </Link>
              </div>
            )}
            {isRegisterEmail && (
              <p className={styles.note} aria-live="polite">
                <Info size={20} fill="#0064ff" color="white" />
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
                      <CheckCircle2 size={14} />
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
                    !hydrated || busy || countdown > 0 || resends >= MAX_RESENDS
                  }
                  onClick={() => resend()}
                >
                  {t.resend}
                  {countdown > 0 &&
                    ` (${String(Math.floor(countdown / 60)).padStart(2, "0")}:${String(countdown % 60).padStart(2, "0")})`}
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
            >
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
        </div>
        <Waves />
      </div>
    </main>
  );
}
