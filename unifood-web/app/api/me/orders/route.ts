import {
  forwardCreateOrder,
  forwardOrderHistory,
} from "@/features/client/server/orderForward";

export const GET = forwardOrderHistory;
export const POST = forwardCreateOrder;

// Day and user data (menu with its service fee, orders): never a cached response.
export const dynamic = "force-dynamic";
