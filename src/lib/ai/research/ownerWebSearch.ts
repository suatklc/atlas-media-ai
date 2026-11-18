import type Anthropic from "@anthropic-ai/sdk";
import type { BusinessProfile } from "../context/businessProfile";
import type { OwnerProposal } from "../content/ownerProposals";
import { isInstitutionalPromo } from "../content/ownerProposals";
import { classifyGeoScope, homeAreaNames } from "./turkishPlaces";
import { radarDiag } from "./retrieval/diagnostics";

// Owner-proposal web search (2026-11-18). ONE Messages API call with
// Anthropic's server-side web_search tool, confined to the sites the
// business named (BusinessProfile.webSearchDomains), asking for up to one
// owner-facing proposal per theme (ownerThemes). Smallest slice of the paused
// stash@{0} discovery experiment: its line-format parsing, URL verification
// and direct (non-filtered) search calls — not its separate Radar layer.
//
// Safety, by construction:
// - OFF unless OWNER_WEB_SEARCH_ENABLED === "true" (each call is billed).
// - Bounded: max_uses searches, max_tokens output, no SDK retries (a retry
//   would bill twice), no pause_turn continuation, request timeout.
// - A proposal survives only if its URL appeared in THIS request's real
//   search results AND is on an allowed domain; the date comes from the
//   result's own page_age, never the model's text.
// - These sites are topic inspiration, never fact evidence (sourceRegistry
//   social/discovery rule): a web proposal drives the existing EXPERT
//   (instruction) flow, which writes no facts, figures or dates.
// - Other cities' decisions, institutional promotion and price/time/return
//   claims are dropped deterministically.

export const OWNER_WEB_SEARCH_MAX_USES = 5;
export const OWNER_WEB_SEARCH_MAX_TOKENS = 6000;
const REQUEST_TIMEOUT_MS = 45_000;
const CURRENT_MAX_AGE_DAYS = 30;

// Claude Sonnet 5 list prices (platform.claude.com/docs/en/about-claude/pricing,
// checked 2026-11-18): $2 / MTok input, $10 / MTok output, $0.20 / MTok cache
// reads, $2.50 / MTok 5-minute cache writes; web search $10 per 1,000
// searches (failed searches are not billed; results are billed as input).
export const PRICING_USD = {
  inputPerMTok: 2,
  outputPerMTok: 10,
  cacheReadPerMTok: 0.2,
  cacheWritePerMTok: 2.5,
  perSearch: 0.01,
} as const;

export type WebSearchUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number } | null;
};

export function estimateCostUsd(usage: WebSearchUsage): number {
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const cost =
    (usage.input_tokens * PRICING_USD.inputPerMTok +
      usage.output_tokens * PRICING_USD.outputPerMTok +
      (usage.cache_read_input_tokens ?? 0) * PRICING_USD.cacheReadPerMTok +
      (usage.cache_creation_input_tokens ?? 0) * PRICING_USD.cacheWritePerMTok) /
      1_000_000 +
    searches * PRICING_USD.perSearch;
  return Math.round(cost * 10_000) / 10_000;
}

export function isOwnerWebSearchEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.OWNER_WEB_SEARCH_ENABLED === "true";
}

