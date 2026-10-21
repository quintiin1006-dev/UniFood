export function adminProfileBusinessFixture() {
  return {
    role: "ADMIN",
    cafeteria: { name: "Cafetería Principal", active: true },
    site: { name: "Sede Villavicencio" },
    institution: { name: "Universidad de prueba" },
  };
}
export function adminProfileFixture() {
  return { email: "admin@example.invalid", ...adminProfileBusinessFixture() };
}
