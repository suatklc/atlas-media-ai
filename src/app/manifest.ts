import type { MetadataRoute } from "next";

// Web App Manifest (served at /manifest.webmanifest). Every URL is relative
// to the origin the app is served from, so the same build works on the
// current Vercel address and on a future own domain without changes.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Atlas AI",
    short_name: "Atlas",
    description: "Gayrimenkul içerik planlama, taslak onayı ve yayın paneli.",
    lang: "tr",
    dir: "ltr",
    // Unauthenticated launches are redirected to /login by the middleware.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
