import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paperworld — Delivery operations",
  description: "A paper-to-network workspace for delivery operations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
