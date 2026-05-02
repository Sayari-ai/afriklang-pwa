import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { AppHydration } from "@/components/app-hydration";
import { satoshi } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Afriklang",
  title: {
    default: "Afriklang",
    template: "%s · Afriklang",
  },
  description:
    "Learn African languages through bite-sized, gamified speaking lessons.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Afriklang",
  },
  // Manifest is served from `src/app/manifest.ts`.
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#00539F",
  width: "device-width",
  initialScale: 1,
  // PWAs need to extend under the iOS safe-area for the kiosk-style look
  // we use across all screens (matches Flutter's edge-to-edge mode).
  viewportFit: "cover",
};

/**
 * Root layout.
 *
 * The PWA mirrors the Flutter app's runtime locale model: a single user
 * preference (System / EN / FR) flips between message bundles without
 * any URL change. We therefore use next-intl in its "without i18n
 * routing" mode — the locale is resolved by the request config in
 * `src/i18n/request.ts` (reads the cookie set by the in-app picker)
 * and re-injected here through the client provider.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${satoshi.variable} h-full`}>
      {/*
        suppressHydrationWarning: some browser extensions (ColorZilla,
        Grammarly, LastPass, dark-mode helpers) inject attributes on
        <body> before React hydrates, producing a mismatch warning that
        is harmless to the app. Limited to <body> on purpose: real
        mismatches inside our own components still surface normally.
      */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppHydration />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
