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
  studentId: string;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  note?: string;
  total?: number;
  status: OrderStatus;
  calledAt?: string;
  deliveredAt?: string;
}
