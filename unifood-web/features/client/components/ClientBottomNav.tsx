"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { House, UserRound, ShoppingCart, ReceiptText } from "lucide-react";
import { useClientCart } from "./ClientCartProvider";
import { cafeteriaHref } from "../domain/context";
import styles from "./ClientShell.module.css";

export default function ClientBottomNav() {
  const pathname = usePathname();
  const profileActive = pathname.startsWith("/cuenta/perfil");
  const cartActive =
    pathname === "/cuenta/carrito" || pathname.startsWith("/cuenta/carrito/");
  const { count, cart } = useClientCart();
  const query = useSearchParams();
  // The server validates this id against the context; an unknown one returns to the selection.
  const cafeteriaId = query.get("cafeteria") ?? cart.cafeteriaId;

  return (
    <nav className={styles.nav} aria-label="Navegación del estudiante">
      <div className={styles.navInner}>
        <Link
          href={cafeteriaId ? cafeteriaHref(cafeteriaId) : "/cuenta"}
          className={styles.navItem}
          aria-current={!profileActive && !cartActive ? "page" : undefined}
        >
          <House size={22} aria-hidden="true" />
          <span>Inicio</span>
        </Link>
        <button
          type="button"
          className={styles.navItem}
          disabled
          aria-label="Pedidos, próximamente"
        >
          <ReceiptText size={22} aria-hidden="true" />
          <span>Pedidos</span>
        </button>
        <Link
          href="/cuenta/carrito"
          className={styles.navItem}
          aria-current={cartActive ? "page" : undefined}
          aria-label={`Carrito${count ? `, ${count} ${count === 1 ? "unidad" : "unidades"}` : ""}`}
        >
          <span className={styles.cartIcon}>
            <ShoppingCart size={22} aria-hidden="true" />
            {count > 0 && (
              <span className={styles.cartBadge} key={count} aria-hidden="true">
                {count}
              </span>
            )}
          </span>
          <span>Carrito</span>
        </Link>
        <Link
          href="/cuenta/perfil"
          className={styles.navItem}
          aria-current={profileActive ? "page" : undefined}
        >
          <UserRound size={22} aria-hidden="true" />
          <span>Perfil</span>
        </Link>
      </div>
    </nav>
  );
}
