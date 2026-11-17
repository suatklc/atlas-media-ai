import { lookup } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";

// TEMPORARY diagnosis (2026-11-17, part of the [radar-diag] set): from
// production (fra1) every TKGM linked-PDF fetch on cms-api.tkgm.gov.tr ended
// in the 10 s client timeout with no HTTP response, while www.tkgm.gov.tr
// answered. A fetch() timeout cannot say WHERE it stalled. This probe walks
// the same connection step by step — DNS → TCP → TLS → first response byte
// of a HEAD request — each with its own short timeout, and reports only
// durations and error kinds. No body is read, no cookie or credential is
// sent, nothing is retried. Remove together with the other [radar-diag]
// code once diagnosed.

export type ProbeStep = { ok: boolean; ms: number; error?: string };
export type ProbeResult = {
  host: string;
  dns?: ProbeStep & { addresses?: number; family?: number };
  tcp?: ProbeStep;
  tls?: ProbeStep & { protocol?: string | null };
  firstByte?: ProbeStep & { status?: number };
};

const STEP_TIMEOUT_MS = 5_000;

function kindOf(error: unknown): string {
  const value = error as { code?: unknown; name?: unknown } | null;
  return typeof value?.code === "string" ? value.code : typeof value?.name === "string" ? value.name : "Error";
}

// Runs one connection attempt to host:443 for `path` and never throws.
export async function probeHttpsEndpoint(host: string, path: string): Promise<ProbeResult> {
  const result: ProbeResult = { host };

  let address: string;
  let family: number;
  let started = Date.now();
  try {
    const all = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" })), STEP_TIMEOUT_MS)),
    ]);
    if (all.length === 0) throw Object.assign(new Error("no address"), { code: "NOADDR" });
    ({ address, family } = all[0]);
    result.dns = { ok: true, ms: Date.now() - started, addresses: all.length, family };
  } catch (error) {
    result.dns = { ok: false, ms: Date.now() - started, error: kindOf(error) };
    return result;
  }

  started = Date.now();
  const socket = new net.Socket();
  try {
    await new Promise<void>((resolve, reject) => {
      socket.setTimeout(STEP_TIMEOUT_MS, () => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
      socket.once("error", reject);
      socket.connect({ host: address, port: 443, family }, () => resolve());
    });
    result.tcp = { ok: true, ms: Date.now() - started };
  } catch (error) {
    result.tcp = { ok: false, ms: Date.now() - started, error: kindOf(error) };
    socket.destroy();
    return result;
  }

  started = Date.now();
  let secure: tls.TLSSocket | undefined;
  try {
    secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const s = tls.connect({ socket, servername: host }, () => resolve(s));
      s.setTimeout(STEP_TIMEOUT_MS, () => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
      s.once("error", reject);
    });
    result.tls = { ok: true, ms: Date.now() - started, protocol: secure.getProtocol() };
  } catch (error) {
    result.tls = { ok: false, ms: Date.now() - started, error: kindOf(error) };
    socket.destroy();
    return result;
  }

  started = Date.now();
  try {
    const status = await new Promise<number>((resolve, reject) => {
      secure!.setTimeout(STEP_TIMEOUT_MS, () => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
      secure!.once("error", reject);
      secure!.once("data", (chunk: Buffer) => {
        const match = chunk.toString("latin1").match(/^HTTP\/\d(?:\.\d)? (\d{3})/);
        resolve(match ? Number(match[1]) : 0);
      });
      secure!.write(`HEAD ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: atlas-radar-probe\r\nConnection: close\r\n\r\n`);
    });
    result.firstByte = { ok: true, ms: Date.now() - started, status };
  } catch (error) {
    result.firstByte = { ok: false, ms: Date.now() - started, error: kindOf(error) };
  } finally {
    secure.destroy();
  }
  return result;
}
