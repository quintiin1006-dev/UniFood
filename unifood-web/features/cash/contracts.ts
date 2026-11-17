import {
  DENOMINATIONS,
  MAX_AMOUNT,
  MAX_QUANTITY,
  type CashCurrent,
  type CashDetail,
  type CashListing,
  type CashMovement,
  type CashPreview,
  type CashSession,
  type CountLine,
  type PendingOrder,
  type StaleSession,
  type Unsessioned,
} from "./types";

// Strict parsers for what Spring answers and for what the browser may send. Anything with an
// unexpected shape is null: the BFF then answers 400 (command) or 502 (response).

type Obj = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class Invalid extends Error {}
const fail = (): never => {
  throw new Invalid();
};
const obj = (value: unknown): Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : fail();
const str = (value: unknown): string =>
  typeof value === "string" ? value : fail();
const optStr = (value: unknown): string | null =>
  value === null ? null : str(value);
const int = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : fail();
const optInt = (value: unknown): number | null =>
  value === null || value === undefined ? null : int(value);
const bool = (value: unknown): boolean =>
  typeof value === "boolean" ? value : fail();
const optBool = (value: unknown): boolean | null =>
  value === null || value === undefined ? null : bool(value);
const id = (value: unknown): string =>
  UUID.test(str(value)) ? (value as string) : fail();
const date = (value: unknown): string =>
  DATE.test(str(value)) ? (value as string) : fail();
const instant = (value: unknown): string =>
  Number.isNaN(Date.parse(str(value))) ? fail() : (value as string);
const optInstant = (value: unknown): string | null =>
  value === null || value === undefined ? null : instant(value);
function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  return options.includes(value as T) ? (value as T) : fail();
}
const list = <T>(value: unknown, item: (v: unknown) => T): T[] =>
  Array.isArray(value) ? value.map(item) : fail();

