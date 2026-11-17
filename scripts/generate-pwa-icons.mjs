// Generates the PWA / home-screen icons into public/icons/ from the existing
// Atlas app mark (the indigo "A" tile used in the sidebar, top bar and login
// screen — indigo-500 #6366f1, white bold "A"). Not a new brand: a raster of
// the mark the app already shows. Uses the already-installed
// @resvg/resvg-wasm and the bundled Inter font — no new dependency.
//
// The bundled Inter.ttf is the regular weight only; a thin white stroke
// approximates the bold "A" the app renders.
//
// Run once (output is committed): node scripts/generate-pwa-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg, initWasm } from "@resvg/resvg-wasm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

await initWasm(readFileSync(path.join(root, "node_modules/@resvg/resvg-wasm/index_bg.wasm")));
const font = readFileSync(path.join(root, "src/lib/ai/image/fonts/Inter.ttf"));

const INDIGO = "#6366f1";

// rounded: corner radius as a fraction of the size (0 = full bleed square).
// letter: "A" height as a fraction of the size (maskable icons keep it
// inside the 80% safe zone).
function svg(size, { rounded, letter }) {
  const r = Math.round(size * rounded);
  const fontSize = Math.round(size * letter);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${INDIGO}"/>
  <text x="50%" y="50%" dy="0.36em" text-anchor="middle" font-family="Inter" font-weight="700" font-size="${fontSize}" fill="#ffffff" stroke="#ffffff" stroke-width="${(fontSize * 0.045).toFixed(1)}" stroke-linejoin="round">A</text>
</svg>`;
}

const icons = [
  // Manifest "any" icons — same rounded tile as the in-app mark.
  { file: "icon-192.png", size: 192, rounded: 0.22, letter: 0.56 },
  { file: "icon-512.png", size: 512, rounded: 0.22, letter: 0.56 },
  // Android adaptive ("maskable"): full bleed, letter inside the safe zone.
  { file: "maskable-512.png", size: 512, rounded: 0, letter: 0.42 },
  // iOS home screen: full square, iOS applies its own rounding.
  { file: "apple-touch-icon.png", size: 180, rounded: 0, letter: 0.52 },
];

for (const icon of icons) {
  const png = new Resvg(svg(icon.size, icon), {
    font: { fontBuffers: [font], loadSystemFonts: false, defaultFontFamily: "Inter" },
  })
    .render()
    .asPng();
  writeFileSync(path.join(outDir, icon.file), png);
  console.log(`public/icons/${icon.file} ${icon.size}x${icon.size} ${png.length} bytes`);
}
