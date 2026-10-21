export type AdminBusinessProfile = {
  role: "ADMIN";
  cafeteria: { name: string; active: boolean };
  site: { name: string };
  institution: { name: string };
};
export type AdminProfile = AdminBusinessProfile & { email: string };
