"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  DRAWN_ICON_NAMES,
  Icon,
  IconTile,
  OWNER_ICON_NAMES,
} from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { UniFoodLoader } from "@/components/ui/UniFoodLoader";
import ConfirmDialog from "@/features/client/components/ConfirmDialog";
import {
  BoardError,
  BoardLoading,
  SearchEmpty,
  StaleListingBanner,
} from "@/features/orders/components/BoardFeedback";
import {
  listingErrorView,
  syncStatusLabel,
} from "@/features/orders/listingStatus";
import {
  BACKEND_ERROR_CODES,
  BACKEND_ERROR_MESSAGES,
  HEADER_OFFLINE,
  ORDER_STATE_CHANGED,
  SAVING,
  SESSION_EXPIRED,
} from "@/features/shared/messages";

import styles from "./FeedbackGallery.module.css";

const noop = () => {};

/**
 * Every feedback state of UniFood in one place, with its real text (ola 4 · F5). Development only:
 * the page answers 404 in production and nothing in the app links here.
 */
export default function FeedbackGallery() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <main className={styles.page}>
      <header className={styles.intro}>
        <h1>Revisión de feedback</h1>
        <p>
          Todos los estados de respuesta de UniFood con sus textos reales. Solo
          existe en desarrollo; en producción esta ruta responde 404.
        </p>
      </header>

      <section aria-labelledby="buttons">
        <h2 id="buttons">Botones</h2>
        <div className={styles.row}>
          <Button>Guardar</Button>
          <Button loading>{SAVING}</Button>
          <Button disabled>Guardar</Button>
          <Button variant="secondary">Cancelar</Button>
          <Button variant="danger">Rechazar pedido</Button>
          <Button
            loading={busy}
            onClick={() => {
              setBusy(true);
              setTimeout(() => setBusy(false), 1500);
            }}
          >
            {busy ? "Enviando pedido…" : "Probar envío"}
          </Button>
        </div>
        <p className={styles.note}>
          Spinner suelto: <Spinner /> · Login: «Entrando…» · Pedido: «Enviando
          pedido…» · Worker: «{SAVING}».
        </p>
      </section>

      <section aria-labelledby="notices">
        <h2 id="notices">Avisos</h2>
        <div className={styles.stack}>
          <Notice tone="success">Tu pedido quedó registrado.</Notice>
          <Notice tone="info">El límite es de 200 caracteres.</Notice>
          <Notice tone="error">{ORDER_STATE_CHANGED}</Notice>
          <Notice tone="error">{SESSION_EXPIRED}</Notice>
        </div>
      </section>

      <section aria-labelledby="connection">
        <h2 id="connection">Conexión y sincronización</h2>
        <div className={styles.stack}>
          <StaleListingBanner retrying={false} onRetry={noop} />
          <p className={styles.note}>
            Encabezado del worker: «{HEADER_OFFLINE}» en rojo sin conexión; «
            {syncStatusLabel(Date.parse("2026-11-20T17:43:00Z"), false)?.text}»
            con datos; nada antes de la primera lectura (el esqueleto lo
            indica).
          </p>
          <BoardError
            view={listingErrorView({ status: 401 })}
            retrying={false}
            onRetry={noop}
          />
          <BoardError
            view={listingErrorView({ status: null })}
            retrying={false}
            onRetry={noop}
          />
        </div>
      </section>

      <section aria-labelledby="skeletons">
        <h2 id="skeletons">Esqueletos y loader</h2>
        <BoardLoading />
        <div className={styles.loaderBox}>
          <UniFoodLoader inline label="Cargando" />
        </div>
      </section>

      <section aria-labelledby="empty">
        <h2 id="empty">Estados vacíos</h2>
        <div className={styles.grid}>
          <EmptyState
            icon={<Icon name="carrito" size={36} />}
            title="Tu carrito está vacío"
            action={<Button variant="secondary">Ver el menú</Button>}
          >
            Agrega productos del menú de tu cafetería.
          </EmptyState>
          <SearchEmpty query="arepa" onClear={noop} />
        </div>
      </section>

      <section aria-labelledby="confirm">
        <h2 id="confirm">Confirmación</h2>
        <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
          Abrir diálogo de confirmación
        </Button>
        {confirmOpen && (
          <ConfirmDialog
            title="¿Cambiar de cafetería?"
            confirmLabel="Vaciar y cambiar"
            onConfirm={() => setConfirmOpen(false)}
            onCancel={() => setConfirmOpen(false)}
          >
            Tu carrito tiene productos de otra cafetería.
          </ConfirmDialog>
        )}
      </section>

      <section aria-labelledby="icons">
        <h2 id="icons">Íconos</h2>
        <h3>Set del dueño</h3>
        <ul className={styles.icons}>
          {OWNER_ICON_NAMES.map((name) => (
            <li key={name}>
              <Icon name={name} />
              <Icon name={name} tone="active" />
              <span>{name}</span>
            </li>
          ))}
        </ul>
        <h3>Dibujados para UniFood</h3>
        <ul className={styles.icons}>
          {DRAWN_ICON_NAMES.map((name) => (
            <li key={name}>
              <Icon name={name} tone="inactive" />
              <span>{name}</span>
            </li>
          ))}
        </ul>
        <div className={styles.row}>
          <IconTile name="pedidos" />
          <IconTile name="dashboard" />
          <IconTile name="cafeterias" />
        </div>
      </section>

      <section aria-labelledby="codes">
        <h2 id="codes">
          Mensajes por ErrorCode ({BACKEND_ERROR_CODES.length})
        </h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Mensaje</th>
            </tr>
          </thead>
          <tbody>
            {BACKEND_ERROR_CODES.map((code) => (
              <tr key={code}>
                <td>
                  <code>{code}</code>
                </td>
                <td>{BACKEND_ERROR_MESSAGES[code]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
