const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
export const formatAvailabilityPrice = (price: number) => pesos.format(price);
const months = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
export const formatBusinessDate = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${Number(day)} de ${months[Number(month) - 1]} de ${year}`;
};

// No remote origins are configured yet. Never make Next optimize an arbitrary URL.
export function productImageSource(image: string | null): string | null {
  if (
    !image ||
    !/^\/(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.(?:png|jpe?g|webp|avif|gif)$/i.test(
      image,
    ) ||
    image.split("/").some((part) => part === "." || part === "..")
  )
    return null;
  return image;
}
