import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./tokens.css";
import "./globals.css";

// Self-hosted by next/font at build time: no request to Google at runtime.
const figtree = Figtree({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "UniFood",
  description: "Tu comida, sin filas.",
  // Installed on iPhone, the app runs standalone: the only way iOS 16.4+ delivers Web Push.
  appleWebApp: { capable: true, title: "UniFood", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0B5FFF",
  // Installed as a PWA the page reaches the screen edges; headers and navs pad with
  // env(safe-area-inset-*) so nothing sits under the clock or the home indicator.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={figtree.variable}>
      <body>{children}</body>
    </html>
  );
}
