export interface BackendOrderItem {
  id: string;
  orderId: string;
  lunchId: string;
  lunchName: string;
  unitPrice: number;
  quantity: number;
  beverageChoice: string | null;
  note: string | null;
  subtotal: number;
}

export type BackendOrderStatus =
  | "PENDING"
  | "PREPARING"
  | "READY"
  | "CALLED"
  | "DELIVERED"
  | "NOT_COLLECTED"
  | "CANCELLED";

export interface BackendOrder {
  id: string;
  cafeteriaId: string;
  clientId: string | null;
  clientName: string;
  clientDocument: string | null;
  status: BackendOrderStatus;
  total: number;
  cancellationDeadline: string | null;
  createdAt: string;
  updatedAt: string;
  items: BackendOrderItem[];
}