function safely<T>(parse: () => T): T | null {
  try {
    return parse();
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
}

export const isSessionId = (value: string) => UUID.test(value);
export const isBusinessDate = (value: string) =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

function cafeteria(value: unknown) {
  const v = obj(value);
  return { id: id(v.id), name: str(v.name) };
}

function session(value: unknown): CashSession {
  const v = obj(value);
  return {
    id: id(v.id),
    cafeteria: cafeteria(v.cafeteria),
    shift: oneOf(v.shift, ["BREAKFAST", "LUNCH"] as const),
    businessDate: date(v.businessDate),
    sequenceNumber: int(v.sequenceNumber),
    status: oneOf(v.status, ["OPEN", "CLOSED", "REOPENED"] as const),
    openingFloat: int(v.openingFloat),
    openedAt: instant(v.openedAt),
    openedByName: str(v.openedByName),
    closedAt: optInstant(v.closedAt),
    closedByName: v.closedByName == null ? null : str(v.closedByName),
    sales: optInt(v.sales),
    income: optInt(v.income),
    expense: optInt(v.expense),
    expected: optInt(v.expected),
    counted: optInt(v.counted),
    difference: optInt(v.difference),
    outcome:
      v.outcome == null
        ? null
        : oneOf(v.outcome, ["BALANCED", "SURPLUS", "SHORTAGE"] as const),
    toleranceCop: optInt(v.toleranceCop),
    outsideTolerance: optBool(v.outsideTolerance),
    note: v.note == null ? null : str(v.note),
    pendingOrdersAtClose: optInt(v.pendingOrdersAtClose),
    forcedClose: optBool(v.forcedClose),
    reopenCount: int(v.reopenCount),
    reopenedAt: optInstant(v.reopenedAt),
    reopenedByName: v.reopenedByName == null ? null : str(v.reopenedByName),
    reopenReason: v.reopenReason == null ? null : str(v.reopenReason),
    version: int(v.version),
  };
}

function movement(value: unknown): CashMovement {
  const v = obj(value);
  return {
    id: id(v.id),
    kind: oneOf(v.kind, ["INCOME", "EXPENSE"] as const),
    amount: int(v.amount),
    reason: str(v.reason),
    createdAt: instant(v.createdAt),
    createdByName: str(v.createdByName),
  };
}

function pending(value: unknown): PendingOrder {
  const v = obj(value);
  return {
    id: id(v.id),
    status: oneOf(v.status, ["READY", "CALLED"] as const),
    clientName: str(v.clientName),
    createdAt: instant(v.createdAt),
  };
}

function unsessioned(value: unknown): Unsessioned {
  const v = obj(value);
  return { orders: int(v.orders), amount: int(v.amount) };
}

function preview(value: unknown): CashPreview {
  const v = obj(value);
  return {
    openingFloat: int(v.openingFloat),
    sales: int(v.sales),
    income: int(v.income),
    expense: int(v.expense),
    expected: int(v.expected),
    counted: int(v.counted),
    difference: int(v.difference),
    outcome: oneOf(v.outcome, ["BALANCED", "SURPLUS", "SHORTAGE"] as const),
    withinTolerance: bool(v.withinTolerance),
    toleranceCop: int(v.toleranceCop),
    noteRequired: bool(v.noteRequired),
    pendingOrders: list(v.pendingOrders, pending),
    version: int(v.version),
  };
}

function countLine(value: unknown): CountLine {
  const v = obj(value);
  return { denomination: int(v.denomination), quantity: int(v.quantity) };
}

function stale(value: unknown): StaleSession {
  const v = obj(value);
  return {
    id: id(v.id),
    cafeteria: cafeteria(v.cafeteria),
    businessDate: date(v.businessDate),
    shift: oneOf(v.shift, ["BREAKFAST", "LUNCH"] as const),
    openedAt: instant(v.openedAt),
  };
}

export const parseCashCurrent = (value: unknown): CashCurrent | null =>
  safely(() => {
    const v = obj(value);
    const live =
      v.live == null
        ? null
        : (() => {
            const l = obj(v.live);
            return {
              openingFloat: int(l.openingFloat),
              sales: int(l.sales),
              deliveredOrders: int(l.deliveredOrders),
              income: int(l.income),
              expense: int(l.expense),
              expected: int(l.expected),
            };
          })();
    return {
      businessDate: date(v.businessDate),
      session: v.session == null ? null : session(v.session),
      live,
      movements: list(v.movements, movement),
      pendingOrders: list(v.pendingOrders, pending),
      unsessionedToday: unsessioned(v.unsessionedToday),
      stale: bool(v.stale),
      toleranceCop: int(v.toleranceCop),
      settingsVersion: int(v.settingsVersion),
    };
  });

export const parseCashPreview = (value: unknown): CashPreview | null =>
  safely(() => preview(value));

export const parseCashDetail = (value: unknown): CashDetail | null =>
  safely(() => {
    const v = obj(value);
    return {
      session: session(v.session),
      movements: list(v.movements, movement),
      countLines: list(v.countLines, countLine),
    };
  });

export const parseCashListing = (value: unknown): CashListing | null =>
  safely(() => {
    const v = obj(value);
    return {
      businessDate: date(v.businessDate),
      sessions: list(v.sessions, session),
      staleSessions: list(v.staleSessions, stale),
      unsessionedToday:
        v.unsessionedToday == null ? null : unsessioned(v.unsessionedToday),
      toleranceCop: optInt(v.toleranceCop),
      settingsVersion: optInt(v.settingsVersion),
    };
  });

export const parseCashSettings = (value: unknown) =>
  safely(() => {
    const v = obj(value);
    return {
      toleranceCop: int(v.toleranceCop),
      settingsVersion: int(v.settingsVersion),
    };
  });

/** Extras of a refused close: the pending orders or the new figures. */
export const parseCashProblemExtras = (value: unknown) =>
  safely(() => {
    const v = obj(value);
    return {
      pendingOrders:
        v.pendingOrders === undefined
          ? undefined
          : list(v.pendingOrders, pending),
      preview: v.preview === undefined ? undefined : preview(v.preview),
    };
  });

// ---------------------------------------------------------------- commands (browser → BFF)

const exact = (v: Obj, required: string[], optional: string[] = []) => {
  const keys = Object.keys(v);
  if (
    !required.every((key) => keys.includes(key)) ||
    !keys.every((key) => required.includes(key) || optional.includes(key))
  )
    fail();
};
const pesos = (value: unknown, min: number) => {
  const amount = int(value);
  return amount >= min && amount <= MAX_AMOUNT ? amount : fail();
};
/** Trimmed text whose length, in code points as PostgreSQL counts it, is in range. */
const text = (value: unknown, min: number, max: number) => {
  const clean = str(value).trim();
  const length = [...clean].length;
  return length >= min && length <= max ? clean : fail();
};

export function parseCountLines(value: unknown): CountLine[] {
  const lines = list(value, countLine);
  const seen = new Set<number>();
  for (const line of lines) {
    if (
      !(DENOMINATIONS as readonly number[]).includes(line.denomination) ||
      seen.has(line.denomination) ||
      line.quantity < 0 ||
      line.quantity > MAX_QUANTITY
    )
      fail();
    seen.add(line.denomination);
  }
  return lines;
}

export const parseOpenCommand = (value: unknown) =>
  safely(() => {
    const v = obj(value);
    exact(v, ["shift", "openingFloat"]);
    return {
      shift: oneOf(v.shift, ["BREAKFAST", "LUNCH"] as const),
      openingFloat: pesos(v.openingFloat, 0),
    };
  });

export const parseMovementCommand = (value: unknown) =>
  safely(() => {
    const v = obj(value);
    exact(v, ["requestId", "kind", "amount", "reason"]);
    return {
      requestId: id(v.requestId),
      kind: oneOf(v.kind, ["INCOME", "EXPENSE"] as const),
      amount: pesos(v.amount, 1),
      reason: text(v.reason, 3, 200),
    };
  });

export const parsePreviewCommand = (value: unknown) =>
  safely(() => {
    const v = obj(value);
    exact(v, ["lines"]);
    return { lines: parseCountLines(v.lines) };
  });

export const parseCloseCommand = (value: unknown) =>
  safely(() => {
    const v = obj(value);
    exact(v, ["lines", "note", "expectedCash", "expectedVersion"], ["force"]);
    const note = optStr(v.note);
    const clean = note === null ? null : note.trim() || null;
    if (clean !== null && [...clean].length > 500) fail();
    const version = int(v.expectedVersion);
    if (version < 0) fail();
    return {
      lines: parseCountLines(v.lines),
      note: clean,
      expectedCash: int(v.expectedCash),
      expectedVersion: version,
      ...(v.force === undefined ? {} : { force: bool(v.force) }),
    };
  });

export const parseReopenCommand = (value: unknown) =>
  safely(() => {
    const v = obj(value);
    exact(v, ["reason", "expectedVersion"]);
    const version = int(v.expectedVersion);
    if (version < 0) fail();
    return { reason: text(v.reason, 10, 300), expectedVersion: version };
  });

export const parseToleranceCommand = (value: unknown) =>
  safely(() => {
    const v = obj(value);
    exact(v, ["toleranceCop", "expectedVersion"]);
    const tolerance = int(v.toleranceCop);
    const version = int(v.expectedVersion);
    if (tolerance < 0 || tolerance > 1_000_000 || version < 0) fail();
    return { toleranceCop: tolerance, expectedVersion: version };
  });
