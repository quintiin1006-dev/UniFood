"use client";

import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Eye, EyeOff, IdCard, Info, LockKeyhole, Mail, UserRound } from "lucide-react";
import { normalizeIdentifier, passwordRules, validDocument, validEmail, validPassword } from "../validation";
import Brand, { Waves } from "./Brand";
import styles from "./AuthScreen.module.css";

type Mode = "login" | "register" | "recover";
const copy = {
  es: {
    food: "Tu comida,", noLines: "sin filas", tagline: "Pide, recoge y sigue con tu día.",
    identifier: "Usuario o correo institucional", password: "Contraseña", confirm: "Confirmar contraseña", remember: "Mantener sesión iniciada", forgot: "¿Olvidaste tu contraseña?", login: "Iniciar sesión", or: "o", noAccount: "¿No tienes una cuenta?", register: "Registrarse como estudiante",
    create: "Crea tu cuenta", createNote: "Solo necesitas unos datos para comenzar.", name: "Nombre completo", document: "Número de documento", next: "Continuar",
    useEmail: "Usa tu correo", institutional: "institucional", emailNote: "Te enviaremos un código de verificación para confirmar tu cuenta.", onlyInstitutional: "Usa tu correo @ustavillavo.edu.co o @ustavillavicencio.edu.co.",
    createPassword: "Crea una contraseña", secure: "segura", passwordNote: "Debe tener al menos 8 caracteres.", include: "Tu contraseña debe incluir:", rules: ["Mínimo 8 caracteres", "Una letra mayúscula", "Una letra minúscula", "Un número"],
    verify: "Verifica", yourEmail: "tu correo", sent: "Te enviamos un código de 6 dígitos a", notReceived: "¿No recibiste el código?", resend: "Reenviar código", verifyButton: "Verificar", code: "Código de verificación", digit: "Dígito",
    recovery: "Recupera tu", account: "cuenta", recoveryNote: "Ingresa tu correo institucional para restablecer tu contraseña.", sendCode: "Enviar código", reset: "Restablecer contraseña", resetDone: "Tu contraseña se actualizó. Ya puedes iniciar sesión.",
    wait: "Un momento…", back: "Volver", show: "Mostrar contraseña", hide: "Ocultar contraseña", progress: "Progreso del registro", steps: ["Datos personales", "Correo institucional", "Contraseña", "Verificación"],
    invalidName: "Escribe tu nombre completo (entre 3 y 150 caracteres).", invalidDocument: "Escribe un documento de 5 a 30 caracteres, sin espacios ni puntos.", invalidEmail: "Escribe un correo institucional válido.", invalidPassword: "La contraseña debe cumplir los requisitos y no superar 128 caracteres.", mismatch: "Las contraseñas no coinciden.", invalidCode: "Ingresa los 6 dígitos del código.", connection: "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.", resendDone: "Enviamos un nuevo código. Revisa también tu carpeta de spam.", verifyLink: "Verificar mi correo", recoverySent: "Si existe una cuenta con este correo, recibirás un código para recuperar el acceso.",
  },
  en: {
    food: "Your food,", noLines: "no waiting", tagline: "Order, pick up, and get on with your day.",
    identifier: "Username or institutional email", password: "Password", confirm: "Confirm password", remember: "Keep me signed in", forgot: "Forgot your password?", login: "Sign in", or: "or", noAccount: "Don't have an account?", register: "Register as a student",
    create: "Create your account", createNote: "Just a few details to get started.", name: "Full name", document: "Document number", next: "Continue",
    useEmail: "Use your", institutional: "institutional email", emailNote: "We'll send you a verification code to confirm your account.", onlyInstitutional: "Use your @ustavillavo.edu.co or @ustavillavicencio.edu.co email.",
    createPassword: "Create a", secure: "secure password", passwordNote: "Use at least 8 characters.", include: "Your password must include:", rules: ["At least 8 characters", "An uppercase letter", "A lowercase letter", "A number"],
    verify: "Verify", yourEmail: "your email", sent: "We sent a 6-digit code to", notReceived: "Didn't receive a code?", resend: "Resend code", verifyButton: "Verify", code: "Verification code", digit: "Digit",
    recovery: "Recover your", account: "account", recoveryNote: "Enter your institutional email to reset your password.", sendCode: "Send code", reset: "Reset password", resetDone: "Your password was updated. You can now sign in.",
    wait: "One moment…", back: "Go back", show: "Show password", hide: "Hide password", progress: "Registration progress", steps: ["Personal details", "Institutional email", "Password", "Verification"],
    invalidName: "Enter your full name (3 to 150 characters).", invalidDocument: "Enter a document number with 5 to 30 characters, without spaces or dots.", invalidEmail: "Enter a valid institutional email.", invalidPassword: "Your password must meet the requirements and contain no more than 128 characters.", mismatch: "Passwords do not match.", invalidCode: "Enter all 6 digits of the code.", connection: "Unable to connect. Check your connection and try again.", resendDone: "A new code was sent. Check your spam folder too.", verifyLink: "Verify my email", recoverySent: "If an account exists with this email, you'll receive a recovery code.",
  },
};

