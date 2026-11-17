import Brand from "./Brand";
import AcceptTermsForm, {
  TERMS_DESCRIPTION,
  TERMS_TITLE,
  type InitialTermsState,
} from "./AcceptTermsForm";
import styles from "./AuthScreen.module.css";

/**
 * The same card as the login, with the acceptance step inside, for a session that reaches a
 * client screen without having accepted the current terms. The login shows this step in its
 * own card instead, through AcceptTermsForm.
 */
export default function AcceptTermsScreen({
  destination,
  state = "pending",
}: {
  destination: string;
  state?: InitialTermsState;
}) {
  return (
    <main className={styles.screen} lang="es">
      <div className={styles.canvas}>
        <div className={styles.content}>
          <Brand entrypoint="client" />
          <h1 className={styles.heading}>{TERMS_TITLE}</h1>
          <p className={styles.description}>{TERMS_DESCRIPTION}</p>
          <AcceptTermsForm destination={destination} initialState={state} />
        </div>
      </div>
    </main>
  );
}
