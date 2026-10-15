export type HistoryStatus = "DELIVERED" | "NOT_COLLECTED" | "CANCELLED";

export type HistoryItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

export type HistoryOrder = {
  id: string;
  reference: string;
  status: HistoryStatus;
  completedAt: string;
  total: number;
  items: HistoryItem[];
};

export type TodayWorkerHistory = {
  businessDate: string;
  nextBusinessDateAt: string;
  orders: HistoryOrder[];
};
