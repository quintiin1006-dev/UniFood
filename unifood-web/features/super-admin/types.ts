export type SuperAdminCafeteria = {
  id: string;
  name: string;
  /** `cafeterias.is_active` until subscriptions get their own table (decisiones §5). */
  subscribed: boolean;
  hasActiveAdmin: boolean;
};

export type SuperAdminSite = {
  id: string;
  name: string;
  city: string;
  active: boolean;
  cafeterias: SuperAdminCafeteria[];
};

export type SuperAdminInstitution = {
  id: string;
  name: string;
  active: boolean;
  sites: SuperAdminSite[];
};

export type SuperAdminCafeterias = { institutions: SuperAdminInstitution[] };
