import { isBusinessDate, isUuid, parseToday, record } from "./contracts";
import { AvailabilityApiError, publicErrorCode } from "./errors";
import type {
  TodayAvailability,
  ItemAcknowledgement,
  CafeteriaAcknowledgement,
} from "./types";

const root = "/api/worker/availability/today";
async function request(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
  } catch {
    throw new AvailabilityApiError(503);
  }
  const body: unknown = await response.json().catch((cause: unknown) => {
    if (
      cause instanceof Error &&
      ["AbortError", "TimeoutError"].includes(cause.name)
    )
      throw new AvailabilityApiError(503);
    return null;
  });
  if (response.status !== 200)
    throw new AvailabilityApiError(
      response.status,
      publicErrorCode(response.status, record(body) ? body.code : undefined),
    );
  return body;
}
function put(
  day: string,
  body: { open: boolean } | { available: boolean },
): RequestInit {
  if (!isBusinessDate(day)) throw new AvailabilityApiError(400);
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Business-Date": day },
    body: JSON.stringify(body),
  };
}
export const availabilityApi = {
  async today(signal?: AbortSignal): Promise<TodayAvailability> {
    const today = parseToday(await request(root, { signal }));
    if (!today) throw new AvailabilityApiError(502);
    return today;
  },
  async item(
    itemId: string,
    day: string,
    available: boolean,
  ): Promise<ItemAcknowledgement> {
    if (!isUuid(itemId)) throw new AvailabilityApiError(400);
    const body = await request(
      `${root}/items/${itemId}`,
      put(day, { available }),
    );
    if (
      !record(body) ||
      body.businessDate !== day ||
      typeof body.itemId !== "string" ||
      body.itemId.toLowerCase() !== itemId.toLowerCase() ||
      body.available !== available
    )
      throw new AvailabilityApiError(502);
    return { businessDate: day, itemId: body.itemId, available };
  },
  async cafeteria(
    day: string,
    open: boolean,
  ): Promise<CafeteriaAcknowledgement> {
    const body = await request(`${root}/cafeteria-state`, put(day, { open }));
    if (!record(body) || body.businessDate !== day || body.open !== open)
      throw new AvailabilityApiError(502);
    return { businessDate: day, open };
  },
};
export type AvailabilityApi = typeof availabilityApi;
