import Image from "next/image";
import { ChevronRight, MapPin } from "lucide-react";
import { demoSites } from "../mocks/catalog";
import SiteLink from "./SiteLink";
import styles from "./ClientCatalog.module.css";

export default function SiteSelection() {
  return (
    <section className={styles.selection} aria-labelledby="site-title">
      <div className={styles.pageHeading}>
        <p className={styles.eyebrow}>BIENVENIDO A UNIFOOD</p>
        <h1 id="site-title">
          ¿Dónde vas a<br />
          pedir hoy?
        </h1>
        <p>Selecciona tu sede para explorar el menú.</p>
      </div>
      <ul className={styles.siteList} aria-label="Sedes">
        {demoSites.map((site) => (
          <li key={site.id}>
            <SiteLink className={styles.siteCard} siteId={site.id}>
              <Image
                src={site.image}
                alt=""
                width={132}
                height={144}
                sizes="(max-width: 375px) 88px, 120px"
              />
              <span className={styles.siteText}>
                <strong>{site.name}</strong>
                <span>
                  <MapPin size={16} aria-hidden="true" />
                  {site.city}
                </span>
              </span>
              <ChevronRight size={22} aria-hidden="true" />
            </SiteLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
