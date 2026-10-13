import type { CatalogMeal, MealKind } from "../types";

export const NOTES_LIMIT = 200;
export const MAX_CART_MEALS = 3;
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
export function serviceAvailability(
  kind: MealKind,
  siteId: string,
  date: Date,
  ignoreServiceHours = false,
) {
  if (kind === "breakfast" && siteId !== "principal")
    return {
      open: false,
      reason: "Disponible únicamente en la Sede Principal",
    };
  if (process.env.NODE_ENV === "development" && ignoreServiceHours)
    return { open: true, reason: "Horario de prueba activo" };
  const { minutes } = colombiaTime(date);
  const [start, end] = serviceWindow(kind);
  return {
    open: minutes >= start && minutes < end,
    reason: `Disponible de ${serviceHours(kind)} · Hora de Colombia`,
  };
}
export function mealAvailability(
  meal: CatalogMeal,
  siteId: string,
  date: Date,
  ignoreServiceHours = false,
) {
  if (!meal.availableDays.includes(colombiaTime(date).day))
    return { open: false, reason: "Este plato no está disponible hoy" };
  if (meal.stock <= 0) return { open: false, reason: "Agotado por hoy" };
  return serviceAvailability(meal.kind, siteId, date, ignoreServiceHours);
}

/** Browse today's stocked offerings; ordering hours are checked separately on every add. */
export function featuredMeals(meals: CatalogMeal[], date: Date): CatalogMeal[] {
  const available = meals.filter(
    (meal) =>
      meal.stock > 0 && meal.availableDays.includes(colombiaTime(date).day),
  );
  const lunches = available.filter((meal) => meal.kind === "lunch");
  const breakfasts = available.filter((meal) => meal.kind === "breakfast");
  const initial = [...lunches.slice(0, 3), ...breakfasts.slice(0, 2)];
  const remainder = available.filter((meal) => !initial.includes(meal));
  const selection = [...initial, ...remainder].slice(0, 5);
  if (colombiaTime(date).minutes < 510)
    return [
      ...selection.filter((meal) => meal.kind === "breakfast"),
      ...selection.filter((meal) => meal.kind === "lunch"),
    ];
  return selection;
}
