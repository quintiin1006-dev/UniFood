import { parseWorkerHistory } from "./contracts";
import { WorkerHistoryError, historyErrorCode } from "./errors";
import type { WorkerHistoryPage, HistoryCriteria } from "./types";

export const workerHistoryApi = {
  async page(
    criteria: HistoryCriteria,
    signal?: AbortSignal,
  ): Promise<WorkerHistoryPage> {
    let response: Response;
    try {
      const params = new URLSearchParams({
        q: criteria.q,
        range: criteria.range,
      });
      if (criteria.status) params.set("status", criteria.status);
      if (criteria.cursor) params.set("cursor", criteria.cursor);
      if (criteria.limit) params.set("limit", String(criteria.limit));
      response = await fetch(`/api/worker/orders/history?${params}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
    } catch {
      throw new WorkerHistoryError(503);
    }
    const body: unknown = await response.json().catch((cause: unknown) => {
      if (
        cause instanceof Error &&
        ["AbortError", "TimeoutError"].includes(cause.name)
      )
        throw new WorkerHistoryError(503);
      return null;
    });
    if (response.status !== 200) {
      const code =
        typeof body === "object" && body !== null && "code" in body
          ? body.code
          : undefined;
      throw new WorkerHistoryError(
        response.status,
        historyErrorCode(response.status, code),
      );
    }
    const data = parseWorkerHistory(body);
    if (!data) throw new WorkerHistoryError(502);
    return data;
  },
};
export type WorkerHistoryApi = typeof workerHistoryApi;
