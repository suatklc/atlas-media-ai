import fs from "node:fs";
import path from "node:path";
import { Resvg, initWasm } from "@resvg/resvg-wasm";

// Replaces sharp (native binary, unreliable to package for Vercel's
// linux-x64 serverless runtime across multiple attempted fixes — Node
// engine pin, stable webpack build, outputFileTracingIncludes, explicit
// linux-x64 optionalDependencies) with a pure-WASM SVG rasterizer. The
// .wasm binary itself is a single, universal, cross-platform file — not a
// per-OS/arch native addon — so it carries none of sharp's packaging
// fragility.
//
// Unlike sharp (backed by librsvg, which had SOME system font to fall back
// to on whatever Linux box it ran on), resvg-wasm has NO OS font access at
// all — text renders only from fonts explicitly loaded into it via
// fontBuffers. Two fonts are bundled and loaded here:
//   - ./fonts/Inter.ttf — body/UI text (sansSerifFamily maps the existing
//     "sans-serif" generic fallback in FONT_STACK to it, so none of the
//     existing SVG markup's font-family strings need to change).
//   - ./fonts/PlayfairDisplay-Bold.ttf — the brand wordmark's "elegant
//     high-contrast serif" requirement (see templates/brand.ts); referenced
//     directly by its own family name in that module's SVG markup only.
// Both SIL Open Font License 1.1 — see fonts/OFL.txt and
// fonts/PlayfairDisplay-OFL.txt.

// Deliberately plain path.join string construction, never require()/
// require.resolve()/import() for either file below: any of those is a
// module specifier a bundler's static analysis recognizes and tries to
// resolve/inline at build time — which is exactly what broke the build
// for the .wasm binary (webpack refused to bundle it as a module without
// enabling WebAssembly experiments, which isn't wanted here anyway). A
// plain string passed to fs.readFile is invisible to every bundler's
// module graph, so both files ship untouched as raw assets via
// outputFileTracingIncludes (next.config.ts) and are read here exactly as
// written to disk.

function findExistingPath(candidates: string[], label: string): string {
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`${label} not found at any known path.`);
  }
  return found;
}

// process.cwd() is the documented, standard way a Vercel Node.js
// serverless function locates files traced into its own bundle — the
// wasm file lives deep inside node_modules with no meaningful relation to
// this module's own location, so no __dirname-relative fallback applies.
function resolveWasmPath(): string {
  return findExistingPath(
    [path.join(process.cwd(), "node_modules", "@resvg", "resvg-wasm", "index_bg.wasm")],
    "resvg-wasm binary",
  );
}

// __dirname is kept as a second candidate for local `next start`/dev,
// where the compiled module's own directory reliably sits next to its
// bundled fonts/ folder (this module and fonts/ are colocated in source
// under src/lib/ai/image/).
function resolveFontPath(filename: string, label: string): string {
  return findExistingPath(
    [
      path.join(process.cwd(), "src", "lib", "ai", "image", "fonts", filename),
      path.join(__dirname, "fonts", filename),
    ],
    label,
  );
}

// Both the WASM module init and the font reads are expensive, one-time,
// process-lifetime operations — memoized as a single in-flight promise
// (not just a boolean flag) so concurrent renders during a cold start
// await the same initialization instead of racing to init twice.
let readyPromise: Promise<Uint8Array[]> | null = null;

function ensureResvgReady(): Promise<Uint8Array[]> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const wasmBytes = await fs.promises.readFile(resolveWasmPath());
      await initWasm(wasmBytes);
      return Promise.all([
        fs.promises.readFile(resolveFontPath("Inter.ttf", "Bundled Inter font")),
        fs.promises.readFile(resolveFontPath("PlayfairDisplay-Bold.ttf", "Bundled Playfair Display font")),
      ]);
    })();
  }
  return readyPromise;
}

// sharp's sharp(buffer) auto-detected the source format from the buffer's
// own bytes, never from a separately-tracked content-type string (Package
// 5A/5B never threaded one through to this layer). A data: URI requires an
// explicit MIME type, so this replicates that same "detect from the
// buffer itself" behavior via magic-byte sniffing rather than assuming
// PNG — every media provider (openai.ts, fal.ts) produces PNG or JPEG
// bytes today.
function detectImageMimeType(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return "image/png";
}

// SVG equivalent of sharp's `.resize(width, height, { fit: "cover" })`:
// preserveAspectRatio="xMidYMid slice" scales the image (preserving its
// own intrinsic aspect ratio, read by the renderer from the embedded PNG/
// JPEG data itself — never computed here) to fully cover the given
// width/height, center-cropping the overflow. This is a standard,
// spec-defined SVG <image> behavior, not a custom cropping algorithm.
//
// One known, unavoidable behavior difference from before: sharp's
// `position: sharp.strategy.attention` cropped toward the most visually
// salient region of the photo (saliency/edge detection). No such
// analysis is available here without reintroducing a native/ML
// dependency — this uses a plain center crop, the standard fallback used
// by SVG-based compositors generally.
export function buildCoverImageMarkup(baseImage: Buffer, width: number, height: number): string {
  const mimeType = detectImageMimeType(baseImage);
  const base64 = baseImage.toString("base64");
  return `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" href="data:${mimeType};base64,${base64}" />`;
}

// Renders a complete SVG string (base image + overlay markup, already
// merged by the caller — see hero.ts/educational.ts) to PNG bytes at
// exactly the SVG's own declared width/height. fitTo: "original" is
// explicit rather than relying on an implicit default, since the SVG
// string itself already declares the exact target pixel size — no
// additional scaling should ever be applied here.
export async function renderSvgToPng(svg: string, width: number, height: number): Promise<Buffer> {
  const fontBuffers = await ensureResvgReady();

  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      fontBuffers,
      loadSystemFonts: false,
      defaultFontFamily: "Inter",
      sansSerifFamily: "Inter",
    },
  });

  if (resvg.width !== width || resvg.height !== height) {
    throw new Error(
      `resvg rendered at ${resvg.width}x${resvg.height}, expected ${width}x${height} — the SVG's declared size did not match the target canvas.`,
    );
  }

  const rendered = resvg.render();
  return Buffer.from(rendered.asPng());
}
