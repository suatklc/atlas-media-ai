---
name: atlas-meta-ads
description: Plan and audit Atlas Meta lead-generation campaigns, creative tests and qualified-lead measurement. Use for Facebook or Instagram paid ads, campaign readiness, lead quality and advertising reports. Produces drafts only; never activates ads or changes budgets.
---
# Atlas Meta lead generation
Read CLAUDE.md, docs/atlas/GUARDRAILS.md and docs/atlas/META_ADS_RESEARCH.md first. Reuse existing businessProfile, grounded ContentPackage, creative brief and editorial gate. This is a Claude Code workflow, NOT an installed web-app runtime.

## Workflow
1. Inventory existing code, account capability and data. Report VERIFIED / MISSING / BLOCKED. Page or Instagram publishing access does not establish advertising access. Do not expose credentials.
2. Resolve business goal from businessProfile and supplied brief. Initial Suat campaign: seller/landlord consultation in Sarıyer–Zekeriyaköy; land and housing both eligible. No claim that Meta can identify property owners directly.
3. Research public Ad Library examples and relevant public social/web content with source URLs and observation dates. Active ads, likes and long runtime are NOT evidence of profitability. Use only authorized retrieval; no private-account scraping.
4. Draft a single coherent campaign and at most three distinct creative hypotheses. Specify audience availability as verified or MISSING; verify applicable housing category/targeting restrictions for the advertiser and destination market against current Meta policy. Never invent local price data, guaranteed buyers, valuations or returns.
5. Choose instant form, website form or WhatsApp based on available integration and measurable follow-up. A WhatsApp link is not Cloud API integration. Include qualification questions: property area/type, sale/rent intention, timeframe and permission to contact. Do not publish personal data.
6. Record campaign/ad identifiers and measurement definitions: leads, contacted, qualified, appointment held, mandate won, transaction. Cost per qualified lead = spend / qualified leads; appointment cost = spend / held appointments. Zero denominator is undefined, never zero cost. Keep Meta-attributed and CRM-confirmed results distinct; deduplicate.
7. Return creative drafts, destination, duration, currency, total proposed cap, measurement plan and missing decisions. Budget is MISSING until supplied. No invented benchmark or automatic optimization from sparse data.
8. The parent Claude session orchestrates planner → analyst (when data exists) → reviewer. Restricted subagents return their output to the parent; they do not invoke other agents. When acting as atlas-ads-reviewer, review only and never request another review. The parent obtains an independent atlas-ads-reviewer read before calling anything launch-ready.

## Authority
No live campaign writes, activation, budget changes, automatic outreach, paid media generation or publishing through this workflow. The future executor must independently enforce explicit approval of an exact campaign revision, spending cap and activation action server-side. A prompt or hook alone is not authorization enforcement. Start any future account connector in read-only mode and prove capability before selecting it.

## Output
Goal | evidence | creative hypotheses | destination | measurement | proposed budget/duration | VERIFIED/MISSING/BLOCKED | next implementation step.
Report facts, interpretations and hypotheses separately. Preserve exact facial identity in personal-photo requests; do not promise a generative edit can guarantee pixel identity.
