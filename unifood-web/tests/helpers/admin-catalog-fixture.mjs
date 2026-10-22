export function adminCatalogFixture(other = false) {
  if (other)
    return {
      products: [
        {
          id: "20000000-0000-0000-0000-000000000001",
          name: "Producto exclusivo de otra cafetería",
          description: null,
          price: "999.99",
          category: "ESPECIAL",
          imageUrl: null,
          active: true,
        },
      ],
    };
  return {
    products: [
      [
        "Ejecutivo de la casa",
        "EJECUTIVO",
        "18500.25",
        true,
        "Pollo, arroz y ensalada.",
        "/unifood-logo.png",
      ],
      ["Corriente casero", "CORRIENTE", "15000.00", false, null, null],
      [
        "Desayuno con café",
        "DESAYUNO",
        "6500.50",
        true,
        "Una opción para comenzar el día.",
        null,
      ],
      ["Especial del chef", "ESPECIAL", "25000.00", true, null, null],
      ["Menú del día", "DEL_DIA", "12500.00", true, null, null],
    ].map(([name, category, price, active, description, imageUrl], index) => ({
      id: "10000000-0000-0000-0000-" + String(index + 1).padStart(12, "0"),
      name,
      category,
      price,
      active,
      description,
      imageUrl,
    })),
  };
}
