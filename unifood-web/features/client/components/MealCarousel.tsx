"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
} from "lucide-react";
import type { CatalogMeal } from "../types";
import { mealHref } from "../mocks/catalog";
import styles from "./MealCarousel.module.css";

export default function MealCarousel({
  meals,
  siteId,
}: {
  meals: CatalogMeal[];
  siteId: string;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovering, setHovering] = useState(false);
  const [motionSafe, setMotionSafe] = useState(false);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const visible = useRef(true);
  const region = useRef<HTMLElement>(null);
  const count = meals.length;
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setMotionSafe(!query.matches);
      if (query.matches) setPlaying(false);
    };
    const timer = setTimeout(update, 0);
    query.addEventListener("change", update);
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
    });
    if (region.current) observer.observe(region.current);
    return () => {
      clearTimeout(timer);
      query.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!playing || hovering || !motionSafe || count < 2) return;
    const timer = setInterval(() => {
      if (!document.hidden && visible.current)
        setIndex((current) => (current + 1) % count);
    }, 3000);
    return () => clearInterval(timer);
  }, [playing, hovering, motionSafe, count]);
  const move = (direction: number) => {
    setPlaying(false);
    setIndex((current) => (current + direction + count) % count);
  };
  if (!count)
    return (
      <p className={styles.empty}>
        Estamos preparando el menú. Vuelve a consultar más tarde.
      </p>
    );
  return (
    <section
      ref={region}
      className={styles.carousel}
      aria-label="Platos de hoy"
      aria-roledescription="carrusel"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovering(true);
      }}
      onPointerLeave={() => setHovering(false)}
    >
      <div
        className={styles.viewport}
        onFocusCapture={() => setPlaying(false)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          setPlaying(false);
          swiped.current = false;
          gesture.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onPointerUp={(event) => {
          if (!gesture.current) return;
          const dx = event.clientX - gesture.current.x;
          const dy = event.clientY - gesture.current.y;
          gesture.current = null;
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
            swiped.current = true;
            move(dx < 0 ? 1 : -1);
          }
        }}
        onClickCapture={(event) => {
          if (swiped.current) {
            event.preventDefault();
            event.stopPropagation();
            swiped.current = false;
          }
        }}
      >
        <div
          className={styles.track}
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {meals.map((meal, position) => {
            return (
              <div
                key={meal.id}
                className={styles.slide}
                role="group"
                aria-roledescription="diapositiva"
                aria-label={`${position + 1} de ${count}`}
                aria-hidden={position !== index}
                inert={position !== index}
              >
                <Link
                  className={styles.offer}
                  href={mealHref(siteId, meal.id)}
                  aria-label={`Ver ${meal.name}`}
                  draggable={false}
                >
                  <Image
                    src={meal.image}
                    alt={meal.name}
                    fill
                    sizes="(max-width: 680px) 100vw, 640px"
                    priority={position === 0}
                    draggable={false}
                  />
                  <span className={styles.kind}>
                    {meal.kind === "breakfast" ? "Desayuno" : "Almuerzo"}
                  </span>
                  <span className={styles.copy}>
                    <strong>{meal.name}</strong>
                    <span>El sabor de tu próxima pausa.</span>
                  </span>
                  <span className={styles.arrow}>
                    <ArrowRight size={24} aria-hidden="true" />
                  </span>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
      {count > 1 && (
        <div className={styles.controls}>
          <button
            type="button"
            aria-label="Plato anterior"
            onClick={() => move(-1)}
          >
            <ChevronLeft size={21} aria-hidden="true" />
          </button>
          <div className={styles.dots}>
            {meals.map((meal, position) => (
              <button
                key={meal.id}
                type="button"
                aria-label={`Mostrar plato ${position + 1}: ${meal.name}`}
                aria-current={position === index ? "true" : undefined}
                onClick={() => {
                  setPlaying(false);
                  setIndex(position);
                }}
              >
                <span />
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Siguiente plato"
            onClick={() => move(1)}
          >
            <ChevronRight size={21} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={
              playing && motionSafe ? "Pausar carrusel" : "Reproducir carrusel"
            }
            onClick={() => {
              setPlaying((value) => !value);
              setMotionSafe(true);
            }}
          >
            {playing && motionSafe ? (
              <Pause size={17} aria-hidden="true" />
            ) : (
              <Play size={17} aria-hidden="true" />
            )}
          </button>
        </div>
      )}
      <span className={styles.srOnly} aria-live={playing ? "off" : "polite"}>
        {meals[index]?.name}, {index + 1} de {count}
      </span>
    </section>
  );
}
