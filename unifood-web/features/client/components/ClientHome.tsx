"use client";
import Link from "next/link";
import { Coffee, Utensils, Clock3 } from "lucide-react";
import type { ClientSite } from "../types";
import {
  featuredMeals,
  serviceAvailability,
  serviceHours,
} from "../domain/catalog";
import { useColombiaClock } from "../hooks/useColombiaClock";
import CafeteriaSelector from "./CafeteriaSelector";
import MealCarousel from "./MealCarousel";
import { useClientCart } from "./ClientCartProvider";
import styles from "./ClientCatalog.module.css";

export default function ClientHome({
  fullName,
  site,
  initialTime,
}: {
  fullName: string | null;
  site: ClientSite;
  initialTime: string;
}) {
  const now = useColombiaClock(initialTime);
  const { ignoreServiceHours } = useClientCart();
  const firstName = fullName?.trim().split(/\s+/)[0];
  const featured = featuredMeals(site.meals, now);
  const offersBreakfast = site.meals.some((meal) => meal.kind === "breakfast");
  return (
    <section className={styles.home} aria-labelledby="client-home-title">
      <div className={styles.pageHeading}>
        <h1 id="client-home-title">
          ¡Hola{firstName ? `, ${firstName}` : ""}!
        </h1>
        <p>¿Qué te gustaría comer hoy?</p>
      </div>
      <CafeteriaSelector site={site} />
      <MealCarousel
        key={`${site.id}-${featured.map((meal) => meal.id).join("-")}`}
        meals={featured}
        siteId={site.id}
      />
      <div>
        <h2 className={styles.sectionTitle}>Elige tu momento</h2>
        <nav className={styles.mealTypes} aria-label="Tipos de comida">
          {(["breakfast", "lunch"] as const).map((kind) => {
            const breakfast = kind === "breakfast";
            const notServed = breakfast && !offersBreakfast;
            const open =
              !notServed &&
              serviceAvailability(kind, now, ignoreServiceHours).open;
            const Icon = breakfast ? Coffee : Utensils;
            const content = (
              <>
                <Icon size={30} strokeWidth={1.7} aria-hidden="true" />
                <strong>{breakfast ? "Desayunos" : "Almuerzos"}</strong>
                <span>
                  {notServed ? "No se sirve en esta sede" : serviceHours(kind)}
                </span>
                {!open && (
                  <small>
                    <Clock3 size={13} aria-hidden="true" />
                    {notServed ? "Otra sede" : "Fuera de horario"}
                  </small>
                )}
              </>
            );
            return open ? (
              <Link
                key={kind}
                className={breakfast ? styles.breakfastType : styles.lunchType}
                href={`/cuenta/menu?sede=${site.id}&categoria=${breakfast ? "desayunos" : "almuerzos"}`}
              >
                {content}
              </Link>
            ) : (
              <button
                key={kind}
                type="button"
                className={breakfast ? styles.breakfastType : styles.lunchType}
                disabled
              >
                {content}
              </button>
            );
          })}
        </nav>
        <p className={styles.scheduleNote}>Horarios de atención de Colombia.</p>
      </div>
    </section>
  );
}
