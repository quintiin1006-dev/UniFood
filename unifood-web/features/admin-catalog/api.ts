import { parseAdminCatalog } from "./contracts";
import { AdminCatalogError, catalogErrorCode } from "./errors";
import type { AdminCatalogData, AdminProduct, CatalogMutation } from "./types";

export const adminCatalogApi = {
  async mutate(command: CatalogMutation): Promise<AdminProduct> {
    const path =
      "/api/admin/catalog" +
      (command.kind === "create"
        ? ""
        : "/" + command.id + (command.kind === "status" ? "/status" : ""));
    const body =
      command.kind === "status"
        ? { active: command.active, expectedVersion: command.expectedVersion }
        : {
            ...command.form,
            ...(command.kind === "edit"
              ? { expectedVersion: command.expectedVersion }
              : {}),
          };
    let response: Response;
    try {
      response = await fetch(path, {
        method: command.kind === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new AdminCatalogError(503);
    }
    const raw: unknown = await response.json().catch(() => null);
    if (response.status !== (command.kind === "create" ? 201 : 200)) {
      const code =
        raw && typeof raw === "object" && "code" in raw ? raw.code : undefined;
      throw new AdminCatalogError(
        response.status,
        catalogErrorCode(response.status, code),
      );
    }
    const data = parseAdminCatalog({ products: [raw] });
    if (
      !data ||
      (command.kind !== "create" && data.products[0].id !== command.id)
    )
      throw new AdminCatalogError(502);
    return data.products[0];
  },
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
