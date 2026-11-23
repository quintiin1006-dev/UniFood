import {
  NOTICE_KINDS,
  type Notice,
  type NoticeKind,
  type NoticesPayload,
} from "./types";

export const MAX_NOTICES = 20;
export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const isKind = (value: unknown): value is NoticeKind =>
  typeof value === "string" &&
  (NOTICE_KINDS as readonly string[]).includes(value);

/** One notice rebuilt from its own fields, or null: nothing else of the upstream body survives. */
function pickNotice(raw: unknown): Notice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== "string" || !UUID.test(n.id)) return null;
  if (typeof n.orderId !== "string" || !UUID.test(n.orderId)) return null;
  // A kind this version does not know yet is skipped, never shown with a wrong text.
  if (!isKind(n.kind)) return null;
  if (!Number.isSafeInteger(n.sequence) || (n.sequence as number) < 0)
    return null;
  if (n.kind === "REMINDER" ? (n.sequence as number) < 1 : n.sequence !== 0)
    return null;
  if (typeof n.createdAt !== "string" || !ISO.test(n.createdAt)) return null;
  if (Number.isNaN(Date.parse(n.createdAt))) return null;
  if (typeof n.orderActive !== "boolean" || typeof n.read !== "boolean")
    return null;
  return {
    id: n.id.toLowerCase(),
    kind: n.kind,
    sequence: n.sequence as number,
    orderId: n.orderId.toLowerCase(),
    orderActive: n.orderActive,
    createdAt: n.createdAt,
    read: n.read,
  };
}

/**
 * The inbox exactly as it may be shown: newest first, only the last 7 days, at most 20, and the
 * unread count taken from that same list. The server applies the same rules; this is the
 * client's own guarantee.
 */
export function prepareNotices(notices: Notice[], now: number): NoticesPayload {
  const since = now - WINDOW_MS;
  const kept = notices
    .filter((notice) => Date.parse(notice.createdAt) >= since)
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        b.sequence - a.sequence ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
    .slice(0, MAX_NOTICES);
  return {
    notices: kept,
    unread: kept.filter((notice) => !notice.read).length,
  };
}

/** The upstream body checked field by field, or null when its shape is wrong. */
export function parseNotices(raw: unknown, now: number): NoticesPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const list = (raw as { notices?: unknown }).notices;
  if (!Array.isArray(list) || list.length > 100) return null;
  const notices = list.map(pickNotice).filter((n): n is Notice => n !== null);
  return prepareNotices(notices, now);
}
