import Link from "next/link";
import { ArrowLeft, ChevronRight, MapPin, Store } from "lucide-react";
import { allCafeterias, siteHref, type Selection } from "../domain/context";
import type { ClientContext, ContextSite } from "../types";
import CafeteriaLink from "./CafeteriaLink";
import { RestoreCafeteria } from "./CafeteriaMemory";
import styles from "./ClientCatalog.module.css";
import menuStyles from "./ClientMenu.module.css";

const NO_CAFETERIAS = "Aún no hay cafeterías disponibles en tu sede";

/** Site first, then cafeteria, among the subscribed ones the context lists (§4, §5). */
export default function SiteSelection({
  ownerId,
  context,
  selection,
}: {
  ownerId: string;
  context: ClientContext;
  selection: Exclude<Selection, { view: "home" }>;
}) {
  const allowed = allCafeterias(context).map(({ id }) => id);
  const restore = !selection.stale && !selection.choosing && (
    <RestoreCafeteria ownerId={ownerId} allowed={allowed} />
  );
  const stale = selection.stale && (
    <p className={menuStyles.closed} role="status">
      La cafetería que elegiste ya no está disponible. Elige otra para
      continuar.
    </p>
  );
  if (selection.view === "cafeterias")
    return (
      <section className={styles.selection} aria-labelledby="site-title">
        {restore}
        {!selection.singleSite && (
          <Link className={styles.back} href="/cuenta?elegir=1">
            <ArrowLeft size={22} aria-hidden="true" />
            Cambiar de sede
          </Link>
        )}
        <div className={styles.pageHeading}>
          <p className={styles.eyebrow}>{selection.site.name.toUpperCase()}</p>
          <h1 id="site-title">Elige tu cafetería</h1>
          <p>Te mostraremos su menú de hoy.</p>
        </div>
        {stale}
        <CafeteriaList site={selection.site} />
      </section>
    );
  return (
    <section className={styles.selection} aria-labelledby="site-title">
      {restore}
      <div className={styles.pageHeading}>
        <p className={styles.eyebrow}>BIENVENIDO A UNIFOOD</p>
        <h1 id="site-title">
          ¿Dónde vas a<br />
          pedir hoy?
        </h1>
        <p>Selecciona tu sede para ver sus cafeterías.</p>
      </div>
      {stale}
      {selection.sites.length ? (
        <ul className={styles.siteList} aria-label="Sedes">
          {selection.sites.map((site) => {
            const content = (
              <>
                <MapPin size={26} strokeWidth={1.6} aria-hidden="true" />
                <span className={styles.siteText}>
                  <strong>{site.name}</strong>
                  <span>
                    {site.cafeterias.length === 0
                      ? "Sin cafeterías disponibles"
                      : site.cafeterias.length === 1
                        ? site.cafeterias[0].name
                        : `${site.cafeterias.length} cafeterías`}
                  </span>
                </span>
                <ChevronRight size={22} aria-hidden="true" />
              </>
            );
            return (
              <li key={site.id}>
                {site.cafeterias.length === 1 ? (
                  <CafeteriaLink
                    className={styles.siteCard}
                    cafeteriaId={site.cafeterias[0].id}
                  >
                    {content}
                  </CafeteriaLink>
                ) : (
                  <Link className={styles.siteCard} href={siteHref(site)}>
                    {content}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={menuStyles.compact}>{NO_CAFETERIAS}.</p>
      )}
    </section>
  );
}

function CafeteriaList({ site }: { site: ContextSite }) {
  if (!site.cafeterias.length)
    return (
      <div className={menuStyles.state}>
        <Store size={36} strokeWidth={1.5} aria-hidden="true" />
        <h2>{NO_CAFETERIAS}</h2>
        <p>Vuelve a consultar más tarde.</p>
      </div>
    );
  return (
    <ul className={styles.siteList} aria-label="Cafeterías">
      {site.cafeterias.map((cafeteria) => (
        <li key={cafeteria.id}>
          <CafeteriaLink className={styles.siteCard} cafeteriaId={cafeteria.id}>
            <Store size={26} strokeWidth={1.6} aria-hidden="true" />
            <span className={styles.siteText}>
              <strong>{cafeteria.name}</strong>
              <span
                className={menuStyles.cafeteriaStatus}
                data-open={cafeteria.open}
              >
                {cafeteria.open ? "Abierta" : "Cerrada por ahora"}
              </span>
            </span>
            <ChevronRight size={22} aria-hidden="true" />
          </CafeteriaLink>
        </li>
      ))}
    </ul>
  );
}
