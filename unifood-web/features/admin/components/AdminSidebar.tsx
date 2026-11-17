"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import styles from "./Admin.module.css";

const navigation: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard" },
  { href: "/admin/catalogo", label: "Catálogo", icon: "catalogo" },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className={styles.sidebarContent}>
      <div className={styles.brand}>
        <Image
          src="/unifood-logo.png"
          width={52}
          height={52}
          className={styles.brandMark}
          alt=""
        />
        <div>
          <strong>UniFood</strong>
          <small>Administración</small>
        </div>
      </div>
      <nav aria-label="Administración">
        {navigation.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon
              name={icon}
              size={20}
              tone={pathname === href ? "active" : "inherit"}
            />
            {label}
          </Link>
        ))}
        <div className={styles.secondaryNav}>
          <Link
            href="/admin/perfil"
            aria-current={pathname === "/admin/perfil" ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon
              name="perfil"
              size={20}
              tone={pathname === "/admin/perfil" ? "active" : "inherit"}
            />
            Mi perfil
          </Link>
        </div>
      </nav>
    </div>
  );
}
