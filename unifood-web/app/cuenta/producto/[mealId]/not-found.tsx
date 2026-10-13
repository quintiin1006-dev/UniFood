import Link from "next/link";
import styles from "@/features/client/components/ClientShopping.module.css";
export default function ProductNotFound() {
  return (
    <section className={styles.empty}>
      <h1>No encontramos este plato</h1>
      <p>Explora el menú de tu cafetería para elegir otro.</p>
      <Link className={styles.primaryButton} href="/cuenta">
        Volver al inicio
      </Link>
    </section>
  );
}
