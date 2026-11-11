import { parseSuperAdminCafeterias } from "./contracts";
import { SuperAdminError, superAdminErrorCode } from "./errors";
import type { SuperAdminCafeterias } from "./types";

export const superAdminApi = {
  async cafeterias(signal?: AbortSignal): Promise<SuperAdminCafeterias> {
    let response: Response;
    try {
      response = await fetch("/api/super-admin/cafeterias", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
    } catch {
      throw new SuperAdminError(503);
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.status !== 200) {
      const code =
        typeof body === "object" && body !== null && "code" in body
          ? body.code
          : undefined;
      throw new SuperAdminError(
        response.status,
        superAdminErrorCode(response.status, code),
      );
    }
    const data = parseSuperAdminCafeterias(body);
    if (!data) throw new SuperAdminError(502);
    return data;
  },
};

export type SuperAdminApi = typeof superAdminApi;
