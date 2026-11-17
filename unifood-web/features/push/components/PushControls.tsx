"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { PUSH_MESSAGES } from "@/features/shared/messages";
import type { PushRole } from "../state";
import { usePush, type PushView } from "../usePush";
import styles from "./PushControls.module.css";

/**
 * Explains why push is not offered here. Without support the in-app notice stays the only
 * channel, and no switch is shown.
 */
export function PushUnavailable({
  availability,
}: {
  availability: PushView["availability"];
}) {
  switch (availability) {
    case "denied":
      return (
        <Notice tone="info" title={PUSH_MESSAGES.deniedTitle}>
          {PUSH_MESSAGES.deniedBody}
        </Notice>
      );
    case "ios-install":
      return (
        <Notice tone="info" title={PUSH_MESSAGES.iosInstallTitle}>
          {PUSH_MESSAGES.iosInstallSteps}
        </Notice>
      );
    case "ios-too-old":
      return <p className={styles.hint}>{PUSH_MESSAGES.iosTooOld}</p>;
    case "unsupported":
      return <p className={styles.hint}>{PUSH_MESSAGES.unsupported}</p>;
    case "disabled-on-server":
      return <p className={styles.hint}>{PUSH_MESSAGES.disabledOnServer}</p>;
    default:
      return null;
  }
}

function Feedback({ view }: { view: PushView }) {
  if (!view.message) return null;
  const tone =
    view.message === "enabled" || view.message === "disabled"
      ? "success"
      : "error";
  return <Notice tone={tone}>{PUSH_MESSAGES[view.message]}</Notice>;
}

/** Switch for Perfil (client) and the worker's panel: one tap turns push on or off. */
export function PushToggleView({
  role,
  view,
}: {
  role: PushRole;
  view: PushView;
}) {
  if (view.availability === null) return null;
  const hint =
    role === "worker"
      ? PUSH_MESSAGES.toggleHintWorker
      : PUSH_MESSAGES.toggleHintClient;
  return (
    <section className={styles.toggle} aria-labelledby={`push-${role}-title`}>
      <div className={styles.row}>
        {view.subscribed ? (
          <Icon name="avisos" size={24} />
        ) : (
          <Icon name="avisos-apagados" size={24} tone="inactive" />
        )}
        <div className={styles.text}>
          <h2 id={`push-${role}-title`}>{PUSH_MESSAGES.toggleLabel}</h2>
          <p>{hint}</p>
        </div>
        {view.availability === "available" && (
          <button
            type="button"
            role="switch"
            aria-checked={view.subscribed}
            aria-labelledby={`push-${role}-title`}
            className={styles.switch}
            disabled={view.busy}
            onClick={() =>
              void (view.subscribed ? view.disable() : view.enable())
            }
          >
            <span className={styles.thumb} />
          </button>
        )}
      </div>
      <PushUnavailable availability={view.availability} />
      <Feedback view={view} />
    </section>
  );
}

export function PushToggle({ role }: { role: PushRole }) {
  const view = usePush(role);
  return <PushToggleView role={role} view={view} />;
}

/**
 * «Activar avisos de tu pedido», shown after the client's order is placed. Hidden once push is
 * on, after «Ahora no», and wherever push cannot work, except for the iPhone install guide.
 */
export function PushPromptCardView({ view }: { view: PushView }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || view.availability === null) return null;
  if (view.subscribed)
    return view.message === "enabled" ? <Feedback view={view} /> : null;
  if (view.availability === "ios-install")
    return <PushUnavailable availability="ios-install" />;
  if (view.availability !== "available" && view.availability !== "denied")
    return null;
  return (
    <section className={styles.card} aria-labelledby="push-card-title">
      <Icon name="avisos" size={28} className={styles.cardIcon} />
      <h2 id="push-card-title">{PUSH_MESSAGES.cardTitle}</h2>
      <p>{PUSH_MESSAGES.cardBody}</p>
      {view.availability === "denied" ? (
        <PushUnavailable availability="denied" />
      ) : (
        <div className={styles.actions}>
          <Button disabled={view.busy} onClick={() => void view.enable()}>
            {view.busy ? PUSH_MESSAGES.enabling : PUSH_MESSAGES.enable}
          </Button>
          <Button variant="secondary" onClick={() => setDismissed(true)}>
            {PUSH_MESSAGES.later}
          </Button>
        </div>
      )}
      <Feedback view={view} />
    </section>
  );
}

export function PushPromptCard() {
  const view = usePush("client");
  return <PushPromptCardView view={view} />;
}
