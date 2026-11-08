import { cookies } from "next/headers";
import { authClient, clearAuthCookies } from "@/features/auth/server/client";
import {
  isTemporaryAuthFailure,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import {
  authConfig,
  rememberCookie,
  sessionCookieOptions,
} from "@/features/auth/server/config";
import {
  DEFAULT_USERNAME_DOMAIN,
  REGISTRATION_COMPLETE_PATH,
  destination,
  hasValidBusinessRole,
  canUseEntrypoint,
  parseEntrypoint,
  loginPath,
  normalizeIdentifier,
  sameOrigin,
  validEmail,
  validFullName,
  validInstitutionalCode,
  validPassword,
  validRegistrationEmail,
} from "@/features/auth/validation";
import {
  generateSignupPassword,
  pendingRegistration,
  registrationErrorCode,
  registrationFailure,
} from "@/features/auth/server/registration";

const actions = new Set([
  "login",
  "register",
  "rules",
  "complete",
  "verify",
  "resend",
  "recover",
  "reset",
  "logout",
]);
const json = (data: object, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message: string, status = 400, code?: string) =>
  json({ message, code }, status);
const failRegistration = (code: string) => {
  const failure = registrationFailure(code);
  return fail(failure.message, failure.status, failure.code);
};
const passwordRuleMessage =
  "La contraseña debe tener entre 8 y 128 caracteres, mayúscula, minúscula y número.";

function providerError(error: {
  code?: string;
  status?: number;
  name?: string;
}) {
  if (error.status === 429 || error.code?.includes("rate_limit"))
    return fail(
      "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
      429,
    );
  if (error.code === "email_not_confirmed")
    return fail(
      "Verifica tu correo antes de iniciar sesión.",
      403,
      "email_not_confirmed",
    );
  if (error.code === "invalid_credentials")
    return fail("El usuario o la contraseña no son correctos.", 401);
  if (error.code === "otp_expired")
    return fail("El código no es válido o ya venció. Solicita uno nuevo.");
  if (error.code === "same_password")
    return fail("Elige una contraseña diferente a la anterior.");
  if (error.code === "weak_password")
    return fail("La contraseña no cumple los requisitos de seguridad.");
  return fail(
    "No pudimos completar la solicitud. Revisa los datos o vuelve a intentarlo.",
    error.name === "AuthRetryableFetchError" ||
      (error.status && error.status >= 500)
      ? 502
      : 400,
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  if (!sameOrigin(request))
    return fail("Origen de solicitud no permitido.", 403);
  const { action } = await context.params;
  if (!actions.has(action)) return fail("Ruta no disponible.", 404);
  if (!authConfig())
    return fail(
      "El servicio de acceso aún no está configurado. Contacta al administrador.",
      503,
    );
  const cookiesWritten = new Set<string>();
  let client: Awaited<ReturnType<typeof authClient>> | undefined;
  let authenticated = false;
  async function discardSession() {
    try {
      await client?.auth.signOut({ scope: "local" });
    } catch {
      /* Still erase this attempt's cookies when the provider is unavailable. */
    }
    await clearAuthCookies(cookiesWritten);
    authenticated = false;
  }
  try {
    const raw = await request.text();
    if (raw.length > 4096) return fail("Solicitud demasiado grande.", 413);
    const body = JSON.parse(raw || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body))
      return fail("Solicitud no válida.");
    const entrypoint = parseEntrypoint(body.entrypoint);
    if (!entrypoint) return fail("Entrada de acceso no válida.");
    if (
      entrypoint === "panel" &&
      (action === "recover" ||
        action === "reset" ||
        ((action === "verify" || action === "resend") &&
          body.recovery === true))
    )
      return fail(
        "Solicita un enlace desde la recuperación del panel.",
        400,
        "PANEL_RECOVERY_LINK_REQUIRED",
      );
    if (
      (action === "register" || action === "rules" || action === "complete") &&
      entrypoint !== "client"
    )
      return fail("El registro está disponible en el acceso de estudiantes.");
    const value = (key: string) =>
      typeof body[key] === "string" ? (body[key] as string) : "";
    const remember =
      action === "login"
        ? body.remember === true
        : action === "verify" &&
            body.recovery !== true &&
            typeof body.remember === "boolean"
          ? body.remember
          : undefined;
    client = await authClient(remember, (names) =>
      names.forEach((name) => cookiesWritten.add(name)),
    );
    const email =
      action === "rules" || action === "register"
        ? value("email").trim().toLowerCase()
        : normalizeIdentifier(
            value("email"),
            process.env.AUTH_USERNAME_DOMAIN || DEFAULT_USERNAME_DOMAIN,
          );
    const password = value("password");

    if (action === "logout") {
      const { error } = await client.auth.signOut({ scope: "local" });
      await clearAuthCookies(cookiesWritten);
      if (error && error.status !== 403 && error.code !== "session_not_found")
        return providerError(error);
      return json({ redirect: loginPath(entrypoint) });
    }
    if (action === "complete") {
      // Step 2 (docs/decisiones.md §3), with the session from the emailed code.
      const fullName = value("fullName").trim();
      const code = value("code").trim();
      if (!validFullName(fullName))
        return failRegistration("REGISTRATION_INVALID_NAME");
      if (body.privacy !== true)
        return failRegistration("REGISTRATION_PRIVACY_REQUIRED");
      if (!validPassword(password)) return fail(passwordRuleMessage);
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();
      if (userError && isTemporaryAuthFailure(userError))
        return temporaryAuthResponse();
      if (userError || !user)
        return failRegistration("REGISTRATION_NOT_AUTHENTICATED");
      const pending = await pendingRegistration(client);
      if (!pending) return failRegistration("REGISTRATION_NOT_PENDING");
      if (!pending.emailConfirmed)
        return failRegistration("REGISTRATION_EMAIL_NOT_CONFIRMED");
      if (!validInstitutionalCode(code, pending))
        return failRegistration("REGISTRATION_INVALID_CODE");
      // 1. Replace the step 1 password. On a retry it is already this one, and Auth
      //    answers same_password: the hash was updated by the earlier attempt.
      const updated = await client.auth.updateUser({ password });
      if (updated.error && updated.error.code !== "same_password")
        return providerError(updated.error);
      // 2. Close every other session before the account becomes usable.
      const others = await client.auth.signOut({ scope: "others" });
      if (others.error) return providerError(others.error);
      // 3. Only now store the profile. On failure the session stays for a retry.
      const completed = await client.rpc("complete_registration", {
        full_name: fullName,
        institutional_code: code || null,
        privacy_accepted: true,
      });
      if (completed.error)
        return failRegistration(registrationErrorCode(completed.error));
      const { data: profile, error } = await client.rpc("current_auth_profile");
      if (error || !canUseEntrypoint(profile, "client"))
        return failRegistration("REGISTRATION_FAILED");
      return json({ redirect: destination(profile) });
    }
    if (action === "reset") {
      if (!validPassword(password)) return fail(passwordRuleMessage);
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();
      if (userError && isTemporaryAuthFailure(userError))
        return temporaryAuthResponse();
      if (userError || !user) {
        await clearAuthCookies(cookiesWritten);
        return fail("Verifica el código para cambiar tu contraseña.", 401);
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) return providerError(error);
      await client.auth.signOut({ scope: "global" });
      await clearAuthCookies(cookiesWritten);
      return json({ redirect: loginPath(entrypoint) });
    }
    if (action === "rules" || action === "register") {
      // Same rule as the database; an invalid address never reaches Supabase.
      const allowed = validRegistrationEmail(email);
      let clientType: unknown = null;
      if (allowed) {
        const { data, error } = await client.rpc("registration_rules", {
          email,
        });
        if (error)
          return fail(
            "No pudimos consultar tu institución. Inténtalo nuevamente.",
            502,
          );
        const rules = data as { allowed?: unknown; clientType?: unknown };
        if (rules?.allowed === true) clientType = rules.clientType;
      }
      const known = clientType === "STUDENT" || clientType === "STAFF";
      // Domain facts only: whether an account exists is never part of the answer.
      if (action === "rules")
        return json(known ? { allowed: true, clientType } : { allowed: false });
      if (!known) return failRegistration("REGISTRATION_DOMAIN_NOT_ALLOWED");
    }
    if (!value("email").trim() || !validEmail(email))
      return fail("Escribe un correo válido.");
    if (action === "register") {
      // Step 1: address only. Name, code and privacy arrive in step 2.
      const { data, error } = await client.auth.signUp({
        email,
        password: generateSignupPassword(),
      });
      // Same answer whether or not the address already had an account.
      if (
        error?.code === "user_already_exists" ||
        error?.code === "email_exists"
      )
        return json({ ok: true });
      if (error) return providerError(error);
      // Confirmation must remain enabled in Supabase; never silently bypass the OTP screen.
      if (data.session) {
        await discardSession();
        return fail(
          "El servicio requiere activar la confirmación de correo. Contacta al administrador.",
          503,
        );
      }
      return json({ ok: true });
    }
    if (action === "recover") {
      const { error } = await client.auth.resetPasswordForEmail(email);
      if (error) return providerError(error);
      return json({ ok: true });
    }
    if (action === "resend") {
      const { error } =
        body.recovery === true
          ? await client.auth.resetPasswordForEmail(email)
          : await client.auth.resend({ type: "signup", email });
      if (error) return providerError(error);
      return json({ ok: true });
    }
    if (action === "verify") {
      if (!/^\d{6}$/.test(value("code")))
        return fail("Ingresa el código de 6 dígitos.");
      const { error } = await client.auth.verifyOtp({
        email,
        token: value("code"),
        type: body.recovery === true ? "recovery" : "signup",
      });
      if (error) return providerError(error);
      authenticated = true;
      if (body.recovery === true) {
        // A registration left before step 2 continues there with this code session.
        if (entrypoint === "client" && (await pendingRegistration(client)))
          return json({ redirect: REGISTRATION_COMPLETE_PATH });
        authenticated = false;
        return json({ ok: true });
      }
    }
    if (action === "login") {
      if (!password || password.length > 128)
        return fail("Escribe tu contraseña.");
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return providerError(error);
      authenticated = true;
    }
    const { data: profile, error } = await client.rpc("current_auth_profile");
    if (
      !error &&
      !hasValidBusinessRole(profile) &&
      entrypoint === "client" &&
      (await pendingRegistration(client))
    ) {
      // Pending step 2: keep this session; the account has no role yet.
      authenticated = false;
      if (remember !== undefined)
        (await cookies()).set(
          rememberCookie,
          remember ? "1" : "0",
          sessionCookieOptions(!!remember),
        );
      return json({ redirect: REGISTRATION_COMPLETE_PATH });
    }
    if (error || !hasValidBusinessRole(profile)) {
      await discardSession();
      return fail(
        "Tu cuenta no está habilitada. Contacta al administrador.",
        403,
      );
    }
    if (!canUseEntrypoint(profile, entrypoint)) {
      await discardSession();
      return fail(
        "Tu cuenta no tiene acceso desde esta entrada. Usa el acceso correspondiente.",
        403,
      );
    }
    if (remember !== undefined) {
      (await cookies()).set(
        rememberCookie,
        remember ? "1" : "0",
        sessionCookieOptions(!!remember),
      );
    }
    return json({ redirect: destination(profile) });
  } catch (error) {
    if (authenticated) await discardSession();
    if (error instanceof SyntaxError) return fail("Solicitud no válida.");
    return fail(
      "No se pudo conectar con el servicio de acceso. Inténtalo nuevamente.",
      502,
    );
  }
}
