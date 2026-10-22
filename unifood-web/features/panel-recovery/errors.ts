export const RECOVERY_MESSAGES = {
  neutral:
    "Si existe una cuenta asociada a ese correo, recibirás las instrucciones para restablecer tu contraseña.",
  temporary:
    "No pudimos completar la solicitud en este momento. Inténtalo nuevamente.",
  invalid:
    "El enlace de recuperación venció o ya fue utilizado. Solicita uno nuevo.",
  rate: "Demasiadas solicitudes. Espera unos minutos antes de volver a intentarlo.",
  email: "Ingresa un correo válido.",
  mismatch: "Las contraseñas no coinciden.",
  password:
    "La contraseña debe tener entre 8 y 128 caracteres, mayúscula, minúscula y número.",
  weak: "La contraseña no cumple los requisitos de seguridad. Elige una contraseña más segura.",
  same: "Elige una contraseña diferente a la anterior.",
  success:
    "Tu contraseña se actualizó correctamente. Inicia sesión con tu nueva contraseña.",
} as const;
export class RecoveryError extends Error {
  constructor(readonly kind: keyof typeof RECOVERY_MESSAGES) {
    super(RECOVERY_MESSAGES[kind]);
    this.name = "RecoveryError";
  }
}
export function recoveryFailure(
  error: unknown,
  stage: "request" | "verify" | "update",
) {
  const value =
    error && typeof error === "object"
      ? (error as { status?: number; code?: string; name?: string })
      : {};
  if (value.status === 429 || value.code?.includes("rate_limit"))
    return new RecoveryError("rate");
  if (
    (value.status && value.status >= 500) ||
    value.name === "AuthRetryableFetchError" ||
    value.name === "TimeoutError"
  )
    return new RecoveryError("temporary");
  if (
    stage === "verify" ||
    value.status === 401 ||
    value.status === 403 ||
    value.code === "session_not_found"
  )
    return new RecoveryError("invalid");
  if (value.code === "weak_password") return new RecoveryError("weak");
  if (value.code === "same_password") return new RecoveryError("same");
  return new RecoveryError("temporary");
}
