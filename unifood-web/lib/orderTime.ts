/**
 * Formatea un timestamp ISO como tiempo
 * relativo en español ("Hace 2 min").
 */
export function formatRelativeTime(
  createdAt: string
): string {
  const elapsedMinutes = Math.max(
    0,
    Math.floor(
      (Date.now() -
        new Date(createdAt).getTime()) /
        60_000
    )
  );

  if (elapsedMinutes < 1) {
    return "Hace un momento";
  }

  if (elapsedMinutes < 60) {
    return `Hace ${elapsedMinutes} min`;
  }

  const hours = Math.floor(
    elapsedMinutes / 60
  );

  if (hours < 24) {
    return hours === 1
      ? "Hace 1 hora"
      : `Hace ${hours} horas`;
  }

  const days = Math.floor(hours / 24);

  return days === 1
    ? "Hace 1 día"
    : `Hace ${days} días`;
}

/**
 * Formatea un timestamp ISO como hora de
 * reloj ("12:32 p. m.").
 */
export function formatClockTime(
  iso: string
): string {
  return new Date(
    iso
  ).toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
  });
}