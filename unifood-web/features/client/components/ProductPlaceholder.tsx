import styles from "./ClientMenu.module.css";

/** The backend sends imageUrl: null for now; every product shows its initial (§6). */
export default function ProductPlaceholder({
  name,
  size,
}: {
  name: string;
  size: "card" | "rail" | "line" | "hero";
}) {
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase("es") ?? "?";
  return (
    <span className={styles.placeholder} data-size={size} aria-hidden="true">
      {initial}
    </span>
  );
}
