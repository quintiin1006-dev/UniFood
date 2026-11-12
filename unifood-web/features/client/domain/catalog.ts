/**
 * Display helpers. The service hours below only feed the test checkout's pickup slots,
 * which PR 2 replaces; Inicio, Menú and Producto never show hours: the worker opens and
 * closes the cafeteria and the backend answers CAFETERIA_CLOSED.
 */
export type MealKind = "breakfast" | "lunch";

export const COLOMBIA_TIME_ZONE = "America/Bogota";
export const currency = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
const colombiaClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: COLOMBIA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

export function colombiaTime(date: Date) {
  const parts = colombiaClock.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return {
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      part("weekday"),
    ),
  };
}
export function serviceHours(kind: MealKind) {
  return kind === "breakfast"
    ? "6:00 a. m. – 8:30 a. m."
    : "11:30 a. m. – 2:30 p. m.";
}
export function serviceWindow(kind: MealKind): readonly [number, number] {
  return kind === "breakfast" ? [360, 510] : [690, 870];
}
