import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { DemoSite } from "../mocks/catalog";
import styles from "./ClientCatalog.module.css";
export default function CafeteriaSelector({ site }: { site: DemoSite }) {
  return (
    <Link
      className={styles.cafeteriaSelector}
      href="/cuenta"
      aria-label={`Cambiar sede. ${site.cafeteria}, ${site.name}`}
    >
      <Image src={site.image} alt="" width={56} height={56} />
      <span>
        <strong>{site.cafeteria}</strong>
        <small>{site.name}</small>
      </span>
      <ChevronDown size={22} aria-hidden="true" />
    </Link>
  );
}
