import type { Metadata } from "next";
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
