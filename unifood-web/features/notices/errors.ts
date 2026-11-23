import {
  backendErrorMessage,
  NOTICES_MESSAGES,
} from "@/features/shared/messages";

/** Codes the inbox BFF answers with; the texts come from the shared catalogue. */
export type NoticesErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "ORDER_NOTICES_DISABLED"
  | "ORDER_NOTICES_FORBIDDEN"
  | "ORDER_NOTICES_TEMPORARILY_UNAVAILABLE"
  | "BACKEND_UNAVAILABLE";

export const noticesErrorMessage = (code: unknown) =>
  backendErrorMessage(code, NOTICES_MESSAGES.failed);
