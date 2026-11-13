import {
  parseCafeteriaAudit,
  parseSuperAdminCafeteria,
  parseSuperAdminCafeterias,
} from "./contracts";
import {
  SuperAdminError,
  superAdminErrorCode,
  type SuperAdminOperation,
} from "./errors";
import type {
  BillingCommand,
  CafeteriaAudit,
  SuperAdminCafeteria,
  SuperAdminCafeterias,
  VisibilityCommand,
} from "./types";

const ROOT = "/api/super-admin/cafeterias";

async function call<T>(
  url: string,
  operation: SuperAdminOperation,
  parse: (value: unknown) => T | null,
  {
    method = "GET",
    body,
    signal,
  }: {
    method?: "GET" | "PATCH" | "PUT";
    body?: object;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
  } catch {
    throw new SuperAdminError(503, undefined, operation);
  }
  const data: unknown = await response.json().catch(() => null);
  if (response.status !== 200) {
    const code =
      typeof data === "object" && data !== null && "code" in data
        ? data.code
        : undefined;
    throw new SuperAdminError(
      response.status,
      superAdminErrorCode(response.status, code),
      operation,
    );
  }
  const parsed = parse(data);
  if (!parsed) throw new SuperAdminError(502, undefined, operation);
  return parsed;
}

export const superAdminApi = {
  cafeterias(signal?: AbortSignal): Promise<SuperAdminCafeterias> {
    return call(ROOT, "list", parseSuperAdminCafeterias, { signal });
  },
  visibility(
    cafeteriaId: string,
    command: VisibilityCommand,
  ): Promise<SuperAdminCafeteria> {
    return call(
      `${ROOT}/${encodeURIComponent(cafeteriaId)}/visibility`,
      "save",
      parseSuperAdminCafeteria,
      { method: "PATCH", body: command },
    );
  },
  billing(
    cafeteriaId: string,
    command: BillingCommand,
  ): Promise<SuperAdminCafeteria> {
    return call(
      `${ROOT}/${encodeURIComponent(cafeteriaId)}/billing`,
      "save",
      parseSuperAdminCafeteria,
      { method: "PUT", body: command },
    );
  },
  audit(cafeteriaId: string, signal?: AbortSignal): Promise<CafeteriaAudit> {
    return call(
      `${ROOT}/${encodeURIComponent(cafeteriaId)}/audit`,
      "audit",
      parseCafeteriaAudit,
      { signal },
    );
  },
};

export type SuperAdminApi = typeof superAdminApi;
