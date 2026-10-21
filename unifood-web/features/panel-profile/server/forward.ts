import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getVerifiedAuthIdentity } from "@/features/auth/server/identity";
import { authClient } from "@/features/auth/server/client";
import { type AuthProfile } from "@/features/auth/validation";
import {
  isAuthServiceUnavailable,
  isTemporaryAuthFailure,
} from "@/features/auth/server/failures";
import { serverApiUrl } from "@/config/server";
import { validEmail } from "@/features/auth/validation";

type ProfileTransport<T> = {
  path: "/api/worker/profile" | "/api/admin/profile";
  admits: (profile: AuthProfile) => boolean;
  parse: (value: unknown) => T | null;
  errorCode: (status: number, code?: unknown) => string;
  messages: Readonly<Record<string, string>>;
};

/** Shared verified identity, admission and HTTP transport; business policy stays in Spring. */
export async function forwardPanelProfile<T>(options: ProfileTransport<T>) {
  const { errorCode: profileErrorCode, messages: PROFILE_MESSAGES } = options;
  const validProfileEmail = (value: unknown): value is string =>
    typeof value === "string" && value === value.trim() && validEmail(value);

  function failure(status: number, retry?: string | null, auth = false) {
    const code = profileErrorCode(
      status,
      auth ? "AUTH_TEMPORARILY_UNAVAILABLE" : undefined,
    );
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (status === 503)
      headers["Retry-After"] =
        retry &&
        /^\d{1,3}$/.test(retry) &&
        Number(retry) > 0 &&
        Number(retry) <= 300
          ? retry
          : "5";
    return Response.json(
      { status, code, message: PROFILE_MESSAGES[code] },
      { status, headers },
    );
  }

  let identity: Awaited<ReturnType<typeof getVerifiedAuthIdentity>>;
  try {
    identity = await getVerifiedAuthIdentity();
    if (!identity || !validProfileEmail(identity.email)) return failure(401);
    const client = await authClient();
    const {
      data,
      error,
      status: admissionStatus,
    } = await client.rpc("current_auth_profile");
    if (error && admissionStatus === 401) return failure(401);
    if (error && admissionStatus === 403) return failure(403);
    if (error)
      return isTemporaryAuthFailure(error)
        ? failure(503, null, true)
        : failure(403);
    // The existing admission policy is applied after provider verification. Inactive
    // users remain authenticated, so their denial is 403 rather than getAuth's null.
    if (
      !data ||
      data.id !== identity.id ||
      !options.admits(data as AuthProfile)
    )
      return failure(403);
  } catch (cause) {
    unstable_rethrow(cause);
    if (isAuthServiceUnavailable(cause) || isTemporaryAuthFailure(cause))
      return failure(503, null, true);
    return failure(401);
  }
  try {
    const upstream = await fetch(`${serverApiUrl()}${options.path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${identity.accessToken}`,
        accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (upstream.status !== 200) {
      const status = [401, 403, 500, 503].includes(upstream.status)
        ? upstream.status
        : upstream.status >= 502
          ? 503
          : 502;
      return failure(status, upstream.headers.get("Retry-After"));
    }
    const body: unknown = await upstream.json().catch((cause: unknown) => {
      if (
        cause instanceof Error &&
        ["AbortError", "TimeoutError"].includes(cause.name)
      )
        throw cause;
      return null;
    });
    const business = options.parse(body);
    return business
      ? Response.json(
          { email: identity.email, ...business },
          { headers: { "Cache-Control": "no-store" } },
        )
      : failure(502);
  } catch {
    return failure(503);
  }
}
