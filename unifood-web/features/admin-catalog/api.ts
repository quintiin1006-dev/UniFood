import { parseAdminCatalog } from "./contracts";
import { AdminCatalogError, catalogErrorCode } from "./errors";
import type { AdminCatalogData } from "./types";

export const adminCatalogApi = {
  async get(signal?: AbortSignal): Promise<AdminCatalogData> {
    let response: Response;
    try {
      response = await fetch("/api/admin/catalog", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
    } catch {
      throw new AdminCatalogError(503);
    }
    const body: unknown = await response.json().catch((cause: unknown) => {
      if (
        cause instanceof Error &&
        ["AbortError", "TimeoutError"].includes(cause.name)
      )
        throw new AdminCatalogError(503);
      return null;
    });
    if (response.status !== 200) {
      const code =
        typeof body === "object" && body !== null && "code" in body
          ? body.code
          : undefined;
      throw new AdminCatalogError(
        response.status,
        catalogErrorCode(response.status, code),
      );
    }
    const data = parseAdminCatalog(body);
    if (!data) throw new AdminCatalogError(502);
    return data;
  },
};
export type AdminCatalogApi = typeof adminCatalogApi;
