import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { fetchProfile } from "../lib/fetch-profile";
import { DEFAULT_LOCALE, type Locale } from "../i18n";

export async function generateMetadata(): Promise<Metadata> {
  const profile = await fetchProfile();
  const { recipient } = profile;

  const title = `${recipient.name}'s CareGuard`;
  const description = "AI agent that autonomously manages elderly healthcare spending on Stellar";
  const ogImage = recipient.avatar || "/icon-512.png";

  return {
    title,
    description,
    manifest: "/manifest.json",
    robots: {
      index: false,
      follow: false,
    },
    icons: {
      icon: "/icon-192.png",
      apple: "/icon-192.png",
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "CareGuard",
    },
    openGraph: {
      title,
      description,
      images: [
        {
          url: ogImage,
          width: 512,
          height: 512,
          alt: `${recipient.name}'s Avatar`,
        },
      ],
    },
  };
}

// `viewport` and `themeColor` are exported separately from `metadata` per the
// Next.js App Router metadata API (themeColor inside metadata is deprecated).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0ea5e9",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // #1127 — Derive html lang attribute from active locale.
  // Intentionally static 'en' until dynamic locale-switcher functionality is implemented.
  const locale: Locale = DEFAULT_LOCALE;

  return (
    <html
      lang={locale}
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
