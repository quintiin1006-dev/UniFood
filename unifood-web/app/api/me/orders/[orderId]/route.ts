import { forwardOwnOrder } from "@/features/client/server/orderForward";

export const GET = forwardOwnOrder;

// Day and user data (menu with its service fee, orders): never a cached response.
export const dynamic = "force-dynamic";
