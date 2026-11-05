# Meta Ads readiness audit and pilot brief
Date: 2026-11-04 (Europe/Istanbul).
Source snapshot: main 8f29ca85820ffcfb27e55e161bda524617ca74fb; instruction package branch research/meta-ads-agent-baseline-20261104.

## Findings and recommendation
Start with Atlas-assisted planning/creative production and manual setup in Meta Ads Manager, conditional on actual account readiness. Do not make MCP integration, a new CRM or autonomous optimization prerequisites for the first pilot. This is an implementation recommendation, not a claim that the account has been tested or that manual setup is always superior.

### Verified by source inspection
- facebook-graph.ts implements Facebook Login for Business, Page discovery via /me/accounts, photo uploads and Page feed publishing. Its documented configuration is Pages publishing. The config_id resolves permissions externally; actual granted scopes cannot be inferred from its ID or comments.
- api/facebook/connect requires an authenticated Atlas session and uses that publishing configuration. It does not itself enumerate ad accounts or fetch advertising insights.
- Instagram's previously inspected OAuth requests basic and content-publish scopes; that is not advertising permission verification.
- Repository file inventory contains no ads/lead/WhatsApp/MCP-named integration path. Naming alone is not proof of complete absence; no working advertising or lead ingestion implementation was established in the inspected paths.
- businessProfile.ts already contains property-type and seller-related ideas. Reuse that context and the existing grounding/editorial pipeline.
- Three proposed advertising agents have explicit read-only or public-research tool lists, referencing one shared project skill.
- Found and corrected a handoff ambiguity: shared skill requested a reviewer although the restricted agents have no delegation tool. Parent session now performs orchestration; reviewer does not request itself.

### Not verified / blocked here
- Claude Code executable is absent in this execution environment (command -v claude returned no executable). Agent discovery, tool permissions in the real Claude session, and behavioral success remain untested.
- No direct Meta account, billing, production Vault or Supabase administration connector is available here. No credentials were accessed. Actual granted scopes, account status, payment, WhatsApp destination readiness and historic performance remain unknown.
- Official Meta MCP setup documentation remains inaccessible through research retrieval. No MCP authentication or advertising API call performed.
- Existing reported WhatsApp connection is not disproved; app-side Cloud API automation and tracking are simply not established by this audit.

## Static instruction checks
Checked metadata, skill references, tool lists and delegation logic against current Claude documentation:
https://code.claude.com/docs/en/sub-agents
Passed: named planner/analyst/reviewer; shared skill exists; reviewer read-only; no campaign mutation tools assigned; missing budget/data must remain MISSING; parent-only orchestration after correction.
Not run: Claude Code invocation or independent behavioral evaluation. Synthetic examples below are analyst walkthroughs, not successful agent executions.
No application code changed; no application build/test suite run for this documentation/instruction-only change.

## Narrow the first pilot
Choose ONE business outcome: sale consultation from a property owner. Exclude rental and buyer objectives from this initial experiment to keep qualification and results interpretable. Cover villa/home and land as property types if budget/creative capacity supports it; do not assume Meta can directly identify owners.
Initial business area: Zekeriyaköy and suitable adjacent service areas, with available targeting and housing-policy requirements to be verified in Ads Manager.
Offer: an initial discussion of the property's sale positioning and marketing approach. No guaranteed sale, ready buyer, formal valuation report or promised investment return.

