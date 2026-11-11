import type { SuperAdminCafeterias } from "./types";

export type CafeteriaRow = {
  id: string;
  name: string;
  institution: string;
  institutionActive: boolean;
  site: string;
  city: string;
  siteActive: boolean;
  subscribed: boolean;
  hasActiveAdmin: boolean;
};

/** Flattens the tree in the server's order, one row per cafeteria. */
export function cafeteriaRows(data: SuperAdminCafeterias): CafeteriaRow[] {
  return data.institutions.flatMap((institution) =>
    institution.sites.flatMap((site) =>
      site.cafeterias.map((cafeteria) => ({
        id: cafeteria.id,
        name: cafeteria.name,
        institution: institution.name,
        institutionActive: institution.active,
        site: site.name,
        city: site.city,
        siteActive: site.active,
        subscribed: cafeteria.subscribed,
        hasActiveAdmin: cafeteria.hasActiveAdmin,
      })),
    ),
  );
}

export function summary(data: SuperAdminCafeterias) {
  const rows = cafeteriaRows(data);
  const sites = data.institutions.reduce(
    (total, institution) => total + institution.sites.length,
    0,
  );
  return {
    institutions: data.institutions.length,
    sites,
    cafeterias: rows.length,
    subscribed: rows.filter((row) => row.subscribed).length,
  };
}

export const subscriptionLabel = (subscribed: boolean) =>
  subscribed ? "Activa" : "Inactiva";
export const adminLabel = (hasActiveAdmin: boolean) =>
  hasActiveAdmin ? "Asignado" : "Sin ADMIN activo";
