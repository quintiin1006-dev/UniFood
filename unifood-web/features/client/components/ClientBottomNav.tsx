"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { useClientCart } from "./ClientCartProvider";
import { cafeteriaHref } from "../domain/context";
import styles from "./ClientShell.module.css";

export default function ClientBottomNav() {
  const pathname = usePathname();
  const profileActive = pathname.startsWith("/cuenta/perfil");
  const orderActive = pathname.startsWith("/cuenta/pedido");
  const historyActive = pathname.startsWith("/cuenta/historial");
  const cartActive =
    pathname === "/cuenta/carrito" || pathname.startsWith("/cuenta/carrito/");
  const homeActive =
    !profileActive && !cartActive && !orderActive && !historyActive;
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
          aria-current={homeActive ? "page" : undefined}
        >
          <Icon
            name="inicio"
            size={22}
            tone={homeActive ? "active" : "inherit"}
          />
          <span>Inicio</span>
        </Link>
        <Link
          href="/cuenta/pedido"
          className={styles.navItem}
          aria-current={orderActive ? "page" : undefined}
        >
          <Icon
            name="mi-pedido"
            size={22}
            tone={orderActive ? "active" : "inherit"}
          />
          <span>Pedido</span>
        </Link>
        <Link
          href="/cuenta/historial"
          className={styles.navItem}
          aria-current={historyActive ? "page" : undefined}
        >
          <Icon
            name="historial"
            size={22}
            tone={historyActive ? "active" : "inherit"}
          />
          <span>Historial</span>
        </Link>
        <Link
          href="/cuenta/carrito"
          className={styles.navItem}
          aria-current={cartActive ? "page" : undefined}
          aria-label={`Carrito${count ? `, ${count} ${count === 1 ? "unidad" : "unidades"}` : ""}`}
        >
          <span className={styles.cartIcon}>
            <Icon
              name="carrito"
              size={22}
              tone={cartActive ? "active" : "inherit"}
            />
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
          <Icon
            name="perfil"
            size={22}
            tone={profileActive ? "active" : "inherit"}
          />
          <span>Perfil</span>
        </Link>
      </div>
    </nav>
  );
}
