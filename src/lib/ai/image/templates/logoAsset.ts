import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// Gold Standard V1 — the REAL approved Suat Kılıç logo asset, supplied by
// the user at public/brand/suat-kilic-logo.png. This module never
// redraws/recreates/stylizes it — it only (a) reads the exact file bytes
// and (b) makes its solid-black background transparent so it composites
// cleanly onto dark carousel scrims instead of appearing as a visible
// black rectangle, since the source PNG has no alpha channel (colorType
// 2 = RGB, confirmed by inspecting the file directly). The source file on
// disk is never modified — this only builds a derived, in-memory RGBA
// buffer once per process, exactly the same "expensive one-time
// resource, memoized" pattern resvg-renderer.ts already uses for the wasm
// binary and fonts.
//
// No new dependency: PNG decode/encode is hand-written using Node's own
// zlib (inflate/deflate) — this asset is decoded/re-encoded exactly once
// per server process, so a bespoke minimal implementation is proportionate
// (a full PNG library would be overkill for "one file, read once, cached
// forever").

const LOGO_RELATIVE_PATH = "public/brand/suat-kilic-logo.png";

// Live-verified (pixel-scanned, not eyeballed) tight bounding box of the
// actual visible icon+wordmark content within the source file's 2000x2000
// canvas — the rest is black padding. Used only to compute how a caller's
// requested display box maps onto the source image; the source image
// itself is never cropped/re-saved, and every pixel within this box
// (icon, "SUAT KILIÇ", "GAYRİMENKUL DANIŞMANI", phone number) is preserved
// and shown — nothing here removes or crops actual logo content.
const CONTENT_BBOX = { x: 398, y: 477, width: 1204, height: 907 };

function resolveLogoPath(): string {
  const candidates = [
    path.join(process.cwd(), LOGO_RELATIVE_PATH),
    // __dirname-relative fallback for local `next start`, mirroring
    // resvg-renderer.ts's own resolveFontPath reasoning — not expected to
    // ever be needed for a public/ asset, but costs nothing to have.
    path.join(__dirname, "..", "..", "..", "..", "..", LOGO_RELATIVE_PATH),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Approved logo asset not found at ${LOGO_RELATIVE_PATH}.`);
  }
  return found;
}

type DecodedPng = { width: number; height: number; rgb: Buffer };

function decodePngRgb(fileBytes: Buffer): DecodedPng {
  if (fileBytes.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("Logo asset is not a valid PNG file.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idatChunks: Buffer[] = [];

  while (offset < fileBytes.length) {
    const length = fileBytes.readUInt32BE(offset);
    const type = fileBytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = fileBytes.readUInt32BE(dataStart);
      height = fileBytes.readUInt32BE(dataStart + 4);
      const bitDepth = fileBytes.readUInt8(dataStart + 8);
      colorType = fileBytes.readUInt8(dataStart + 9);
      if (bitDepth !== 8) {
        throw new Error(`Unsupported logo PNG bit depth: ${bitDepth} (expected 8).`);
      }
    } else if (type === "IDAT") {
      idatChunks.push(fileBytes.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }

  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`Unsupported logo PNG color type: ${colorType} (expected RGB or RGBA).`);
  }

  const srcChannels = colorType === 6 ? 4 : 3;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * srcChannels;
  const rgb = Buffer.alloc(width * height * 3);
  let rawOffset = 0;
  let prevRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filterType = inflated[rawOffset];
    rawOffset += 1;
    const row = inflated.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const outRow = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= srcChannels ? outRow[x - srcChannels] : 0;
      const b = prevRow[x];
      const c = x >= srcChannels ? prevRow[x - srcChannels] : 0;
      let value = row[x];
      if (filterType === 1) value = (value + a) & 0xff;
      else if (filterType === 2) value = (value + b) & 0xff;
      else if (filterType === 3) value = (value + Math.floor((a + b) / 2)) & 0xff;
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        value = (value + pred) & 0xff;
      }
      outRow[x] = value;
    }
    for (let x = 0; x < width; x++) {
      const srcI = x * srcChannels;
      const dstI = (y * width + x) * 3;
      rgb[dstI] = outRow[srcI];
      rgb[dstI + 1] = outRow[srcI + 1];
      rgb[dstI + 2] = outRow[srcI + 2];
    }
    prevRow = outRow;
  }

  return { width, height, rgb };
}

// Luminance-keyed alpha matte: the source is white line-art/text on a
// solid near-black background with no alpha channel. Pixels at or below
// ALPHA_TRANSPARENT_LUMA become fully transparent (the background);
// pixels at or above ALPHA_OPAQUE_LUMA stay fully opaque (the logo
// itself); the narrow band between the two is a linear ramp, preserving
// the source's own anti-aliased edges instead of a hard, jagged cutout.
const ALPHA_TRANSPARENT_LUMA = 12;
const ALPHA_OPAQUE_LUMA = 60;

function matteToRgba(decoded: DecodedPng): Buffer {
  const { width, height, rgb } = decoded;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const luma = Math.max(r, g, b);
    let alpha: number;
    if (luma <= ALPHA_TRANSPARENT_LUMA) {
      alpha = 0;
    } else if (luma >= ALPHA_OPAQUE_LUMA) {
      alpha = 255;
    } else {
      alpha = Math.round(
        ((luma - ALPHA_TRANSPARENT_LUMA) / (ALPHA_OPAQUE_LUMA - ALPHA_TRANSPARENT_LUMA)) * 255,
      );
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = alpha;
  }
  return rgba;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width: number, height: number, rgba: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // color type: RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  const ihdr = pngChunk("IHDR", ihdrData);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = pngChunk("IDAT", zlib.deflateSync(raw));
  const iend = pngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

export type MattedLogoAsset = {
  base64Png: string;
  naturalWidth: number;
  naturalHeight: number;
  contentBBox: typeof CONTENT_BBOX;
};

let cachedLogoPromise: Promise<MattedLogoAsset> | null = null;

// Memoized: the source file is read, decoded, and re-matted with
// transparency exactly once per server process — every subsequent
// carousel render (regardless of how many slides/requests) reuses the
// same cached buffer, the same "expensive one-time resource" discipline
// resvg-renderer.ts already applies to the wasm binary and fonts.
export function loadMattedLogoAsset(): Promise<MattedLogoAsset> {
  if (!cachedLogoPromise) {
    cachedLogoPromise = (async () => {
      const fileBytes = await fs.promises.readFile(resolveLogoPath());
      const decoded = decodePngRgb(fileBytes);
      const rgba = matteToRgba(decoded);
      const pngBuffer = encodeRgbaPng(decoded.width, decoded.height, rgba);
      return {
        base64Png: pngBuffer.toString("base64"),
        naturalWidth: decoded.width,
        naturalHeight: decoded.height,
        contentBBox: CONTENT_BBOX,
      };
    })();
  }
  return cachedLogoPromise;
}
