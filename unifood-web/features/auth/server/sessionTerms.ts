import "server-only";
import { authClient } from "./client";
import { clientTermsState, type TermsReader, type TermsState } from "./terms";

/**
 * The terms state of the signed-in session, for Server Components and the BFF. The auth
 * route calls clientTermsState directly with the client it already built.
 */
export async function sessionTermsState(): Promise<TermsState> {
  try {
    return await clientTermsState(
      (await authClient()) as unknown as TermsReader,
    );
  } catch {
    return "unavailable";
  }
}
