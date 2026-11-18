import { MessageSquareText } from "lucide-react";

import styles from "./OrderNote.module.css";
import { ICON_MIN_20 } from "@/components/ui/Icon";

/**
 * The client's note as plain text: React escapes it, so markup is shown, never interpreted.
 * Line breaks are kept and long words wrap, so nothing is cut.
 */
export function OrderNote({ note }: { note?: string | null }) {
  if (typeof note !== "string" || !note.trim()) return null;
  return (
    <div className={styles.note}>
      <MessageSquareText
        size={20}
        style={ICON_MIN_20}
        strokeWidth={2.3}
        aria-hidden="true"
      />
      <div>
        <strong>Observaciones</strong>
        <p>{note}</p>
      </div>
    </div>
  );
}
