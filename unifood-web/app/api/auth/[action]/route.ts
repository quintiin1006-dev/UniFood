import { cookies } from "next/headers";
import { authClient } from "@/features/auth/server/client";
import {
  authConfig,
  rememberCookie,
  sessionCookieOptions,
} from "@/features/auth/server/config";
import {
  DEFAULT_USERNAME_DOMAIN,
  destination,
  hasValidBusinessRole,
  normalizeIdentifier,
  sameOrigin,
  validDocument,
  validEmail,
  validPassword,
} from "@/features/auth/validation";

const actions = new Set([
  "login",
  "register",
  "institution",
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

function providerError(error: { code?: string; status?: number }) {
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
    error.status && error.status >= 500 ? 502 : 400,
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
  try {
    const raw = await request.text();
    if (raw.length > 4096) return fail("Solicitud demasiado grande.", 413);
    const body = JSON.parse(raw || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body))
      return fail("Solicitud no válida.");
    const value = (key: string) =>
      typeof body[key] === "string" ? (body[key] as string) : "";
    const remember = action === "login" ? body.remember === true : undefined;
    const client = await authClient(remember);
    const email =
      action === "institution" || action === "register"
        ? value("email").trim().toLowerCase()
        : normalizeIdentifier(
            value("email"),
            process.env.AUTH_USERNAME_DOMAIN || DEFAULT_USERNAME_DOMAIN,
          );
    const password = value("password");

    if (action === "logout") {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error && error.status !== 403 && error.code !== "session_not_found")
        return providerError(error);
      (await cookies()).delete(rememberCookie);
      return json({ redirect: "/login" });
    }
    if (action === "reset") {
      if (!validPassword(password))
        return fail(
          "La contraseña debe tener entre 8 y 128 caracteres, mayúscula, minúscula y número.",
        );
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();
      if (userError || !user)
        return fail("Verifica el código para cambiar tu contraseña.", 401);
      const { error } = await client.auth.updateUser({ password });
      if (error) return providerError(error);
      await client.auth.signOut({ scope: "global" });
      (await cookies()).delete(rememberCookie);
      return json({ redirect: "/login" });
    }
    if (!value("email").trim() || !validEmail(email))
      return fail("Escribe un correo válido.");
    if (action === "institution" || action === "register") {
      const { data, error } = await client.rpc("is_institutional_email", {
        email,
      });
      if (error)
        return fail(
          "No pudimos consultar tu institución. Inténtalo nuevamente.",
          502,
        );
      if (!data)
        return fail(
          "Solo se permiten correos de instituciones habilitadas en UniFood.",
        );
      if (action === "institution") return json({ ok: true });
    }
    if (action === "register") {
      const fullName = value("fullName").trim();
      const document = value("document").trim();
      if (
        fullName.length < 3 ||
        fullName.length > 150 ||
        !validDocument(document)
      )
        return fail("Revisa tu nombre completo y número de documento.");
      if (!validPassword(password))
        return fail(
          "La contraseña debe tener entre 8 y 128 caracteres, mayúscula, minúscula y número.",
        );
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, document, registration_type: "student" },
        },
      });
      if (error) return providerError(error);
      // Confirmation must remain enabled in Supabase; never silently bypass the OTP screen.
      if (data.session) {
        await client.auth.signOut({ scope: "local" });
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
      if (body.recovery === true) return json({ ok: true });
    }
    if (action === "login") {
      if (!password || password.length > 128)
        return fail("Escribe tu contraseña.");
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return providerError(error);
      (await cookies()).set(
        rememberCookie,
        remember ? "1" : "0",
        sessionCookieOptions(!!remember),
      );
    }
    const { data: profile, error } = await client.rpc("current_auth_profile");
    if (error || !hasValidBusinessRole(profile)) {
      await client.auth.signOut({ scope: "local" });
      return fail(
        "Tu cuenta no está habilitada. Contacta al administrador.",
        403,
      );
    }
    return json({ redirect: destination(profile) });
  } catch (error) {
    if (error instanceof SyntaxError) return fail("Solicitud no válida.");
    return fail(
      "No se pudo conectar con el servicio de acceso. Inténtalo nuevamente.",
      502,
    );
  }
}
