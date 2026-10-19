import { formatAvailabilityPrice } from "@/features/availability/presentation";
export { formatBusinessDate } from "@/features/availability/presentation";
import type { HistoryStatus } from "./types";

const fractionalPesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
// NUMERIC(12,2) snapshots may contain cents. Reuse the existing whole-peso format
// while preserving historical fractional amounts instead of rounding them away.
export const formatHistoryPrice = (amount: number) =>
  Number.isInteger(amount)
    ? formatAvailabilityPrice(amount)
    : fractionalPesos.format(amount);

const clock = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
export const formatHistoryTime = (instant: string) =>
  clock.format(new Date(instant));
const completedDate = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "short",
  day: "numeric",
});
export const formatHistoryDate = (instant: string) =>
  completedDate.format(new Date(instant));
export const HISTORY_LABELS: Record<HistoryStatus, string> = {
  DELIVERED: "Entregado",
  NOT_COLLECTED: "No recogido",
  CANCELLED: "Cancelado",
};
