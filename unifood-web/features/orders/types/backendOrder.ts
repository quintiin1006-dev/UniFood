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
  clientCode: string | null;
  clientType: "STUDENT" | "STAFF" | null;
  status: BackendOrderStatus;
  total: number;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string | null;
  items: BackendOrderItem[];
  requestedPickupAt?: string | null;
}
