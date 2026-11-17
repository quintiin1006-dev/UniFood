import type { MetadataRoute } from "next";

/** Served as /manifest.webmanifest: lets the app be installed, which iOS requires for push. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "UniFood",
    short_name: "UniFood",
    description: "Tu comida, sin filas.",
    lang: "es-CO",
    // The home page sends each role to its own area (/cuenta or /worker) after signing in.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0B5FFF",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
