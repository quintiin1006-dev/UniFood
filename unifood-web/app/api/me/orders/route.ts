import {
  forwardCreateOrder,
  forwardOrderHistory,
} from "@/features/client/server/orderForward";

export const GET = forwardOrderHistory;
export const POST = forwardCreateOrder;
