import { productImageSource } from "@/features/availability/presentation";

const uuid = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const managed = new RegExp(
  `^/api/admin/catalog/(${uuid})/image/(${uuid})$`,
  "i",
);
/** ADMIN-only private route. WORKER's shared legacy-image policy stays unchanged. */
export function managedCatalogImage(source: string | null, productId?: string) {
  const match = source?.match(managed);
  return (
    !!match &&
    (!productId || match[1].toLowerCase() === productId.toLowerCase())
  );
}
export function adminImageSource(source: string | null, productId?: string) {
  return managedCatalogImage(source, productId)
    ? source
    : productImageSource(source);
}
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const IMAGE_MESSAGES = {
  ADMIN_CATALOG_IMAGE_INVALID_REQUEST: "Revisa los datos de la imagen.",
  ADMIN_CATALOG_IMAGE_TOO_LARGE: "La imagen debe pesar como máximo 3 MB.",
  ADMIN_CATALOG_IMAGE_UNSUPPORTED_FORMAT:
    "Selecciona una imagen JPEG o PNG estática.",
  ADMIN_CATALOG_IMAGE_INVALID_CONTENT:
    "La imagen no es válida. Usa JPEG o PNG estática, con lados entre 256 y 4096 px y hasta 16 millones de píxeles.",
  ADMIN_CATALOG_IMAGE_IDEMPOTENCY_CONFLICT:
    "Esta imagen ya se estaba subiendo desde otro intento. Revisa el producto antes de continuar.",
  ADMIN_CATALOG_IMAGE_TEMPORARILY_UNAVAILABLE:
    "No sabemos si la imagen se guardó. Conservamos tu selección; revisa el producto antes de volver a subirla.",
  ADMIN_CATALOG_IMAGE_INTERNAL_ERROR:
    "No sabemos si la imagen se guardó. Revisa el producto.",
} as const;
