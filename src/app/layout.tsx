import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/pwa/PwaRegister";
import "./globals.css";

// next/font/google requires fetching the font file from fonts.gstatic.com at
// dev/build time; in environments without that network access, Turbopack
// fails to compile any route through this layout. System-font fallbacks
// keep the same CSS variable names globals.css already expects, with no
// network dependency.
const fontVariables = {
  "--font-geist-sans":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "--font-geist-mono":
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
} as React.CSSProperties;

export const metadata: Metadata = {
  title: "Atlas AI",
  description: "Atlas AI dashboard",
  applicationName: "Atlas AI",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="dark">
      {/* Install metadata is written here, not through `metadata`: Next 15
          streams `metadata` into <body> for browsers, where Chrome does not
          detect the manifest (installability check reported "no-manifest")
          and iOS does not read the home-screen tags. Paths are relative, so
          any domain works. */}
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" sizes="180x180" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Atlas" />
        {/* Opaque status bar: content never sits under the notch, so the
            layout needs no safe-area padding. */}
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
      </head>
      <body style={fontVariables} className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
