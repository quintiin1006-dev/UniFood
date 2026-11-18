import type { IconName } from "@/components/ui/Icon";
import { ORDER_STAGE_LABELS } from "../shared/messages";
import type { OrderStatus } from "./types";

/**
 * The normal flow of an order as the client sees it (lib/orderWorkflow.ts ORDER_FLOW, backend
 * OrderStatus). CANCELLED, NOT_COLLECTED are not stages: they go to the history.
 */
export const ORDER_STAGE_COUNT = ORDER_STAGE_LABELS.length;

/** One icon per stage, in the same order as ORDER_STAGE_LABELS. */
export const ORDER_STAGE_ICONS: readonly IconName[] = [
  "pedidos",
  "cocina",
  "bolsa",
  "llamadas",
  "exito",
];

const STAGE_OF: Partial<Record<OrderStatus, number>> = {
  PENDING: 0,
  PREPARING: 1,
  READY: 2,
  CALLED: 3,
  DELIVERED: 4,
};

/** Zero-based stage of an order, or null when the status is outside the flow. */
export function stageIndexOf(status: OrderStatus): number | null {
  return STAGE_OF[status] ?? null;
}

/** READY and CALLED: the moment the client must come to the counter. */
export function isPickupReady(status: OrderStatus): boolean {
  return status === "READY" || status === "CALLED";
}

/** Icon of an ended order in the history: the text always says the state too. */
export function historyIconOf(status: OrderStatus): IconName {
  if (status === "DELIVERED") return "exito";
  if (status === "NOT_COLLECTED") return "advertencia";
  return "cerrar";
}

const BOGOTA_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * A delivered order stays on the board only on the day it was delivered (Colombia time). A
 * delivery from another day is in the history alone.
 */
export function isDeliveredToday(
  order: { status: OrderStatus; deliveredAt: string | null },
  now: Date,
): boolean {
  if (order.status !== "DELIVERED" || !order.deliveredAt) return false;
  const delivered = new Date(order.deliveredAt);
  if (Number.isNaN(delivered.getTime())) return false;
  return BOGOTA_DAY.format(delivered) === BOGOTA_DAY.format(now);
}
