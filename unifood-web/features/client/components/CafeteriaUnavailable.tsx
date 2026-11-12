import Link from "next/link";
import { Store } from "lucide-react";
import { CHANGE_CAFETERIA_HREF } from "../domain/context";
import shared from "./ClientShopping.module.css";

/** 404 CAFETERIA_NOT_FOUND or 403 CAFETERIA_NOT_SUBSCRIBED, with a fixed message. */
export default function CafeteriaUnavailable() {
  return (
    <section className={shared.empty} role="alert">
      <Store size={44} strokeWidth={1.4} aria-hidden="true" />
      <h1>Esta cafetería no está disponible</h1>
      <p>Elige otra cafetería de tu sede para ver su menú.</p>
      <Link className={shared.primaryButton} href={CHANGE_CAFETERIA_HREF}>
        Elegir cafetería
      </Link>
    </section>
  );
}
