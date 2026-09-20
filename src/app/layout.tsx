import type { Metadata, Viewport } from "next";
import { Martian_Mono, Schibsted_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

// next/font self-hosts these at build time, so the app still renders correctly
// offline in a shop with no signal.
const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-schibsted",
  display: "swap",
});

const martian = Martian_Mono({
  subsets: ["latin"],
  variable: "--font-martian",
  display: "swap",
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Ostoslista",
  description: "Yhteinen ostoslista, jota voi muokata kaikki samaan aikaan.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Ostoslista", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#e8501f",
  // The list is a single scrolling column; zooming it only gets in the way,
  // but we keep user-scalable on for accessibility.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fi" className={`${schibsted.variable} ${martian.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
