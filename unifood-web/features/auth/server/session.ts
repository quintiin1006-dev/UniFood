import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { authClient } from "./client";
import { authConfig } from "./config";
import type { AuthProfile, AuthEntrypoint } from "../validation";
import { hasValidBusinessRole, loginPath } from "../validation";

export const getAuth = cache(async () => {
  if (!authConfig()) return null;
  const client = await authClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || !user.email_confirmed_at) return null;
  const { data, error: profileError } = await client.rpc(
    "current_auth_profile",
  );
  if (profileError || !hasValidBusinessRole(data)) return null;
  // Only use getSession after the identity and database profile are verified.
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) return null;
  return { profile: data as AuthProfile, accessToken: session.access_token };
});

export async function requireAuth(entrypoint: AuthEntrypoint = "client") {
  // Context chooses the anonymous return path; each page still checks its role.
  const auth = await getAuth();
  if (!auth) redirect(loginPath(entrypoint));
  return auth;
}
