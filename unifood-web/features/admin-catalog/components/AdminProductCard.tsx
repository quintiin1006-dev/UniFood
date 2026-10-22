"use client";
import { useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { productImageSource } from "@/features/availability/presentation";
import { CATEGORY_LABELS, type AdminProduct } from "../types";
import { formatCatalogPrice } from "../presentation";
import styles from "./AdminCatalog.module.css";

export function AdminProductCard({
  product,
  disabled = true,
  onEdit,
  onStatus,
}: {
  product: AdminProduct;
  disabled?: boolean;
  onEdit?: () => void;
  onStatus?: () => void;
}) {
  const source = productImageSource(product.imageUrl);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <article className={styles.card} aria-label={product.name}>
      <div className={styles.photo}>
        {source && source !== failed ? (
          <Image
            src={source}
            alt={product.name}
            fill
            sizes="(max-width: 699px) 100vw, (max-width: 1199px) 50vw, (max-width: 1679px) 30vw, 280px"
            className={styles.image}
            onError={() => setFailed(source)}
          />
        ) : (
          <div className={styles.placeholder}>
            <ImageOff size={30} strokeWidth={1.4} aria-hidden="true" />
            <span>Sin imagen</span>
          </div>
        )}
      </div>
      <div className={styles.cardBody}>
        <p className={styles.category}>{CATEGORY_LABELS[product.category]}</p>
        <h2>{product.name}</h2>
        {product.description?.trim() && (
          <p className={styles.description}>{product.description}</p>
        )}
        <div className={styles.cardFooter}>
          <p className={styles.price}>{formatCatalogPrice(product.price)}</p>
          <span className={product.active ? styles.active : styles.inactive}>
            {product.active ? "Activo" : "Inactivo"}
          </span>
        </div>
        {onEdit && onStatus && (
          <div className={styles.actions}>
            <button
              type="button"
              disabled={disabled}
              onClick={onEdit}
              aria-label={"Editar " + product.name}
            >
              Editar
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onStatus}
              aria-label={
                (product.active ? "Desactivar " : "Activar ") + product.name
              }
            >
              {product.active ? "Desactivar" : "Activar"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
