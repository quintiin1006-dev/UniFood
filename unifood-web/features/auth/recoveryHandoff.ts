// The address of a student who asks for a recovery code from the login or from «Mi perfil». It
// travels in sessionStorage, never in the URL, so it is not left in the history or in logs.
const KEY = "unifood.recovery.email";

/** Saves the address for the recovery screen; nothing happens if storage is not available. */
export function handRecoveryEmail(address: string) {
  try {
    const value = address.trim().toLowerCase();
    if (value.includes("@")) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* Private browsing: the student types the address on the recovery screen. */
  }
}

/** The address handed over, if any. It is removed once the code is requested. */
export function readRecoveryEmail(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearRecoveryEmail() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* Nothing to clear. */
  }
}
