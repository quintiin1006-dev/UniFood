import Link from "next/link";
import styles from "@/features/client/components/ClientShopping.module.css";
export default function ProductNotFound() {
  return (
    <section className={styles.empty}>
      <h1>Este producto no está disponible</h1>
      <p>Ya no está en el menú de tu cafetería. Elige otro producto.</p>
      <Link className={styles.primaryButton} href="/cuenta">
        Volver al inicio
      </Link>
    </section>
  );
}
