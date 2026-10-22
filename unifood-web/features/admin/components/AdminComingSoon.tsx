import styles from "./Admin.module.css";

export function AdminComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className={styles.section} aria-labelledby="admin-section-title">
      <p className={styles.eyebrow}>TU ESPACIO ADMINISTRATIVO</p>
      <h1 id="admin-section-title">{title}</h1>
      <p className={styles.intro}>{description}</p>
      <div className={styles.comingSoon}>
        <span className={styles.comingSoonLabel}>Próximamente</span>
        <h2>Estamos preparando este espacio</h2>
        <p>
          Mientras tanto, puedes consultar los datos de tu cuenta y cafetería en
          Mi perfil.
        </p>
      </div>
    </section>
  );
}
