import "server-only";
import { isWorker } from "@/features/auth/validation";
import { forwardPanelProfile } from "@/features/panel-profile/server/forward";
import { parseWorkerBusinessProfile } from "../contracts";
import { PROFILE_MESSAGES, profileErrorCode } from "../errors";

export function forwardWorkerProfile() {
  return forwardPanelProfile({
    path: "/api/worker/profile",
    admits: isWorker,
    parse: parseWorkerBusinessProfile,
    errorCode: profileErrorCode,
    messages: PROFILE_MESSAGES,
  });
}
