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
  clientName: string | null;
  status: HistoryStatus;
  completedAt: string;
  total: number;
  items: HistoryItem[];
};

export type HistoryRange = "TODAY" | "WEEK" | "MONTH";
export type HistoryCriteria = {
  q: string;
  range: HistoryRange;
  status?: HistoryStatus;
  cursor?: string;
  limit?: number;
};

export type WorkerHistoryPage = {
  businessDate: string;
  nextBusinessDateAt: string;
  monthStart: string;
  rangeStart: string;
  rangeEnd: string;
  nextCursor: string | null;
  hasHistory: boolean;
  orders: HistoryOrder[];
};
