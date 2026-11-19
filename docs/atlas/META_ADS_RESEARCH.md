# Atlas Meta Ads — research and installation baseline
Research date: 2026-11-04. Scope: public web and publicly indexed social discussions, publisher documentation and repository review; not an exhaustive survey of all social platforms or private groups.

## Decision
Add one project-specific Claude skill and three restricted agents: planner, analyst and independent reviewer. Reuse the existing real-estate strategist, fact-source grounding and editorial gate. Do not install large overlapping bundles or a paid connector before a capability test. These files add Claude Code instructions only, not a production campaign service.

## Evidence
- Anthropic reports its own growth team using two subagents for ad variations and a Figma plugin for batch creatives: https://www.anthropic.com/news/how-anthropic-teams-use-claude-code . This is first-party evidence of workflow efficiency, not independently audited lift or proof of Turkish property leads.
- Anthropic's detailed marketing account: https://claude.com/resources/articles/how-anthropic-uses-claude-marketing . Provider-reported operational results must not be represented as customer-acquisition guarantees.
- Official agent configuration and tool restrictions: https://code.claude.com/docs/en/sub-agents .
- Official hook mechanism: https://code.claude.com/docs/en/hooks . A hook complements, but does not replace, application-side approval and spending enforcement.
- Meta lead-generation guide: https://about.fb.com/ltam/wp-content/uploads/sites/14/2023/11/LeadGenerationGuide.pdf . Search retrieval supports CRM lead sync and Conversions API feedback. Full PDF extraction failed in this research session; no numeric uplift adopted.
- Community source reviewed: https://github.com/coreyhaines31/marketingskills , especially skills/ads/SKILL.md and skills/ad-creative/SKILL.md. MIT library; useful strategy and test patterns, not an Anthropic product or proven estate-sales system. Current names include ads, not just older paid-ads. Conversion-tracking, analytics, CRO and attribution modules are candidates for later source review, not installed dependencies.
- Community toolkit reviewed: https://github.com/bartlomiejborzucki/meta-ads-agent . Planning/validation/approval ideas are useful, but repository existence and self-reported tests do not establish business effectiveness.
- Other MCP/skill bundles surfaced, including Neurounit-base/meta-ads-claude and rafaelszago/meta-ads-mcp. Not installed or audited for production. Conflicting third-party descriptions of Meta MCP tool counts and access make those claims unsuitable as an integration contract.

## Connector decision is pending
Candidate endpoint reported in community projects: https://mcp.facebook.com/ads .
Official reference candidate: https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started .
The official Meta page could not be read by this research tool. Do not claim universal account availability, exact scopes/tool count, pricing or successful authentication. Before setup, retrieve current first-party docs and test read-only against the actual account. If unavailable, evaluate direct Marketing API access with existing server-side Vault patterns. No additional hosted connector chosen.

## Verified Atlas baseline
Repository main inspected at 8f29ca85820ffcfb27e55e161bda524617ca74fb. Existing skills: real-estate-content-strategist, fact-source-grounding, atlas-editorial-quality-gate, atlas-ui-designer and find-skills. Existing independent editorial agent retained. src/lib/publishing/connections/meta-oauth.ts requests instagram_business_basic and instagram_business_content_publish only. This is Instagram Login for publishing, not proof of ads permissions. Architecture documents Instagram/Facebook publishing, with no advertising executor established by this audit. No production credential or live account access was tested.

## Pilot design
Business objective: seller/landlord consultation requests for Suat, initial geography Sarıyer–Zekeriyaköy subject to verified targeting availability. Do not hard-code this business context into shared code. Offer an honest sale-strategy consultation; do not promise formal appraisal, guaranteed buyer or sale.
Prepare up to three hypotheses: sale strategy, land-sale due diligence, marketing/process confidence. Start with one objective/destination rather than splitting a small unknown budget across many campaigns.
Choose instant form or WhatsApp only after confirming access and follow-up measurement. Ask property area/type, intent and timeframe; obtain appropriate contact permission. A WhatsApp profile connection/link is not automated message or webhook capability.
Track lead → contacted → qualified → held appointment → mandate → transaction. Report costs and data completeness. Do not set universal CPL thresholds, spending levels or test duration without account context. Available property-category targeting and data-processing requirements must be checked against current applicable sources before launch.

## Implementation acceptance
1. Existing Claude configuration preserved; new instruction files discoverable and agent references resolvable.
2. Dry-run seller consultation brief: no budget invented, no unverified local figures, three or fewer creative hypotheses.
3. Dry-run missing-data report: no fabricated leads/ROI; zero conversions reported with undefined acquisition cost.
4. Independent review cannot be treated as user authorization.
5. Future account PoC: read-only, sanitized capabilities/reporting, no writes.
6. Future executor: drafts/paused entities only, exact revision approval, explicit activation, server-side cap, idempotency and audit log; test rejection of stale approval, excess budget and duplicate execution before real spend.

## Status
Research and project instruction package prepared. No external skills bulk-installed. No MCP connected. No runtime integration, campaign launch, paid media generation or ad spending performed. Remaining work: validate instructions in Suat's actual Claude Code session, verify Meta account access and policies, then implement the smallest approved pilot.
