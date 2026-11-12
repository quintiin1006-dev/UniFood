import type { ClientContext, ContextCafeteria, ContextSite } from "../types";
import { asRecord, asText, parseCafeteria } from "./menu";

/** Converts the untrusted GET /api/me/context payload; null when its shape is unexpected. */
export function toClientContext(payload: unknown): ClientContext | null {
  const body = asRecord(payload);
  const institution = asRecord(body?.institution);
  if (!body || !institution || !Array.isArray(body.sites)) return null;
  const institutionId = asText(institution.id);
  const institutionName = asText(institution.name);
  if (!institutionId || !institutionName) return null;
  const seen = new Set<string>();
  const sites = body.sites
    .map((value): ContextSite | null => {
      const site = asRecord(value);
      const id = asText(site?.id);
      const name = asText(site?.name);
      if (!site || !id || !name || !Array.isArray(site.cafeterias)) return null;
      const cafeterias = site.cafeterias
        .map(parseCafeteria)
        .filter((cafeteria): cafeteria is ContextCafeteria => {
          if (!cafeteria || seen.has(cafeteria.id)) return false;
          seen.add(cafeteria.id);
          return true;
        });
      return { id, name, cafeterias };
    })
    .filter((site): site is ContextSite => site !== null);
  const activeOrder = asRecord(body.activeOrder);
  return {
    fullName: asText(body.fullName),
    institution: { id: institutionId, name: institutionName },
    sites,
    activeOrderId: asText(activeOrder?.id),
  };
}

export function findCafeteria(context: ClientContext, cafeteriaId: unknown) {
  if (typeof cafeteriaId !== "string") return undefined;
  for (const site of context.sites) {
    const cafeteria = site.cafeterias.find(({ id }) => id === cafeteriaId);
    if (cafeteria) return { site, cafeteria };
  }
  return undefined;
}

export function allCafeterias(context: ClientContext) {
  return context.sites.flatMap((site) => site.cafeterias);
}

/** Where a site card leads: straight to the cafeteria when it is the only one (§4). */
export function siteHref(site: ContextSite) {
  return site.cafeterias.length === 1
    ? cafeteriaHref(site.cafeterias[0].id)
    : `/cuenta?sede=${encodeURIComponent(site.id)}`;
}
export function cafeteriaHref(cafeteriaId: string) {
  return `/cuenta?cafeteria=${encodeURIComponent(cafeteriaId)}`;
}
/** The selector stays visible even with one option; this link always opens the selection. */
export const CHANGE_CAFETERIA_HREF = "/cuenta?elegir=1";

export type Selection =
  | { view: "home"; site: ContextSite; cafeteria: ContextCafeteria }
  | { view: "sites"; sites: ContextSite[]; stale: boolean; choosing: boolean }
  | {
      view: "cafeterias";
      site: ContextSite;
      singleSite: boolean;
      stale: boolean;
      choosing: boolean;
    };

/**
 * Resolves /cuenta from the context and the URL. The cafeteria is validated against the
 * context on every request; one that is no longer listed returns to the selection (§4).
 */
export function resolveSelection(
  context: ClientContext,
  query: { cafeteria?: unknown; sede?: unknown; elegir?: unknown },
): Selection {
  // An explicit choice (the selector or a site link) never jumps to the cached cafeteria.
  const choosing = query.elegir === "1" || typeof query.sede === "string";
  const chosen = findCafeteria(context, query.cafeteria);
  if (chosen && !choosing) return { view: "home", ...chosen };
  const stale = typeof query.cafeteria === "string" && !chosen;
  const options = allCafeterias(context);
  if (options.length === 1 && !choosing && !stale) {
    const only = findCafeteria(context, options[0].id)!;
    return { view: "home", ...only };
  }
  const site =
    context.sites.find(({ id }) => id === query.sede) ??
    (context.sites.length === 1 ? context.sites[0] : undefined);
  if (site)
    return {
      view: "cafeterias",
      site,
      singleSite: context.sites.length === 1,
      stale,
      choosing,
    };
  return { view: "sites", sites: context.sites, stale, choosing };
}
