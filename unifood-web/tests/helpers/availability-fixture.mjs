export const availabilityItemId = "00000000-0000-0000-0000-000000000021";
export function browserAvailabilityFixture() {
  const item = (suffix, name, image = null, available = false) => ({
    id: `00000000-0000-0000-0000-${String(suffix).padStart(12, "0")}`,
    name,
    description: null,
    price: 15000,
    image,
    available,
  });
  return {
    businessDate: "2026-10-13",
    cafeteria: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Cafetería de prueba",
      active: true,
      open: false,
    },
    categories: [
      { category: "DEL_DIA", items: [item(23, "Producto del día")] },
      {
        category: "CORRIENTE",
        items: [
          item(21, "Almuerzo corriente", "/unifood-logo.png"),
          item(22, "Segundo producto"),
          item(24, "Corriente tres", "/photos/missing-product.jpg"),
          item(25, "Corriente cuatro"),
          item(26, "Corriente cinco"),
          item(27, "Corriente seis"),
        ],
      },
      { category: "EJECUTIVO", items: [item(28, "Almuerzo ejecutivo")] },
      { category: "ESPECIAL", items: [] },
      {
        category: "DESAYUNO",
        items: [
          item(29, "Desayuno", "https://unknown.example.invalid/product.jpg"),
        ],
      },
    ],
  };
}
