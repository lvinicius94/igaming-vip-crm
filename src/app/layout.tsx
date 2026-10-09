import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIP Players Dashboard",
  description: "Dashboard para análise de jogadores VIP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
