// The address of a student who changes the password from the login or from «Mi perfil». It
// travels in sessionStorage, never in the URL, so it is not left in the history or in logs.
const KEY = "unifood.recovery.email";
const SENT_KEY = "unifood.recovery.sent";

/**
 * Saves the address for the recovery screen. `sent` says the code already went out (from
 * «Mi perfil»), so the screen opens on step 2. Nothing happens if storage is not available.
 */
export function handRecoveryEmail(address: string, sent = false) {
  try {
    const value = address.trim().toLowerCase();
    if (value.includes("@")) {
      sessionStorage.setItem(KEY, value);
      if (sent) sessionStorage.setItem(SENT_KEY, "1");
      else sessionStorage.removeItem(SENT_KEY);
    } else clearRecoveryEmail();
  } catch {
    /* Private browsing: the student types the address on the recovery screen. */
  }
}

/** The address handed over, if any. */
export function readRecoveryEmail(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** True when the code was already sent before reaching the recovery screen. */
export function readRecoverySent(): boolean {
  try {
    return sessionStorage.getItem(SENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearRecoveryEmail() {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(SENT_KEY);
  } catch {
    /* Nothing to clear. */
  }
}
