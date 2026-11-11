import type { Order } from "@/types/order";

const TYPE_LABELS = {
  STUDENT: "Estudiante",
  STAFF: "Docente o administrativo",
} as const;

/**
 * What the worker sees next to the name (docs/decisiones.md §3): the institutional code, or the
 * client type when there is no code, or nothing for an old order without either.
 */
export function clientIdentity(
  order: Pick<Order, "clientCode" | "clientType">,
): string {
  if (order.clientCode) return `Código: ${order.clientCode}`;
  return order.clientType ? TYPE_LABELS[order.clientType] : "";
}
