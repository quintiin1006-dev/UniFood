import "server-only";
import { authClient } from "@/features/auth/server/client";
import type { ClientDetails } from "../types";

/** Called only with the verified user ID. The session JWT and database RLS scope reads. */
export async function getClientDetails(userId: string): Promise<ClientDetails> {
  const empty: ClientDetails = {
    document: null,
    phone: null,
    institution: null,
    unavailable: true,
  };
  try {
    const client = await authClient();
    const { data, error } = await client
      .from("clients")
      .select("document, phone, institution_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return empty;
    const details: ClientDetails = {
      document: typeof data.document === "string" ? data.document : null,
      phone: typeof data.phone === "string" ? data.phone : null,
      institution: null,
      unavailable: false,
    };
    if (typeof data.institution_id !== "string")
      return { ...details, unavailable: true };
    const institution = await client
      .from("institutions")
      .select("name")
      .eq("id", data.institution_id)
      .maybeSingle();
    return {
      ...details,
      institution:
        typeof institution.data?.name === "string"
          ? institution.data.name
          : null,
      unavailable: !!institution.error || !institution.data,
    };
  } catch {
    return empty;
  }
}
