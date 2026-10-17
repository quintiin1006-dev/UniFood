export type WorkerBusinessProfile = {
  role: "WORKER";
  cafeteria: { name: string; active: boolean };
  site: { name: string };
  institution: { name: string };
};
export type WorkerProfile = WorkerBusinessProfile & { email: string };
