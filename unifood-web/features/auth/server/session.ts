import "server-only";
import { cache } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import { authClient } from "./client";
import { authConfig } from "./config";
import {
  AuthServiceUnavailableError,
  isTemporaryAuthFailure,
} from "./failures";
import type {
  AuthProfile,
  AuthEntrypoint,
  PendingRegistration,
} from "../validation";
import {
  REGISTRATION_COMPLETE_PATH,
  hasValidBusinessRole,
  loginPath,
} from "../validation";
import { pendingRegistration } from "./registration";

export const getAuth = cache(async () => {
  if (!authConfig()) return null;
  try {
    const client = await authClient();
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error && isTemporaryAuthFailure(error))
      throw new AuthServiceUnavailableError();
    if (error || !user || !user.email_confirmed_at) return null;
    const { data, error: profileError } = await client.rpc(
      "current_auth_profile",
    );
    if (profileError && isTemporaryAuthFailure(profileError))
      throw new AuthServiceUnavailableError();
    if (profileError || !hasValidBusinessRole(data)) return null;
    // Only use getSession after the identity and database profile are verified.
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError && isTemporaryAuthFailure(sessionError))
      throw new AuthServiceUnavailableError();
    if (sessionError || !session) return null;
    return { profile: data as AuthProfile, accessToken: session.access_token };
  } catch (error) {
    // cookies()/no-store fetch can signal dynamic rendering during a Next build.
    unstable_rethrow(error);
    if (isTemporaryAuthFailure(error)) throw new AuthServiceUnavailableError();
    return null;
  }
});

/**
 * The signed-in user's registration waiting for step 2, or null. Any failure counts as
 * "not pending": it can only send someone to the login, never past step 2.
 */
export const getPendingRegistration = cache(
  async (): Promise<PendingRegistration | null> => {
    if (!authConfig()) return null;
    try {
      const client = await authClient();
      const {
        data: { user },
        error,
      } = await client.auth.getUser();
      if (error && isTemporaryAuthFailure(error))
        throw new AuthServiceUnavailableError();
      if (error || !user) return null;
      return await pendingRegistration(client);
    } catch (error) {
      unstable_rethrow(error);
      if (isTemporaryAuthFailure(error))
        throw new AuthServiceUnavailableError();
      return null;
    }
  },
);

export async function requireAuth(entrypoint: AuthEntrypoint = "client") {
  // Context chooses the anonymous return path; each page still checks its role.
  const auth = await getAuth();
  if (!auth) {
    // A pending registration reaches no client screen: only step 2.
    if (entrypoint === "client" && (await getPendingRegistration()))
      redirect(REGISTRATION_COMPLETE_PATH);
    redirect(loginPath(entrypoint));
  }
  return auth;
}
