import type { SupabaseClient } from "@supabase/supabase-js";
import { validEmail, validPassword } from "@/features/auth/validation";
import { RecoveryError, recoveryFailure } from "./errors";

type RecoveryAuth = Pick<
  SupabaseClient["auth"],
  | "resetPasswordForEmail"
  | "exchangeCodeForSession"
  | "getUser"
  | "updateUser"
  | "signOut"
  | "onAuthStateChange"
>;

/** Supabase issues/verifies the proof. This flow never reads roles or business data. */
export class PanelRecoveryFlow {
  private auth: RecoveryAuth | null = null;
  private verifiedUser: string | null = null;
  private passwordUpdated = false;
  constructor(
    private readonly client: () => RecoveryAuth,
    private readonly closePanelSession: () => Promise<void>,
  ) {}
  private provider() {
    return (this.auth ??= this.client());
  }

  async request(email: string, origin: string) {
    email = email.trim().toLowerCase();
    if (!validEmail(email)) throw new RecoveryError("email");
    try {
      const { error } = await this.provider().resetPasswordForEmail(email, {
        redirectTo: new URL("/panel/nueva-contrasena", origin).href,
      });
      if (error) {
        // Account-specific 4xx responses must not disclose whether an address exists.
        if (
          error.status &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429 &&
          !error.code?.includes("rate_limit")
        )
          return;
        throw recoveryFailure(error, "request");
      }
    } catch (error) {
      throw error instanceof RecoveryError
        ? error
        : new RecoveryError("temporary");
    }
  }

  async verify(code: string | null) {
    this.verifiedUser = null;
    if (!code || !/^[A-Za-z0-9_-]{8,2048}$/.test(code))
      throw new RecoveryError("invalid");
    try {
      let recoveryUser: string | null = null;
      const { data: listener } = this.provider().onAuthStateChange(
        (event, session) => {
          if (event === "PASSWORD_RECOVERY")
            recoveryUser = session?.user.id ?? null;
        },
      );
      const { data, error } = await this.provider()
        .exchangeCodeForSession(code)
        .finally(() => listener.subscription.unsubscribe());
      if (error) throw recoveryFailure(error, "verify");
      if (!data.session || !data.user || recoveryUser !== data.user.id) {
        await this.provider().signOut({ scope: "local" });
        throw new RecoveryError("invalid");
      }
      const identity = await this.provider().getUser();
      if (identity.error) throw recoveryFailure(identity.error, "verify");
      if (identity.data.user?.id !== data.user.id)
        throw new RecoveryError("invalid");
      this.verifiedUser = data.user.id;
    } catch (error) {
      throw error instanceof RecoveryError
        ? error
        : new RecoveryError("temporary");
    }
  }

  async update(password: string) {
    if (!this.verifiedUser || this.passwordUpdated)
      throw new RecoveryError("invalid");
    if (!validPassword(password)) throw new RecoveryError("password");
    try {
      const identity = await this.provider().getUser();
      if (identity.error) throw recoveryFailure(identity.error, "update");
      if (identity.data.user?.id !== this.verifiedUser)
        throw new RecoveryError("invalid");
      const { error } = await this.provider().updateUser({ password });
      if (error) throw recoveryFailure(error, "update");
      this.passwordUpdated = true;
    } catch (error) {
      throw error instanceof RecoveryError
        ? error
        : new RecoveryError("temporary");
    }
  }

  async finish() {
    if (!this.passwordUpdated) throw new RecoveryError("invalid");
    try {
      const { error } = await this.provider().signOut({ scope: "global" });
      if (
        error &&
        error.status !== 401 &&
        error.status !== 403 &&
        error.code !== "session_not_found"
      )
        throw new RecoveryError("temporary");
      await this.closePanelSession();
      this.verifiedUser = null;
    } catch {
      throw new RecoveryError("temporary");
    }
  }
}
