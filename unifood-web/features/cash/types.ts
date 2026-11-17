/** Cash register (docs/decisiones.md §14). Amounts are whole COP; the server computes them. */
export type CashShift = "BREAKFAST" | "LUNCH";
export type CashStatus = "OPEN" | "CLOSED" | "REOPENED";
export type CashOutcome = "BALANCED" | "SURPLUS" | "SHORTAGE";
export type CashMovementKind = "INCOME" | "EXPENSE";

/** Colombian bills 50.000 to 2.000 and coins 1.000 to 50, highest first. */
export const DENOMINATIONS = [
  50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50,
] as const;
export const BILLS: readonly number[] = DENOMINATIONS.slice(0, 5);
export const COINS: readonly number[] = DENOMINATIONS.slice(5);

export const MAX_AMOUNT = 100_000_000;
export const MAX_QUANTITY = 10_000;

export interface CountLine {
  denomination: number;
  quantity: number;
}

export interface CashSession {
  id: string;
  cafeteria: { id: string; name: string };
  shift: CashShift;
  businessDate: string;
  sequenceNumber: number;
  status: CashStatus;
  openingFloat: number;
  openedAt: string;
  openedByName: string;
  closedAt: string | null;
  closedByName: string | null;
  sales: number | null;
  income: number | null;
  expense: number | null;
  expected: number | null;
  counted: number | null;
  difference: number | null;
  outcome: CashOutcome | null;
  toleranceCop: number | null;
  outsideTolerance: boolean | null;
  note: string | null;
  pendingOrdersAtClose: number | null;
  forcedClose: boolean | null;
  reopenCount: number;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  version: number;
}

export interface CashMovement {
  id: string;
  kind: CashMovementKind;
  amount: number;
  reason: string;
  createdAt: string;
  createdByName: string;
}

export interface PendingOrder {
  id: string;
  status: "READY" | "CALLED";
  clientName: string;
  createdAt: string;
}

export interface Unsessioned {
  orders: number;
  amount: number;
}

export interface CashLive {
  openingFloat: number;
  sales: number;
  deliveredOrders: number;
  income: number;
  expense: number;
  expected: number;
}

export interface CashCurrent {
  businessDate: string;
  session: CashSession | null;
  live: CashLive | null;
  movements: CashMovement[];
  pendingOrders: PendingOrder[];
  unsessionedToday: Unsessioned;
  stale: boolean;
  toleranceCop: number;
  settingsVersion: number;
}

export interface CashPreview {
  openingFloat: number;
  sales: number;
  income: number;
  expense: number;
  expected: number;
  counted: number;
  difference: number;
  outcome: CashOutcome;
  withinTolerance: boolean;
  toleranceCop: number;
  noteRequired: boolean;
  pendingOrders: PendingOrder[];
  version: number;
}

export interface CashDetail {
  session: CashSession;
  movements: CashMovement[];
  countLines: CountLine[];
}

export interface StaleSession {
  id: string;
  cafeteria: { id: string; name: string };
  businessDate: string;
  shift: CashShift;
  openedAt: string;
}

export interface CashListing {
  businessDate: string;
  sessions: CashSession[];
  staleSessions: StaleSession[];
  unsessionedToday: Unsessioned | null;
  toleranceCop: number | null;
  settingsVersion: number | null;
}

/** What the BFF passes on for a refused operation; extras only for their codes. */
export interface CashProblem {
  status: number;
  code: string;
  message: string;
  pendingOrders?: PendingOrder[];
  preview?: CashPreview;
}