function buildSystemPrompt(profile: BusinessProfile): string {
  const themes = (profile.contentStrategy?.ownerThemes ?? []).map((theme) => `- ${theme.id}: ${theme.label}`).join("\n");
  const places = [profile.geography.primary, ...profile.geography.nearby].join(", ");
  return `Sen ${profile.brand.name} (${profile.brand.title}) için çalışan bir içerik araştırmacısısın. Hedef okur: ${places} bölgesinde mülkünü (konut, villa, arsa) satmak isteyen mülk sahipleri.

Görev: web_search aracıyla yalnız izin verilen sitelerde arama yap ve bu mülk sahiplerine yararlı, özgün içerik önerileri çıkar. Her tema için EN FAZLA bir öneri:
${themes}

Kurallar:
- Yalnız bu konuşmadaki web_search sonuçlarında gerçekten gördüğün bir URL'yi yaz. URL uydurma, tahmin etme, yeniden kurma.
- Kaynaktaki metni, başlığı veya görseli kopyalama; öneriyi kendi cümlelerinle, mülk sahibinin bakışıyla yaz.
- Fiyat artışı, satış süresi, getiri veya kazanç iddiası, rakam, yüzde ve tutar yazma; sonuç veya müşteri garantisi verme.
- Başka il veya ilçelere özgü kararları, kurum tanıtım haberlerini (bakan açıklaması, tören, zirve, övgü) kullanma.
- Uygun kaynak yoksa o temayı atla; listeyi doldurmak için zayıf öneri yazma.

Her öneriyi tam olarak bu biçimde yaz:
[[PROPOSAL]]
THEME: <yukarıdaki tema kimliklerinden biri>
TITLE: <paylaşım başlığı, en fazla 90 karakter>
BENEFIT: <mülk sahibine faydası, tek cümle, en fazla 160 karakter>
SOURCE_URL: <arama sonuçlarındaki tam URL>
FORMAT: <Carousel veya Tek Görsel>
[[/PROPOSAL]]`;
}

export function buildOwnerWebSearchRequest(profile: BusinessProfile, model: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: OWNER_WEB_SEARCH_MAX_TOKENS,
    system: buildSystemPrompt(profile),
    messages: [
      {
        role: "user",
        content: `${profile.geography.primary} ve çevresinde (${profile.geography.nearby.join(", ")}) mülkünü satmak isteyenler için izin verilen sitelerde ara ve önerileri yaz.`,
      },
    ],
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: OWNER_WEB_SEARCH_MAX_USES,
        allowed_domains: profile.webSearchDomains ?? [],
        // Direct calls: max_uses is enforced exactly and results arrive as a
        // flat list (no nested code-execution blocks to unpack).
        allowed_callers: ["direct"],
        user_location: { type: "approximate", country: "TR", city: "Istanbul", timezone: "Europe/Istanbul" },
      },
    ],
  };
}

type RawProposal = { theme: string; title: string; benefit: string; sourceUrl: string; format: string };

const BLOCK_PATTERN = /\[\[PROPOSAL\]\]([\s\S]*?)\[\[\/PROPOSAL\]\]/g;

export function parseWebProposals(text: string): RawProposal[] {
  const proposals: RawProposal[] = [];
  for (const match of text.matchAll(BLOCK_PATTERN)) {
    const fields: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const field = line.trim().match(/^([A-Z_]+):\s*(.*)$/);
      if (field) fields[field[1]] = field[2].trim();
    }
    if (fields.THEME && fields.TITLE && fields.BENEFIT && fields.SOURCE_URL) {
      proposals.push({ theme: fields.THEME, title: fields.TITLE, benefit: fields.BENEFIT, sourceUrl: fields.SOURCE_URL, format: fields.FORMAT ?? "" });
    }
  }
  return proposals;
}

// Price / time / return / guarantee claims the copy must never carry.
const CLAIM_PATTERN = /\d+\s*(%|tl|₺|\$|€|gün|hafta|ay|yıl|kat)|%\s*\d|garanti|kesinlikle|kesin (satış|kazanç)|getiri|kazandır/i;

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

export type VerifiedResult = { url: string; title: string; pageAge?: string | null };

