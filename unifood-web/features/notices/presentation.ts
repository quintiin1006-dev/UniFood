import { NOTICE_TITLES, NOTICES_MESSAGES } from "@/features/shared/messages";
import type { Notice } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** «Recordatorio 2»: two reminders of the same order read as two different notices. */
export function noticeTitle(notice: Pick<Notice, "kind" | "sequence">): string {
  const base = NOTICE_TITLES[notice.kind];
  return notice.kind === "REMINDER" ? `${base} ${notice.sequence}` : base;
}

/** «Pedido #A1B2C3»: the first characters of the order, nothing else about it. */
export function noticeDetail(notice: Pick<Notice, "orderId">): string {
  return `${NOTICES_MESSAGES.orderPrefix} #${notice.orderId.slice(0, 6).toUpperCase()}`;
}

const BOGOTA_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayNumber = (ms: number) =>
  Math.round(
    Date.parse(`${BOGOTA_DAY.format(new Date(ms))}T00:00:00Z`) / (24 * HOUR),
  );

/**
 * «hace un momento», «hace 5 min», «hace 3 h» within the last day; then «ayer» or «hace 4 días» by
 * calendar day in America/Bogota, so an order from last night reads as «ayer» this morning.
 */
export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso);
  const elapsed = Math.max(0, now - at);
  const days = dayNumber(now) - dayNumber(at);
  if (elapsed < MINUTE) return NOTICES_MESSAGES.justNow;
  if (elapsed < HOUR)
    return `${NOTICES_MESSAGES.ago} ${Math.floor(elapsed / MINUTE)} ${NOTICES_MESSAGES.minutes}`;
  if (days <= 0)
    return `${NOTICES_MESSAGES.ago} ${Math.floor(elapsed / HOUR)} ${NOTICES_MESSAGES.hours}`;
  if (days === 1) return NOTICES_MESSAGES.yesterday;
  return `${NOTICES_MESSAGES.ago} ${days} ${NOTICES_MESSAGES.days}`;
}

const EXACT = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** The exact time in America/Bogota, shown next to the relative one and read by screen readers. */
export const exactTime = (iso: string) => EXACT.format(new Date(iso));

/** «1 aviso nuevo», «3 avisos nuevos»; empty when there is none. */
export function unreadLabel(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return NOTICES_MESSAGES.unreadOne;
  return `${count} ${NOTICES_MESSAGES.unreadMany}`;
}

/** The number on the bell; the full text lives in its accessible name. */
export const badgeText = (count: number) => (count > 9 ? "9+" : String(count));
