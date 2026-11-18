import { redirect } from "next/navigation";

// «Historial» is no longer a tab: Pedido and Historial are one module at /cuenta/pedido.
// The old address redirects so links and bookmarks keep working.
export default function OrderHistoryRedirectPage() {
  redirect("/cuenta/pedido");
}
