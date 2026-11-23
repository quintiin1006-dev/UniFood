import Link from "next/link";
import {
  Ban,
  BellRing,
  ChefHat,
  CircleCheck,
  CircleX,
  Megaphone,
  PackageCheck,
  PackageX,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { NOTICES_MESSAGES } from "@/features/shared/messages";
import {
  exactTime,
  noticeDetail,
  noticeTitle,
  relativeTime,
} from "../presentation";
import type { Notice, NoticeKind } from "../types";
import type { NoticesView } from "../useNotices";
import styles from "./InboxBell.module.css";

const ICONS: Record<NoticeKind, LucideIcon> = {
  PREPARING: ChefHat,
  READY: PackageCheck,
  CALLED: Megaphone,
  REMINDER: BellRing,
  DELIVERED: CircleCheck,
  NOT_COLLECTED: PackageX,
  REJECTED: Ban,
  CANCELLED_BY_CLIENT: CircleX,
};

export const MI_PEDIDO_PATH = "/cuenta/pedido";

function Body({
  notice,
  now,
  fresh,
}: {
  notice: Notice;
  now: number;
  fresh: boolean;
}) {
  const Glyph = ICONS[notice.kind];
  return (
    <>
      <span className={styles.icon} data-kind={notice.kind}>
        <Glyph
          size={20}
          strokeWidth={1.8}
          aria-hidden="true"
          focusable="false"
        />
      </span>
      <span className={styles.text}>
        <span className={styles.noticeTitle}>
          {noticeTitle(notice)}
          {fresh && (
            <span className={styles.fresh}>{NOTICES_MESSAGES.newLabel}</span>
          )}
        </span>
        <span className={styles.detail}>{noticeDetail(notice)}</span>
        <time className={styles.time} dateTime={notice.createdAt}>
          {relativeTime(notice.createdAt, now)} · {exactTime(notice.createdAt)}
        </time>
      </span>
    </>
  );
}

/**
 * The list under the switch: loading, error with retry, empty, or the notices newest first. A
 * notice of an order that is still active links to Mi pedido; the others are plain rows.
 */
export default function NoticesList({
  view,
  now,
  fresh,
  titleId,
  onNavigate,
}: {
  view: Pick<NoticesView, "status" | "notices" | "message" | "retry">;
  now: number;
  /** Ids that were unread when the panel opened. */
  fresh: ReadonlySet<string>;
  titleId: string;
  onNavigate: () => void;
}) {
  return (
    <section className={styles.recent} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.listTitle}>
        {NOTICES_MESSAGES.listTitle}
      </h3>
      {view.status === "loading" && view.notices.length === 0 ? (
        <p className={styles.state} role="status">
          {NOTICES_MESSAGES.loading}
        </p>
      ) : view.status === "error" && view.notices.length === 0 ? (
        <div className={styles.state} role="alert">
          <p className={styles.stateText}>
            {view.message ?? NOTICES_MESSAGES.failed}
          </p>
          <button type="button" className={styles.retry} onClick={view.retry}>
            <RotateCw size={20} aria-hidden="true" focusable="false" />
            {NOTICES_MESSAGES.retry}
          </button>
        </div>
      ) : view.notices.length === 0 ? (
        <p className={styles.state}>{NOTICES_MESSAGES.empty}</p>
      ) : (
        <ul className={styles.list}>
          {view.notices.map((notice) => (
            <li key={notice.id} className={styles.item}>
              {notice.orderActive ? (
                <Link
                  href={MI_PEDIDO_PATH}
                  className={styles.row}
                  data-link="true"
                  onClick={onNavigate}
                >
                  <Body
                    notice={notice}
                    now={now}
                    fresh={fresh.has(notice.id)}
                  />
                  <span className={styles.srOnly}>
                    {NOTICES_MESSAGES.goToOrder}
                  </span>
                </Link>
              ) : (
                <div className={styles.row}>
                  <Body
                    notice={notice}
                    now={now}
                    fresh={fresh.has(notice.id)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
