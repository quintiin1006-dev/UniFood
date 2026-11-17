import "server-only";
import { CURRENT_TERMS_VERSION } from "../legal";

/**
 * "accepted" only when the database says this client accepted CURRENT_TERMS_VERSION.
 * "unavailable" is a read that failed, and it is never treated as accepted: the caller
 * stops at the terms screen and offers a retry (fail closed).
 */
export type TermsState = "accepted" | "pending" | "unavailable";

/**
 * Just the RPC. The caller passes the client bound to its own session, so this module
 * never builds one: the auth route already has one, and importing the Supabase client
 * here would drag it into every caller.
 */
export type TermsReader = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function clientTermsState(
  reader: TermsReader,
): Promise<TermsState> {
  try {
    const { data, error } = await reader.rpc("client_terms_accepted", {
      current_version: CURRENT_TERMS_VERSION,
    });
    if (error) return "unavailable";
    return data === true ? "accepted" : "pending";
  } catch {
    return "unavailable";
  }
}
