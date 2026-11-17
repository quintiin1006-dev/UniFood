/** Order as Spring answers it for the owner (docs/decisiones.md §11, B15 + B16). */
export type OrderStatus =
  | "PENDING"
  | "PREPARING"
  | "READY"
  | "CALLED"
  | "DELIVERED"
  | "CANCELLED"
  | "NOT_COLLECTED";

export type OrderLine = {
  name: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
};

export type ClientOrder = {
  id: string;
  status: OrderStatus;
  total: string;
  note: string | null;
  createdAt: string;
  items: OrderLine[];
  cafeteria: { id: string; name: string };
  cancellationSource: "CLIENT" | "WORKER" | "SYSTEM" | null;
  rejectionReason: string | null;
  reminderCount: number;
  requestedPickupAt: string | null;
};

/** One row of GET /api/me/orders; the detail is fetched when the row is opened. */
export type OrderHistoryItem = {
  id: string;
  status: OrderStatus;
  total: string;
  createdAt: string;
  cafeteriaName: string;
  itemCount: number;
  summary: string;
};

export type OrderHistoryPage = {
  orders: OrderHistoryItem[];
  nextCursor: string | null;
};
