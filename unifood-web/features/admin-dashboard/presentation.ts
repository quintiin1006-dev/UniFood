import { dashboardDate, dateOrdinal, bogotaDate } from "./filters";
import type {
  DashboardCoverage,
  DashboardPeriod,
  DashboardTrend,
} from "./types";

export const formatCount = (value: string | null): string =>
  value === null
    ? "No calculable"
    : value.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
export function formatMoney(value: string | null): string {
  if (value === null) return "No calculable";
  const [whole, cents] = value.split(".");
  return `$ ${formatCount(whole)},${cents}`;
}
export const formatPercent = (value: string | null) =>
  value === null ? "Sin base de cálculo" : value.replace(".", ",") + " %";
export function formatDay(value: string, short = false): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: short ? "short" : "long",
    ...(short ? {} : { year: "numeric" as const }),
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
}
export function formatAsOf(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}
export function customPeriodError(
  from: string,
  to: string,
  asOf: string | null,
): string | null {
  if (!dashboardDate(from) || !dashboardDate(to))
    return "Selecciona dos fechas válidas.";
  if (from > to)
    return "La fecha inicial debe ser anterior o igual a la final.";
  if (dateOrdinal(to) - dateOrdinal(from) >= 366)
    return "El período puede incluir hasta 366 días.";
  if (asOf && to > bogotaDate(new Date(asOf)))
    return "Las fechas no pueden ser posteriores a hoy en Colombia.";
  return null;
}
export const periodLabel = (p: DashboardPeriod) =>
  p.from === p.to
    ? formatDay(p.from)
    : `${formatDay(p.from)} al ${formatDay(p.to)}`;
export function axisLabel(value: string): string {
  return value.length <= 9
    ? formatCount(value)
    : `≈${value[0]},${value.slice(1, 3).padEnd(2, "0")}×10^${value.length - 1}`;
}
export function chartGeometry(trend: DashboardTrend[], width = 980) {
  const keys = [
    "receivedOrders",
    "deliveredOrders",
    "notCollectedOrders",
  ] as const;
  const observed = trend
    .flatMap((day) => keys.map((key) => BigInt(day[key])))
    .reduce((a, b) => (a > b ? a : b), BigInt(0));
  const max =
    observed === BigInt(0)
      ? BigInt(4)
      : ((observed + BigInt(3)) / BigInt(4)) * BigInt(4);
  const plotWidth = Math.max(1, width - 140);
  const x = (i: number) =>
    100 +
    (trend.length <= 1 ? plotWidth / 2 : (i * plotWidth) / (trend.length - 1));
  // Only a bounded pixel ratio becomes Number. Counts and axis labels remain exact integers.
  const y = (count: string) =>
    240 - (Number((BigInt(count) * BigInt(1000000)) / max) / 1000000) * 200;
  return {
    max,
    x,
    y,
    keys,
    ticks: [0, 1, 2, 3, 4].map((i) =>
      ((max * BigInt(i)) / BigInt(4)).toString(),
    ),
  };
}
const eventLabels: Record<string, string> = {
  RECEIVED: "registrados",
  DELIVERED: "entregados",
  NOT_COLLECTED: "no recogidos",
  CANCELLED: "cancelados",
};
export function warningText(code: string): string {
  if (code === "UNDATED_TERMINALS_NOT_ASSESSED")
    return "No se ha revisado todo el histórico para localizar pedidos sin fecha de finalización.";
  if (code === "UNVERIFIED_ORDER_PROVENANCE")
    return "La procedencia de los pedidos, reales o de prueba, no está certificada.";
  if (code === "NO_VERIFIABLE_EVENTS")
    return "No se encontraron eventos verificables; la cobertura limitada no confirma ausencia total de actividad.";
  if (code.startsWith("INVALID_TERMINAL_DATES_"))
    return "Hay fechas de finalización desconocidas o incompatibles en el alcance examinado. Esos eventos no se contabilizan como finalizaciones verificables.";
  const event = Object.keys(eventLabels).find((key) =>
    code.endsWith("_" + key),
  );
  const suffix = event ? ` en pedidos ${eventLabels[event]}` : "";
  if (code.startsWith("INVALID_HEADER_AMOUNT_"))
    return "Hay importes de pedidos que no pueden calcularse" + suffix + ".";
  if (code.startsWith("INCOMPLETE_ITEMS_"))
    return (
      "Faltan detalles de productos fiables" +
      suffix +
      ". Los indicadores dependientes pueden no estar disponibles."
    );
  if (code.startsWith("HEADER_ITEM_MISMATCH_"))
    return (
      "El importe del pedido difiere del total de sus productos" +
      suffix +
      ". Se conservan ambos valores históricos."
    );
  if (code.startsWith("MISSING_HISTORICAL_NAME_"))
    return "Hay nombres históricos de productos no disponibles" + suffix + ".";
  return "Existe una advertencia de cobertura. Revisa el alcance de las comprobaciones.";
}
export function coverageScope(
  check: DashboardCoverage["checks"][number],
): string {
  switch (check.scope.basis) {
    case "CREATED_COHORT":
      return "Pedidos registrados en el período";
    case "RECORDED_TERMINAL_EVENTS":
      return "Finalizaciones con fecha en el período";
    case "CAFETERIA_ALL_HISTORY":
      return "Histórico completo de la cafetería";
    default:
      return (
        "Pedidos " +
        check.scope.eventTypes.map((e) => eventLabels[e]).join(", ") +
        " seleccionados"
      );
  }
}