function pageAgeIso(pageAge: string | null | undefined): string | undefined {
  if (!pageAge) return undefined;
  const time = new Date(pageAge).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

export function toWebProposals(
  raw: RawProposal[],
  results: VerifiedResult[],
  profile: BusinessProfile,
  now: Date = new Date(),
): OwnerProposal[] {
  const themes = new Map((profile.contentStrategy?.ownerThemes ?? []).map((theme) => [theme.id, theme]));
  const allowed = new Set((profile.webSearchDomains ?? []).map((domain) => domain.toLowerCase().replace(/^www\./, "")));
  const verified = new Map(results.map((result) => [result.url, result]));
  const home = homeAreaNames(profile.geography);
  const usedThemes = new Set<string>();
  const usedUrls = new Set<string>();
  const proposals: OwnerProposal[] = [];

  for (const item of raw) {
    const theme = themes.get(item.theme);
    const result = verified.get(item.sourceUrl);
    const host = hostOf(item.sourceUrl);
    if (!theme || usedThemes.has(theme.id) || !result || usedUrls.has(item.sourceUrl)) continue;
    if (!host || ![...allowed].some((domain) => host === domain || host.endsWith(`.${domain}`))) continue;
    const title = item.title.trim();
    const benefit = item.benefit.trim();
    if (title.length < 10 || title.length > 120 || benefit.length < 10 || benefit.length > 200) continue;
    if (CLAIM_PATTERN.test(title) || CLAIM_PATTERN.test(benefit)) continue;
    if (isInstitutionalPromo(title) || isInstitutionalPromo(result.title)) continue;
    if (classifyGeoScope(`${title} ${result.title}`, home).kind === "elsewhere") continue;

    // Only pages dated by their own page_age within 30 days; an old or
    // undated page is dropped — never relabelled as evergreen.
    const publishedAt = pageAgeIso(result.pageAge);
    const recent = publishedAt !== undefined && now.getTime() - new Date(publishedAt).getTime() <= CURRENT_MAX_AGE_DAYS * 86_400_000;
    if (!recent) continue;
    usedThemes.add(theme.id);
    usedUrls.add(item.sourceUrl);
    proposals.push({
      themeId: theme.id,
      themeLabel: theme.label,
      kind: "current",
      title,
      benefit,
      format: item.format === "Tek Görsel" ? "Tek Görsel" : "Carousel",
      source: { name: host, url: item.sourceUrl, publishedAt },
      sourceRole: "inspiration",
      instruction: `${profile.geography.primary} ve çevresinde mülkünü satmak isteyen mülk sahiplerine "${title}" konusunu, ${benefit.replace(/\.$/, "").toLocaleLowerCase("tr-TR")} odağıyla anlatan özgün bir uzman paylaşımı hazırla. Konu bir sektör/yerel yayından ilham alındı: oradaki metni, rakamları, tarihleri ve iddiaları aktarma; yalnız kendi uzman değerlendirmeni yaz.`,
    });
  }
  return proposals;
}

export type OwnerWebSearchResult = {
  status: "disabled" | "ok" | "error";
  proposals: OwnerProposal[];
  costUsd?: number;
};

// Never throws. Disabled → no network call at all.
export async function runOwnerWebSearch(options: {
  profile: BusinessProfile;
  model: string;
  getClient: () => Pick<Anthropic, "messages">;
  env?: Record<string, string | undefined>;
  now?: Date;
}): Promise<OwnerWebSearchResult> {
  const { profile, model, getClient } = options;
  if (!isOwnerWebSearchEnabled(options.env) || !(profile.webSearchDomains?.length)) {
    return { status: "disabled", proposals: [] };
  }
  const startedAt = Date.now();
  try {
    const response = await getClient().messages.create(buildOwnerWebSearchRequest(profile, model), {
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    const results: VerifiedResult[] = [];
    let text = "";
    let searchErrors = 0;
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "web_search_tool_result") {
        if (Array.isArray(block.content)) {
          for (const result of block.content) results.push({ url: result.url, title: result.title, pageAge: result.page_age });
        } else {
          searchErrors += 1;
        }
      }
    }
    const raw = parseWebProposals(text);
    const proposals = toWebProposals(raw, results, profile, options.now);
    const costUsd = estimateCostUsd(response.usage as WebSearchUsage);
    // Counts and cost only — no query text, URLs or page content.
    radarDiag("owner-web-search", {
      status: "ok",
      stopReason: response.stop_reason,
      searches: response.usage.server_tool_use?.web_search_requests ?? 0,
      searchErrors,
      results: results.length,
      parsed: raw.length,
      kept: proposals.length,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd,
      ms: Date.now() - startedAt,
    });
    return { status: "ok", proposals, costUsd };
  } catch (error) {
    const kind = error instanceof Error ? error.name : typeof error;
    console.error("Owner web search failed:", error instanceof Error ? error.message : String(error));
    radarDiag("owner-web-search", { status: "error", error: kind, ms: Date.now() - startedAt });
    return { status: "error", proposals: [] };
  }
}
