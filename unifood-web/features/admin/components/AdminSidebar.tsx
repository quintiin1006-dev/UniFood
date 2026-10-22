"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Utensils, UserRound } from "lucide-react";
import styles from "./Admin.module.css";

const navigation = [
  { href: "/admin", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/catalogo", label: "Catálogo", Icon: Utensils },
  { href: "/admin/perfil", label: "Mi perfil", Icon: UserRound },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className={styles.sidebarContent}>
      <div className={styles.brand}>
        <Image src="/unifood-logo.png" width={42} height={42} alt="" />
        <div>
          <strong>
            Uni<span>Food</span>
          </strong>
          <small>Administración</small>
        </div>
      </div>
      <nav aria-label="Administración">
        {navigation.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      <p className={styles.sidebarCaption}>Tu cafetería, en un solo lugar.</p>
    </div>
  );
}
