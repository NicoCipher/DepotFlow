import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "DepotFlow",
  description: "Simple sales and stock for your drinks shop.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "(function(){try{var value=localStorage.getItem(\"depotflow-appearance\");var choice=value===\"light\"||value===\"dark\"?value:\"system\";var dark=choice===\"dark\"||(choice===\"system\"&&window.matchMedia(\"(prefers-color-scheme: dark)\").matches);document.documentElement.setAttribute(\"data-theme\",dark?\"dark\":\"light\");}catch(e){document.documentElement.setAttribute(\"data-theme\",window.matchMedia(\"(prefers-color-scheme: dark)\").matches?\"dark\":\"light\");}})();" }} />
      </head>
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
