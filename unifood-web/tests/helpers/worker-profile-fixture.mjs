export function workerProfileBusinessFixture() {
  return {
    role: "WORKER",
    cafeteria: { name: "Cafetería Principal", active: true },
    site: { name: "Sede Villavicencio" },
    institution: { name: "Universidad de prueba" },
  };
}
export function workerProfileFixture() {
  return { email: "worker@example.invalid", ...workerProfileBusinessFixture() };
}
