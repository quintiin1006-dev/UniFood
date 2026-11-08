import "server-only";
import { randomBytes } from "node:crypto";
import {
  parsePendingRegistration,
  type PendingRegistration,
} from "../validation";

/**
 * Step 1 password (docs/decisiones.md §3). Generated here with a CSPRNG, never by the
 * browser, and replaced in step 2. It is never returned, logged or stored. The fixed
 * suffix only satisfies Auth's letters-and-digits policy; the 32 random bytes carry
 * the entropy.
 */
export function generateSignupPassword() {
  return `${randomBytes(32).toString("base64url")}Aa1`;
}

type RpcClient = {
  rpc: (
    name: string,
    params?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** The caller's own pending registration, or null. Errors deny: they never grant step 2. */
export async function pendingRegistration(
  client: RpcClient,
): Promise<PendingRegistration | null> {
  try {
    const { data, error } = await client.rpc("pending_registration");
    return error ? null : parsePendingRegistration(data);
  } catch {
    return null;
  }
}

type Failure = { status: number; message: string; code: string };

// Messages never confirm whether an email or a code exists; CODE_UNAVAILABLE is the
// only one about the code, and the database only raises it inside the caller's step 2.
const registrationFailures: Record<string, Omit<Failure, "code">> = {
  REGISTRATION_DOMAIN_NOT_ALLOWED: {
    status: 400,
    message: "Solo se permiten correos institucionales habilitados en UniFood.",
  },
  REGISTRATION_NOT_AUTHENTICATED: {
    status: 401,
    message:
      "Tu sesión terminó. Usa «¿Olvidaste tu contraseña?» para recibir un código y continuar.",
  },
  REGISTRATION_NOT_PENDING: {
    status: 409,
    message: "Tu registro ya está completo. Inicia sesión para continuar.",
  },
  REGISTRATION_OTP_SESSION_REQUIRED: {
    status: 403,
    message:
      "Para terminar tu registro, entra con un código enviado a tu correo. Usa «¿Olvidaste tu contraseña?» para recibirlo.",
  },
  REGISTRATION_EMAIL_NOT_CONFIRMED: {
    status: 403,
    message: "Verifica tu correo antes de continuar.",
  },
  REGISTRATION_ACCOUNT_DISABLED: {
    status: 403,
    message: "Tu cuenta no está habilitada. Contacta al administrador.",
  },
  REGISTRATION_PASSWORD_CHANGE_REQUIRED: {
    status: 409,
    message: "No pudimos guardar tu contraseña. Inténtalo de nuevo.",
  },
  REGISTRATION_PRIVACY_REQUIRED: {
    status: 400,
    message:
      "Debes aceptar el tratamiento de tus datos personales para continuar.",
  },
  REGISTRATION_INVALID_NAME: {
    status: 400,
    message:
      "Escribe tu nombre completo solo con letras, espacios, apóstrofos, puntos o guiones.",
  },
  REGISTRATION_INVALID_CODE: {
    status: 400,
    message: "Revisa tu código institucional.",
  },
  REGISTRATION_CODE_UNAVAILABLE: {
    status: 409,
    message:
      "Ese código institucional ya está registrado. Si es tuyo, contacta a soporte.",
  },
};

export function registrationFailure(code: string): Failure {
  const known = registrationFailures[code];
  return known
    ? { ...known, code }
    : {
        status: 502,
        code: "REGISTRATION_FAILED",
        message:
          "No pudimos completar tu registro. Inténtalo nuevamente en unos minutos.",
      };
}

/** Reads the REGISTRATION_* code a PostgREST error carries in its message, if any. */
export function registrationErrorCode(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return /\bREGISTRATION_[A-Z_]+\b/.exec(message)?.[0] ?? "";
}
