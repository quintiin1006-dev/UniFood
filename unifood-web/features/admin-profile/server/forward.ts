import "server-only";
import { isAdmin } from "@/features/auth/validation";
import { forwardPanelProfile } from "@/features/panel-profile/server/forward";
import { parseAdminBusinessProfile } from "../contracts";
import { PROFILE_MESSAGES, profileErrorCode } from "../errors";

export function forwardAdminProfile() {
  return forwardPanelProfile({
    path: "/api/admin/profile",
    admits: isAdmin,
    parse: parseAdminBusinessProfile,
    errorCode: profileErrorCode,
    messages: PROFILE_MESSAGES,
  });
}
