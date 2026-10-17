import { parseWorkerProfile } from "./contracts";
import { WorkerProfileError, profileErrorCode } from "./errors";
import type { WorkerProfile } from "./types";

export const workerProfileApi = {
  async get(signal?: AbortSignal): Promise<WorkerProfile> {
    let response: Response;
    try {
      response = await fetch("/api/worker/profile", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
    } catch {
      throw new WorkerProfileError(503);
    }
    const body: unknown = await response.json().catch((cause: unknown) => {
      if (
        cause instanceof Error &&
        ["AbortError", "TimeoutError"].includes(cause.name)
      )
        throw new WorkerProfileError(503);
      return null;
    });
    if (response.status !== 200) {
      const code =
        typeof body === "object" && body !== null && "code" in body
          ? body.code
          : undefined;
      throw new WorkerProfileError(
        response.status,
        profileErrorCode(response.status, code),
      );
    }
    const data = parseWorkerProfile(body);
    if (!data) throw new WorkerProfileError(502);
    return data;
  },
};
export type WorkerProfileApi = typeof workerProfileApi;
