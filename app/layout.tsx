import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paperworld — Draw, scan, and watch it move",
  description: "Turn a paper map into a living delivery world. Scan a sketch, confirm the map, then watch demo couriers find their routes.",
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
