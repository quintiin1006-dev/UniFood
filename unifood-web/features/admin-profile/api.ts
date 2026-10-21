import { parseAdminProfile } from "./contracts";
import { AdminProfileError, profileErrorCode } from "./errors";
import type { AdminProfile } from "./types";

export const adminProfileApi = {
  async get(signal?: AbortSignal): Promise<AdminProfile> {
    let response: Response;
    try {
      response = await fetch("/api/admin/profile", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
    } catch {
      throw new AdminProfileError(503);
    }
    const body: unknown = await response.json().catch((cause: unknown) => {
      if (
        cause instanceof Error &&
        ["AbortError", "TimeoutError"].includes(cause.name)
      )
        throw new AdminProfileError(503);
      return null;
    });
    if (response.status !== 200) {
      const code =
        typeof body === "object" && body !== null && "code" in body
          ? body.code
          : undefined;
      throw new AdminProfileError(
        response.status,
        profileErrorCode(response.status, code),
      );
    }
    const data = parseAdminProfile(body);
    if (!data) throw new AdminProfileError(502);
    return data;
  },
};
export type AdminProfileApi = typeof adminProfileApi;