function Field({ icon, label, password = false, language, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode; label: string; password?: boolean; language: "es" | "en" }) {
  const [visible, setVisible] = useState(false);
  return <label className={styles.field}>
    {icon}<span className={styles.srOnly}>{label}</span>
    <input {...props} aria-label={label} placeholder={label} type={password ? visible ? "text" : "password" : props.type || "text"} />
    {password && <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? copy[language].hide : copy[language].show} aria-pressed={visible}>
      {visible ? <Eye size={21} /> : <EyeOff size={21} />}
    </button>}
  </label>;
}

export default function AuthScreen({ initialMode, usernameDomain }: { initialMode: Mode; usernameDomain: string }) {
  const [language, setLanguage] = useState<"es" | "en">("es");
  const t = copy[language];
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [document, setDocument] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isLogin = mode === "login";
  const isRecovery = mode === "recover";
  const isOtp = (mode === "register" && step === 3) || (isRecovery && step === 1);
  const isPassword = !isLogin && step === 2;

  useEffect(() => {
    if (!resendAt) return;
    const tick = () => setCountdown(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  useEffect(() => {
    if (step > 0) headingRef.current?.focus();
  }, [step]);

  async function request(action: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) {
      if (data.code === "email_not_confirmed") setUnverified(true);
      throw new Error(data.message || t.connection);
    }
    return data;
  }

  function startCountdown() { setResendAt(Date.now() + 60_000); setCountdown(60); }
  function next() { setStep((current) => current + 1); setError(""); setNotice(""); }
  function navigate(path: string) { window.location.assign(path); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      if (isLogin) {
        setUnverified(false);
        const data = await request("login", { email, password, remember });
        navigate(data.redirect);
      } else if (isOtp) {
        if (!/^\d{6}$/.test(code.join(""))) throw new Error(t.invalidCode);
        const data = await request("verify", { email, code: code.join(""), recovery: isRecovery });
        if (isRecovery) { setPassword(""); setConfirm(""); next(); }
        else navigate(data.redirect);
      } else if (isPassword) {
        if (!validPassword(password)) throw new Error(t.invalidPassword);
        if (password !== confirm) throw new Error(t.mismatch);
        if (isRecovery) {
          await request("reset", { password });
          setMode("login"); setStep(0); setPassword(""); setConfirm(""); setNotice(t.resetDone);
        } else {
          await request("register", { fullName, document, email, password });
          setPassword(""); setConfirm(""); startCountdown(); next();
        }
      } else if (mode === "register" && step === 0) {
        if (fullName.trim().length < 3 || fullName.trim().length > 150) throw new Error(t.invalidName);
        if (!validDocument(document.trim())) throw new Error(t.invalidDocument);
        next();
      } else {
        if (!validEmail(email.trim())) throw new Error(t.invalidEmail);
        await request(isRecovery ? "recover" : "institution", { email });
        setEmail(email.trim().toLowerCase());
        next();
        if (isRecovery) { startCountdown(); setNotice(t.recoverySent); }
      }
    } catch (err) { setError(err instanceof Error ? err.message : t.connection); }
    finally { setBusy(false); }
  }

  async function resend(fromLogin = false) {
    if (busy || (!fromLogin && countdown > 0)) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      const normalized = normalizeIdentifier(email, usernameDomain);
      await request("resend", { email: normalized, recovery: isRecovery });
      setEmail(normalized); setCode(Array(6).fill("")); startCountdown(); setNotice(t.resendDone);
      if (fromLogin) { setMode("register"); setStep(3); setPassword(""); setUnverified(false); }
    } catch (err) { setError(err instanceof Error ? err.message : t.connection); }
    finally { setBusy(false); }
  }

  function back() {
    if (busy) return;
    setError(""); setNotice("");
    if (isOtp || step === 0) navigate("/login");
    else { setStep((current) => current - 1); setPassword(""); setConfirm(""); }
  }

  function updateCode(value: string, index: number) {
    const digits = value.replace(/\D/g, "").slice(0, 6 - index);
    setCode((previous) => {
      const updated = [...previous];
      if (!digits) updated[index] = "";
      for (let i = 0; i < digits.length; i++) updated[index + i] = digits[i];
      return updated;
    });
    if (digits) otpRefs.current[Math.min(index + digits.length, 5)]?.focus();
  }

  const title = isLogin ? <>{t.food}<br /><em>{t.noLines}</em></>
    : isOtp ? <>{t.verify} <em>{t.yourEmail}</em></>
    : isPassword ? <>{t.createPassword}<br /><em>{t.secure}</em></>
    : isRecovery ? <>{t.recovery}<br /><em>{t.account}</em></>
    : step === 0 ? t.create : <>{t.useEmail}<br /><em>{t.institutional}</em></>;
  const description = isLogin ? t.tagline : isOtp ? <>{t.sent}<span className={styles.email}>{email}</span></>
    : isPassword ? t.passwordNote : isRecovery ? t.recoveryNote : step === 0 ? t.createNote : t.emailNote;
  const buttonText = busy ? t.wait : isLogin ? t.login : isOtp ? t.verifyButton : isRecovery ? step === 0 ? t.sendCode : t.reset : t.next;

  return <main className={styles.screen} lang={language}>
    <div className={styles.canvas}>
      <div className={styles.content}>
        <div className={styles.topbar}>
          {!isLogin && <button type="button" className={styles.back} onClick={back} disabled={busy} aria-label={t.back}><ArrowLeft size={23} /></button>}
          <label className={styles.language}>
            <span className={styles.srOnly}>Idioma / Language</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as "es" | "en")}><option value="es">Español</option><option value="en">English</option></select>
            <ChevronDown size={17} />
          </label>
        </div>
        <Brand large={isLogin} />
        <h1 ref={headingRef} tabIndex={-1} className={`${styles.heading} ${isLogin ? styles.hero : ""}`}>{title}</h1>
        <p className={styles.description}>{description}</p>
        <form onSubmit={submit} className={`${styles.form} ${isLogin ? styles.loginForm : ""}`} aria-busy={busy}>
          <div className={styles.fields}>
            {isLogin && <>
              <Field language={language} icon={<Mail size={21} />} label={t.identifier} name="username" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} disabled={busy} />
              <Field language={language} icon={<LockKeyhole size={21} />} label={t.password} password name="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required maxLength={128} disabled={busy} />
            </>}
            {mode === "register" && step === 0 && <>
              <Field language={language} icon={<UserRound size={21} />} label={t.name} name="name" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required minLength={3} maxLength={150} disabled={busy} />
              <Field language={language} icon={<IdCard size={21} />} label={t.document} name="document" value={document} onChange={(event) => setDocument(event.target.value)} required minLength={5} maxLength={30} disabled={busy} />
            </>}
            {((mode === "register" && step === 1) || (isRecovery && step === 0)) && <Field language={language} icon={<Mail size={21} />} label={`usuario@${usernameDomain}`} aria-label={t.institutional} type="email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} disabled={busy} />}
            {isPassword && <>
              <Field language={language} icon={<LockKeyhole size={21} />} label={t.password} password name="new-password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} disabled={busy} aria-describedby="password-rules" />
              <Field language={language} icon={<LockKeyhole size={21} />} label={t.confirm} password name="confirm-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} disabled={busy} />
            </>}
            {isOtp && <fieldset className={styles.otp}>
              <legend className={styles.srOnly}>{t.code}</legend>
              {code.map((digit, index) => <input key={index} ref={(element) => { otpRefs.current[index] = element; }} value={digit} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} aria-label={`${t.digit} ${index + 1}`} disabled={busy} onChange={(event) => updateCode(event.target.value, index)} onFocus={(event) => event.target.select()} onPaste={(event) => { event.preventDefault(); updateCode(event.clipboardData.getData("text"), index); }} onKeyDown={(event) => {
                if (event.key === "Backspace" && !digit && index > 0) { event.preventDefault(); setCode((previous) => previous.map((value, i) => i === index - 1 ? "" : value)); otpRefs.current[index - 1]?.focus(); }
                if (event.key === "ArrowLeft" && index > 0) otpRefs.current[index - 1]?.focus();
                if (event.key === "ArrowRight" && index < 5) otpRefs.current[index + 1]?.focus();
              }} />)}
            </fieldset>}
          </div>
          {isLogin && <div className={styles.options}>
            <label className={styles.remember}><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={busy} />{t.remember}</label>
            <Link className={styles.link} href="/recuperar-contrasena">{t.forgot}</Link>
          </div>}
          {mode === "register" && step === 1 && <p className={styles.note}><Info size={20} fill="#0064ff" color="white" />{t.onlyInstitutional}</p>}
          {isPassword && <div id="password-rules" className={styles.requirements}><p>{t.include}</p><ul>{t.rules.map((rule, index) => <li key={rule} className={passwordRules(password)[index] ? styles.passed : ""}><CheckCircle2 size={14} />{rule}<span className={styles.srOnly}>{passwordRules(password)[index] ? " ✓" : ""}</span></li>)}</ul></div>}
          {isOtp && <p className={styles.resend}>{t.notReceived}<br /><button className={styles.link} type="button" disabled={busy || countdown > 0} onClick={() => resend()}>{t.resend}{countdown > 0 && ` (${String(Math.floor(countdown / 60)).padStart(2, "0")}:${String(countdown % 60).padStart(2, "0")})`}</button></p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {unverified && isLogin && <button className={styles.link} type="button" disabled={busy} onClick={() => resend(true)}>{t.verifyLink}</button>}
          {notice && <p className={styles.success} role="status">{notice}</p>}
          <button className={`${styles.primary} ${!isLogin ? isPassword ? styles.passwordContinue : styles.continue : ""}`} type="submit" disabled={busy}>{buttonText}{!busy && <ArrowRight size={21} />}</button>
        </form>
        {isLogin ? <>
          <div className={styles.divider}>{t.or}</div>
          <div className={styles.register}>{t.noAccount}<Link href="/registro" className={styles.link}>{t.register}</Link></div>
        </> : mode === "register" && <ol className={styles.progress} aria-label={t.progress}>{t.steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className={index < step ? styles.complete : ""}><span className={styles.dot} /><span className={styles.srOnly}>{index + 1}. {label}</span></li>)}</ol>}
      </div>
      <Waves />
    </div>
  </main>;
}
