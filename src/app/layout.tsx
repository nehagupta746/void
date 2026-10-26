import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { ServiceWorkerRegistration } from "@/components/layout/ServiceWorkerRegistration";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { PerformanceInstrumentation } from "@/components/diagnostics/PerformanceInstrumentation";
import Script from "next/script";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "VOID // Mission Terminal",
  description: "Near-Earth Object monitoring platform.",
  applicationName: "VOID",
  manifest: "/manifest.json",
  icons: { icon: "/favicon.svg", apple: "/icons/icon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "VOID" },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = { themeColor: "#05060A", colorScheme: "dark light", viewportFit: "cover" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" data-theme="dark" suppressHydrationWarning className={cn("dark", spaceGrotesk.variable, ibmPlexMono.variable)}><body className="scanlines grain"><Script id="theme-bootstrap" strategy="beforeInteractive">{`try { if (localStorage.getItem("void-theme") === "light") { document.documentElement.dataset.theme = "light"; document.documentElement.classList.remove("dark"); } } catch {}`}</Script><PerformanceInstrumentation /><ServiceWorkerRegistration /><ThemeProvider><QueryProvider><AppShell>{children}</AppShell></QueryProvider></ThemeProvider></body></html>; }
