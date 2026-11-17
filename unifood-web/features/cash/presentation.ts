import { formatCop } from "@/lib/numberFormat";
import type { CashOutcome, CashShift, CashStatus } from "./types";

/** Whole pesos as «$22.500»; a negative amount keeps its sign («-$2.050»). */
export const formatPesos = (amount: number) =>
  amount < 0 ? `-${formatCop(-amount) ?? "—"}` : (formatCop(amount) ?? "—");

/** The sign is explicit for a difference: «+$500», «-$2.050», «$0». */
export const formatDifference = (amount: number) =>
  amount > 0 ? `+${formatPesos(amount)}` : formatPesos(amount);

export const SHIFT_LABELS: Record<CashShift, string> = {
  BREAKFAST: "Desayuno",
  LUNCH: "Almuerzo",
};

export const STATUS_LABELS: Record<CashStatus, string> = {
  OPEN: "Abierta",
  CLOSED: "Cerrada",
  REOPENED: "Reabierta",
};

export const OUTCOME_LABELS: Record<CashOutcome, string> = {
  BALANCED: "Cuadra",
  SURPLUS: "Sobrante",
  SHORTAGE: "Faltante",
};

export const denominationLabel = (value: number) =>
  formatCop(value) ?? String(value);

const time = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const dateTime = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const longDate = new Intl.DateTimeFormat("es-CO", {
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

export const formatCashTime = (instant: string) =>
  time.format(new Date(instant));
export const formatCashDateTime = (instant: string) =>
  dateTime.format(new Date(instant));
/** A Bogota business date (yyyy-mm-dd), never shifted by the browser's zone. */
export const formatCashDate = (date: string) =>
  longDate.format(new Date(`${date}T12:00:00Z`));

/** Suggested shift for a new drawer: breakfast before 11:00 in Bogota. */
export function suggestedShift(now: Date = new Date()): CashShift {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  return hour < 11 ? "BREAKFAST" : "LUNCH";
}

/** «Consecutivo 0007». */
export const formatSequence = (sequence: number) =>
  String(sequence).padStart(4, "0");
