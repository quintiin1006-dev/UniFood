export type HistoryStatus = "DELIVERED" | "NOT_COLLECTED" | "CANCELLED";

export type HistoryItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

/** Who ended a cancelled order (021): the client, the cafeteria (a rejection) or the system. */
export type CancellationSource = "CLIENT" | "WORKER" | "SYSTEM";

export type HistoryOrder = {
  id: string;
  reference: string;
  clientName: string | null;
  status: HistoryStatus;
  completedAt: string;
  total: number;
  items: HistoryItem[];
  cancellationSource: CancellationSource | null;
  rejectionReason: string | null;
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
