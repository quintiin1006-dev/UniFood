"use client";
import { useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import type { AvailabilityItem } from "../types";
import { formatAvailabilityPrice, productImageSource } from "../presentation";
import { AvailabilitySwitch } from "./AvailabilitySwitch";
import styles from "./Availability.module.css";

export function ProductCard({
  item,
  cafeteriaActive,
  busy,
  blocked,
  error,
  onChange,
}: {
  item: AvailabilityItem;
  cafeteriaActive: boolean;
  busy: boolean;
  blocked: boolean;
  error?: string;
  onChange: (id: string, available: boolean) => void;
}) {
  const source = productImageSource(item.image);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const feedbackId = `availability-feedback-${item.id}`;
  return (
    <article className={styles.card} aria-label={item.name} aria-busy={busy}>
      <div className={styles.photo}>
        {source && source !== failedImage ? (
          <Image
            src={source}
            alt={item.name}
            fill
            sizes="(max-width: 340px) 72vw, (max-width: 760px) 244px, 240px"
            className={styles.image}
            onError={() => setFailedImage(source)}
          />
        ) : (
          <div className={styles.placeholder}>
            <ImageOff size={28} aria-hidden="true" />
            <span>Sin imagen</span>
          </div>
        )}
      </div>
      <div className={styles.cardBody}>
        <h4 className={styles.productName}>{item.name}</h4>
        <p className={styles.price}>{formatAvailabilityPrice(item.price)}</p>
        <AvailabilitySwitch
          checked={item.available}
          disabled={busy || blocked || (!cafeteriaActive && !item.available)}
          label={`Disponibilidad de ${item.name}`}
          text={item.available ? "Disponible" : "No disponible"}
          descriptionId={feedbackId}
          onChange={(value) => onChange(item.id, value)}
        />
        <p
          id={feedbackId}
          className={styles.feedback}
          role={error ? "alert" : "status"}
        >
          {busy ? "Guardando…" : (error ?? "")}
        </p>
      </div>
    </article>
  );
}
