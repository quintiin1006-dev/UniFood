import { forwardClientMenu } from "@/features/client/server/catalogForward";

export const GET = forwardClientMenu;

// Day and user data (menu with its service fee, orders): never a cached response.
export const dynamic = "force-dynamic";
