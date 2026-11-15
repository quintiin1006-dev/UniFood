import "server-only";
import { CURRENT_TERMS_VERSION } from "../legal";
import { authClient } from "./client";

/**
 * Whether the signed-in client accepted CURRENT_TERMS_VERSION. A failed read counts as "not
 * accepted", so the dialog asks: it can only add a question, never skip one.
 */
export async function currentTermsAccepted(): Promise<boolean> {
  const client = await authClient();
  const { data, error } = await client.rpc("client_terms_accepted", {
    current_version: CURRENT_TERMS_VERSION,
  });
  return !error && data === true;
}
