export type OrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "called"
  | "delivered"
  | "not_collected"
  | "cancelled";

export interface OrderItem {
  id?: string;
  name: string;
  quantity: number;
  unitPrice?: number;
  beverageChoice?: string;
  note?: string;
  subtotal?: number;
}

export interface Order {
  id: string;
  student: string;
  // B20: the worker sees the institutional code or, without one, the client type; never the
  // document.
  clientCode: string | null;
  clientType: "STUDENT" | "STAFF" | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  note?: string;
  total?: number;
  status: OrderStatus;
  calledAt?: string;
  deliveredAt?: string;
  // Optional pickup time chosen by the client; informative, the queue stays FIFO.
  requestedPickupAt?: string;
}
