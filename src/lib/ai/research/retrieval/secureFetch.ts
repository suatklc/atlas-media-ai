import https from "node:https";
import tls from "node:tls";

// Fixes the specific, live-reproduced blocker that kept providers/
// resmiGazete.ts unregistered: Node's global fetch() rejects
// www.resmigazete.gov.tr with UNABLE_TO_VERIFY_LEAF_SIGNATURE, while curl
// (and this OS) trusts it fine — because curl validates against the OS's
// own certificate store and Node's fetch validates only against Node's own
// bundled Mozilla CA list, which doesn't happen to include the specific
// intermediate this particular site chains through. Verified live (this
// task): plain fetch() fails with that exact code; Node's own error
// message names the fix (`--use-system-ca`); `tls.getCACertificates
// ("system")` — a real, built-in Node 22+ API, not a bypass — returns the
// OS's actual trusted roots, and a plain https.get() using an Agent built
// from them succeeds against the real, live host.
//
// Deliberately scoped to a single https.Agent used ONLY by the one caller
// that needs it (resmiGazete.ts) — NOT a process-wide NODE_OPTIONS or
// TLS-verification bypass of any kind. Every other fetch() in this
// codebase (Supabase, OpenAI, Anthropic, Meta Graph API, TCMB, TKGM) is
// completely unaffected and keeps using Node's normal default CA bundle.
// rejectUnauthorized is never set to false anywhere here.
//
// getCACertificates is a real Node 22+ API (verified live against the
// installed Node 24 runtime) that this project's pinned @types/node@20
// simply doesn't declare yet — this is a type-only augmentation (not a
// dependency bump, not an `any` escape hatch for the surrounding code) so
// the rest of this file stays fully type-checked.
type TlsWithSystemCa = typeof tls & { getCACertificates(type: "default" | "system"): string[] };

let systemCaAgent: https.Agent | null = null;
function getSystemCaAgent(): https.Agent {
  if (!systemCaAgent) {
    systemCaAgent = new https.Agent({ ca: (tls as TlsWithSystemCa).getCACertificates("system") });
  }
  return systemCaAgent;
}

export type SecureFetchResult = { status: number; contentType: string; text: string };

export type SecureFetchOptions = {
  timeoutMs: number;
  maxBytes: number;
  accept: string;
};

// Mirrors the exact status/content-type/size-cap contract every other
// adapter's own local fetch helper already implements (see tcmb.ts's
// fetchFeedText, tkgm.ts's fetchListingHtml) — same shape, just backed by
// node:https + the system-CA agent instead of global fetch(), so the
// calling adapter's own validation logic needs no behavioral change.
export function fetchWithSystemTrust(url: string, options: SecureFetchOptions): Promise<SecureFetchResult> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { agent: getSystemCaAgent(), headers: { Accept: options.accept } }, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;

      response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > options.maxBytes) {
          request.destroy(new Error("response exceeded the size limit"));
          return;
        }
        chunks.push(chunk);
      });

      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          contentType: response.headers["content-type"] ?? "",
          text: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });

    request.on("error", reject);
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error("request timed out"));
    });
  });
}
