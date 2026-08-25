import type { Metadata } from "next";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="dark">
      <body style={fontVariables} className="antialiased">
        {children}
      </body>
    </html>
  );
}
