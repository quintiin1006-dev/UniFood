/** Kinds of the bell inbox; the same values as the backend (migration 034). */
export const NOTICE_KINDS = [
  "PREPARING",
  "READY",
  "CALLED",
  "REMINDER",
  "DELIVERED",
  "NOT_COLLECTED",
  "REJECTED",
  "CANCELLED_BY_CLIENT",
] as const;

export type NoticeKind = (typeof NOTICE_KINDS)[number];

export type Notice = {
  id: string;
  kind: NoticeKind;
  /** The reminder number for REMINDER, 0 for every other kind. */
  sequence: number;
  orderId: string;
  /** The order can still be followed in Mi pedido. */
  orderActive: boolean;
  createdAt: string;
  read: boolean;
};

export type NoticesPayload = { notices: Notice[]; unread: number };