### Draft creative hypotheses (not launched)
A — Strategy:
Headline: Mülkünüz için satış stratejisi
Copy: Zekeriyaköy ve çevresindeki mülkünüzü satmayı düşünüyorsanız, fiyatlandırma yaklaşımını, sunumu ve pazarlama planını birlikte değerlendirelim. Suat Kılıç ile ön görüşme için iletişime geçin.
B — Stalled sale:
Headline: Satış sürecinizi birlikte değerlendirelim
Copy: Satışta bekleyen mülkünüz için fiyat, sunum ve pazarlama yaklaşımını birlikte gözden geçirelim. Zekeriyaköy ve çevresinde mülkünü satmak isteyenler için ön görüşme.
C — Land:
Headline: Arsanız için satış planı
Copy: Arsa satışında mülkün özelliklerini doğru anlatmak ve uygun alıcı profiline göre bir pazarlama planı hazırlamak önemlidir. Zekeriyaköy ve çevresindeki arsanızın satış sürecini birlikte değerlendirelim.
CTA wording depends on chosen destination; existing brand assets only. No paid image generation authorized by this document. These are illustrative drafts, not accepted final assets or passed editorial reviews.

## Destination decision
Provisional choice: WhatsApp, matching Suat's stated preference and enabling personal qualification without building a new system. Confirm actual Page/ad account linkage and that a test ad preview opens the intended number before adoption. Use a property-type/area/intention/timeframe opening conversation. If instant forms offer better verified access and lead retrieval, compare that alternative before final selection. Do not claim either destination produces better leads without account data.
Suggested opening: Merhaba, mülkümün satışı hakkında görüşmek istiyorum. Bölge: … / Mülk türü: …
Do not ask for title-deed images or detailed ownership documents at first contact.

## Measurement
Qualified inquiry: reachable person who states ownership or authority, a property in the service area, and a real sale intention. This is self-reported qualification, not legal ownership verification.
Stages: inquiry → contacted → qualified → appointment scheduled → appointment held → signed mandate → completed transaction.
Track date, ad/campaign identifiers when available, destination, stage and disqualification reason in an access-controlled tracker outside this public repository. Keep personal details and lead records out of git.
Record spend, currency, timezone and attribution window. A WhatsApp conversation does not equal qualified lead or appointment. If source cannot be attributed, mark unknown instead of assigning it to an ad.
Synthetic arithmetic walkthrough: 3,000 TL spend, 12 unique inquiries, 4 qualified, 2 held appointments, 0 mandates → 250 TL/inquiry; 750 TL/qualified inquiry; 1,500 TL/held appointment; mandate acquisition cost undefined. These numbers are invented test data only, not a budget recommendation, benchmark or forecast.
Missing-data walkthrough: no spend/export/lead records → no CPL/ROI calculation; return MISSING.
Review walkthrough: absent budget cap, policy evidence and destination test → BLOCKED for launch, while creative drafting may continue.

## Launch gate
Require actual ad-account/billing access; applicable policy and targeting check; verified destination; usable lead tracker; final creative and landing/WhatsApp preview; approved duration and total cap; explicit activation approval.
Insufficient evidence: do not auto-raise budget or declare a creative winner. Repeated low-quality inquiries should first trigger inspection of offer, qualification and delivery rather than automatic scaling.
Budget and duration: MISSING. No arbitrary recommendation adopted without learning available spend, capacity and historical account evidence.

## Single Claude Code handoff
Read CLAUDE.md and docs/atlas/META_ADS_RESEARCH.md plus this audit on research/meta-ads-agent-baseline-20261104. Preserve local changes and inspect current main before integrating. Verify the shared skill and the three advertising agents with a seller-consultation brief, a missing-data analysis, and a reviewer BLOCKED case; label simulated inputs explicitly. Keep orchestration in the parent session. Inspect actual account access read-only only if available, without exposing tokens or changing existing publishing login. Report VERIFIED/MISSING/BLOCKED. Prepare the smallest Ads Manager pilot and secure lead tracker; add no MCP/runtime/dependency unless a demonstrated need justifies it. No ad creation, publishing, spending, paid generation, automatic outreach, merge or deployment in this validation task. Stop only for real access blockers or a necessary user decision.

## Current status
Instruction defect fixed on review branch. Readiness and pilot brief prepared. No agents executed in Claude, no live account access tested, no campaign created, no outreach, no spending and no production change.
