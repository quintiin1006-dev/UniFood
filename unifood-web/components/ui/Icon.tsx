import type { CSSProperties, ReactNode } from "react";

import styles from "./icon.module.css";

/*
 * UniFood's own icon set (approved 7-nov-2026, proposal 2) and the glyphs drawn in the same style
 * for what the set does not cover. Rules: viewBox 24×24, stroke 1.8, round caps and joins, no fill,
 * stroke in currentColor. Colours come from tokens through `tone`, never from fixed hex values.
 */

/** The owner's approved glyphs. */
const OWNER = {
  inicio: (
    <>
      <path d="M4 11.4 12 4.6l8 6.8V19a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19z" />
      <path d="M9.6 20.6v-4.4a2.4 2.4 0 0 1 4.8 0v4.4" />
    </>
  ),
  // Kitchen bell, chosen by the owner.
  "mi-pedido": (
    <>
      <path d="M3.6 16.8a8.4 8.4 0 0 1 16.8 0z" />
      <path d="M12 8.4V6.8" />
      <circle cx="12" cy="5.8" r="1" />
      <path d="M2.6 20h18.8" />
    </>
  ),
  carrito: (
    <>
      <path d="M3.4 4.6h2.3l2 10.2h9.7l1.9-7.4H6.5" />
      <circle cx="9.4" cy="19.2" r="1.3" />
      <circle cx="16.6" cy="19.2" r="1.3" />
    </>
  ),
  historial: (
    <>
      <path d="M3.6 12a8.4 8.4 0 1 0 2.5-6L3.6 8.6" />
      <path d="M3.6 4.2v4.4h4.4" />
      <path d="M12 7.8V12l3 1.9" />
    </>
  ),
  perfil: (
    <>
      <circle cx="12" cy="8.2" r="3.7" />
      <path d="M4.8 20.4v-.9a5.2 5.2 0 0 1 5.2-5.2h4a5.2 5.2 0 0 1 5.2 5.2v.9" />
    </>
  ),
  pedidos: (
    <>
      <path d="M9 4.2h6a1 1 0 0 1 1 1V6.4H8V5.2a1 1 0 0 1 1-1z" />
      <path d="M8 6.4H6.6A1.6 1.6 0 0 0 5 8v11.4A1.6 1.6 0 0 0 6.6 21h10.8a1.6 1.6 0 0 0 1.6-1.6V8a1.6 1.6 0 0 0-1.6-1.6H16" />
      <path d="M9 11.6h6M9 15.6h4" />
    </>
  ),
  disponibilidad: (
    <>
      <path d="M7.6 7.4h8.8a4.6 4.6 0 0 1 0 9.2H7.6a4.6 4.6 0 0 1 0-9.2z" />
      <circle cx="16.2" cy="12" r="1.9" />
    </>
  ),
  dashboard: <path d="M5.2 20V11.4M12 20V4.6M18.8 20v-6.8" />,
  catalogo: (
    <>
      <rect x="4" y="4" width="6.8" height="6.8" rx="2" />
      <rect x="13.2" y="4" width="6.8" height="6.8" rx="2" />
      <rect x="4" y="13.2" width="6.8" height="6.8" rx="2" />
      <rect x="13.2" y="13.2" width="6.8" height="6.8" rx="2" />
    </>
  ),
  universidades: (
    <>
      <path d="M2.8 9.4 12 5l9.2 4.4L12 13.8z" />
      <path d="M6.4 11.8v4c0 1.3 2.6 2.7 5.6 2.7s5.6-1.4 5.6-2.7v-4" />
      <path d="M21.2 9.4v5" />
    </>
  ),
  cafeterias: (
    <>
      <path d="M4 9.6 5.3 4.6h13.4L20 9.6" />
      <path d="M4 9.6a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
      <path d="M5.2 11.6V19a1.5 1.5 0 0 0 1.5 1.5h10.6a1.5 1.5 0 0 0 1.5-1.5v-7.4" />
      <path d="M10 20.5v-4.6h4v4.6" />
    </>
  ),
  suscripciones: (
    <>
      <path d="M12 3.6 5 6.2v5.4c0 4.1 2.9 7.1 7 8.8 4.1-1.7 7-4.7 7-8.8V6.2z" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" />
    </>
  ),
  clientes: (
    <>
      <circle cx="9" cy="8.4" r="3.2" />
      <path d="M3.4 19.8v-.5a4.7 4.7 0 0 1 4.7-4.7h1.8a4.7 4.7 0 0 1 4.7 4.7v.5" />
      <path d="M15.4 5.4a3.1 3.1 0 0 1 0 6" />
      <path d="M17.6 14.8a4.7 4.7 0 0 1 3 4.4v.6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

/** Drawn for UniFood in the same style, for what the owner's set does not cover. */
const DRAWN = {
  // Megaphone: the worker calls the client to pick up.
  llamadas: (
    <>
      <path d="M3.8 10.2v3.6a1 1 0 0 0 1 1h2.4l9.4 4.6V4.6L7.2 9.2H4.8a1 1 0 0 0-1 1z" />
      <path d="m7.6 14.8 1.2 5.2h2.6l-1-4.2" />
      <path d="M19.6 9.4a3.6 3.6 0 0 1 0 5.2" />
    </>
  ),
  busqueda: (
    <>
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.4 15.4 4.8 4.8" />
    </>
  ),
  cerrar: <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />,
  check: <path d="m5 12.6 4.4 4.4L19 7.4" />,
  exito: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="m8.4 12.2 2.5 2.5 4.8-5" />
    </>
  ),
  reloj: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.6V12l2.9 1.8" />
    </>
  ),
  "flecha-derecha": <path d="M4.8 12h14.4M13.4 6.2 19.2 12l-5.8 5.8" />,
  "flecha-izquierda": <path d="M19.2 12H4.8M10.6 6.2 4.8 12l5.8 5.8" />,
  "chevron-derecha": <path d="m9.4 5.6 6.4 6.4-6.4 6.4" />,
  "chevron-izquierda": <path d="m14.6 5.6-6.4 6.4 6.4 6.4" />,
  "chevron-abajo": <path d="m5.6 9.4 6.4 6.4 6.4-6.4" />,
  advertencia: (
    <>
      <path d="M10.5 4.6a1.7 1.7 0 0 1 3 0l7 12.4a1.7 1.7 0 0 1-1.5 2.6H5a1.7 1.7 0 0 1-1.5-2.6z" />
      <path d="M12 9.6v3.8" />
      <path d="M12 16.6h.01" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.8v4.6" />
      <path d="M12 15.8h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  ayuda: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.5" />
      <path d="M12 16.8h.01" />
    </>
  ),
  "cerrar-sesion": (
    <>
      <path d="M9.6 20H6.2a1.6 1.6 0 0 1-1.6-1.6V5.6A1.6 1.6 0 0 1 6.2 4h3.4" />
      <path d="M15.4 16.2 19.6 12l-4.2-4.2" />
      <path d="M19.6 12H9.6" />
    </>
  ),
  mas: <path d="M12 5.2v13.6M5.2 12h13.6" />,
  menos: <path d="M5.2 12h13.6" />,
  recargar: (
    <>
      <path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2" />
      <path d="M19.4 4.6v4.2h-4.2" />
    </>
  ),
  correo: (
    <>
      <rect x="3.6" y="5.6" width="16.8" height="12.8" rx="2" />
      <path d="m4.4 7 7.6 5.6L19.6 7" />
    </>
  ),
  candado: (
    <>
      <rect x="5" y="10.4" width="14" height="10" rx="2" />
      <path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" />
      <path d="M12 14.4v2" />
    </>
  ),
  eliminar: (
    <>
      <path d="M4.8 7h14.4" />
      <path d="M9.4 7V5.2a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1V7" />
      <path d="m6.6 7 .8 11.6a1.6 1.6 0 0 0 1.6 1.4h6a1.6 1.6 0 0 0 1.6-1.4L17.4 7" />
    </>
  ),
  nota: (
    <>
      <path d="M5.6 4.6h12.8a1.6 1.6 0 0 1 1.6 1.6v8.8a1.6 1.6 0 0 1-1.6 1.6H10l-4.4 3.4v-3.4A1.6 1.6 0 0 1 4 15V6.2a1.6 1.6 0 0 1 1.6-1.6z" />
      <path d="M8.4 9h7.2M8.4 12.4h4.6" />
    </>
  ),
  ubicacion: (
    <>
      <path d="M12 20.6s6.4-5.6 6.4-10.6a6.4 6.4 0 0 0-12.8 0c0 5 6.4 10.6 6.4 10.6z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  efectivo: (
    <>
      <rect x="3" y="6.6" width="18" height="10.8" rx="2" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M6.4 9.8v.01M17.6 14.2v.01" />
    </>
  ),
  menu: <path d="M4.4 7h15.2M4.4 12h15.2M4.4 17h15.2" />,
  // Chef hat: «En preparación».
  cocina: (
    <>
      <path d="M7 17.6V13a3.6 3.6 0 1 1 2.2-6.4 3.6 3.6 0 0 1 5.6 0A3.6 3.6 0 1 1 17 13v4.6z" />
      <path d="M7 20.4h10" />
    </>
  ),
  // Notification bell: push notices on the phone (not the owner's kitchen bell, «mi-pedido»).
  avisos: (
    <>
      <path d="M6.2 16.6V11a5.8 5.8 0 0 1 11.6 0v5.6l1.6 1.8H4.6z" />
      <path d="M10 20.6a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  "avisos-apagados": (
    <>
      <path d="M6.2 16.6V11a5.8 5.8 0 0 1 11.6 0v5.6l1.6 1.8H4.6z" />
      <path d="M10 20.6a2.2 2.2 0 0 0 4 0" />
      <path d="M4.4 4.4 19.6 19.6" />
    </>
  ),
  // Down arrow into a tray: export a file (CSV of cash closures).
  descargar: (
    <>
      <path d="M12 4.4v10.4M7.6 10.6 12 15l4.4-4.4" />
      <path d="M4.8 15.8v2.6a1.6 1.6 0 0 0 1.6 1.6h11.2a1.6 1.6 0 0 0 1.6-1.6v-2.6" />
    </>
  ),
  // Printer: print or save as PDF (cash receipt).
  imprimir: (
    <>
      <path d="M7.4 9V4.6h9.2V9" />
      <rect x="4" y="9" width="16" height="7.4" rx="1.6" />
      <path d="M7.4 14.2h9.2v5.2H7.4z" />
    </>
  ),
  // Take-away bag: «Listos para entregar».
  bolsa: (
    <>
      <path d="M5.4 8.2h13.2l-1 11a1.6 1.6 0 0 1-1.6 1.4H8a1.6 1.6 0 0 1-1.6-1.4z" />
      <path d="M9 10.6V7a3 3 0 0 1 6 0v3.6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

const GLYPHS = {
  ...OWNER,
  ...DRAWN,
  // «Tienda» is the owner's storefront: one glyph, so the store never looks two ways.
  tienda: OWNER.cafeterias,
};

export type IconName = keyof typeof GLYPHS;
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];
export const OWNER_ICON_NAMES = Object.keys(OWNER) as IconName[];
export const DRAWN_ICON_NAMES = Object.keys(DRAWN) as IconName[];

/**
 * 20 real pixels in any context. The worker board is drawn at 0.7 (`transform: scale(.7)` in
 * globals.css), so an attribute of 20 would show as 14 px there; the variable is absent elsewhere
 * and the fallback 1 keeps 20 px.
 */
export const ICON_MIN_20: CSSProperties = {
  width: "calc(20px / var(--worker-zoom, 1))",
  height: "calc(20px / var(--worker-zoom, 1))",
};

/** 16 real pixels, for the simple icons (cerrar, check, más, menos, flechas, chevrones, info). */
export const ICON_MIN_16: CSSProperties = {
  width: "calc(16px / var(--worker-zoom, 1))",
  height: "calc(16px / var(--worker-zoom, 1))",
};

/**
 * One icon of the set. Decorative by default (aria-hidden); with `label` it is announced, for a
 * button whose only content is the icon. `tone`: inherit the text colour, the soft inactive
 * colour, or active (brand stroke with a 14 % brand fill).
 */
export function Icon({
  name,
  size = 24,
  label,
  tone = "inherit",
  strokeWidth = 1.8,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  label?: string;
  tone?: "inherit" | "inactive" | "active";
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={`${styles.icon} ${tone === "inherit" ? "" : styles[tone]} ${className ?? ""}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      style={style}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      {GLYPHS[name]}
    </svg>
  );
}

/** Module tile: 48 px square, radius 14, celeste → brand → navy gradient, white glyph at 1.9. */
export function IconTile({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <span className={`${styles.tile} ${className ?? ""}`} aria-hidden="true">
      <Icon name={name} size={26} strokeWidth={1.9} />
    </span>
  );
}
