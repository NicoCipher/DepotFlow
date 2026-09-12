import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "DepotFlow",
  description: "Simple sales and stock for your drinks shop.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
