import "server-only";
import { unstable_rethrow } from "next/navigation";
import { serverApiUrl } from "@/config/server";
import type { ClientDetails } from "../types";

/** The caller supplies its verified session token; Spring resolves identity and business access. */
export async function getClientDetails(
  accessToken: string,
): Promise<ClientDetails> {
  const empty: ClientDetails = {
    document: null,
    phone: null,
    institution: null,
    unavailable: true,
  };
  try {
    const response = await fetch(`${serverApiUrl()}/api/me/profile`, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (response.status !== 200) return empty;
    const data = await response.json();
    if (
      !data ||
      typeof data.document !== "string" ||
      !(data.phone === null || typeof data.phone === "string") ||
      !(data.institution === null || typeof data.institution === "string")
    )
      return empty;
    return {
      document: data.document,
      phone: data.phone,
      institution: data.institution,
      unavailable: data.institution === null,
    };
  } catch (error) {
    unstable_rethrow(error);
    return empty;
  }
}
