import type { OrderItem } from "@/types/order";

/** «$7.000 c/u» only says something new when there is more than one unit. */
export function showsUnitPrice(item: Pick<OrderItem, "quantity">): boolean {
  return item.quantity > 1;
}

/**
 * The Total row only when it adds information: more than one product, or more than one unit. With a
 * single product and a single unit the line's value is already the total.
 */
export function showsTotal(items: Pick<OrderItem, "quantity">[]): boolean {
  return items.length > 1 || items.some((item) => item.quantity > 1);
}
