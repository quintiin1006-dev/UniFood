import "server-only";
import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { authClient } from "./client";
import { authConfig } from "./config";
import {
  AuthServiceUnavailableError,
  isTemporaryAuthFailure,
} from "./failures";

/** Provider identity only. Business activity, roles and assignments are separate. */
export const getVerifiedAuthIdentity = cache(async () => {
  if (!authConfig()) return null;
  const writes: (() => void)[] = [];
  const commitCookies = () => writes.forEach((write) => write());
  try {
    const client = await authClient(undefined, undefined, (write) =>
      writes.push(write),
    );
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error && isTemporaryAuthFailure(error))
      throw new AuthServiceUnavailableError();
    if (error || !user || !user.email_confirmed_at) {
      commitCookies();
      return null;
    }
    // getUser verifies identity with Auth; getSession supplies only its bearer.
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError && isTemporaryAuthFailure(sessionError))
      throw new AuthServiceUnavailableError();
    if (
      sessionError ||
      !session ||
      session.user?.id !== user.id ||
      typeof user.id !== "string" ||
      !user.id ||
      typeof user.email !== "string" ||
      typeof session.access_token !== "string" ||
      !session.access_token.trim()
    ) {
      commitCookies();
      return null;
    }
    commitCookies();
    return {
      id: user.id,
      email: user.email,
      accessToken: session.access_token,
    };
  } catch (error) {
    unstable_rethrow(error);
    // Discard even SDK deletion attempts when verification failed temporarily.
    if (isTemporaryAuthFailure(error)) throw new AuthServiceUnavailableError();
    commitCookies();
    return null;
  }
});
