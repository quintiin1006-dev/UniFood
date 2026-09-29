import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}