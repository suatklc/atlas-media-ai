---
name: atlas-ui-designer
description: Use when designing, building, or improving any UI in the Atlas AI project — dashboard screens, components, layouts, or styling. Enforces Atlas's Turkish-language, premium real-estate-SaaS design standards and its React/Tailwind component conventions. Trigger on requests like "add a page", "redesign this card", "build a new component", "improve the dashboard UI".
---

# Atlas UI Designer

Guidance for designing or improving the Atlas user interface. Atlas is a **real estate social media and content production platform** — every design decision should read as premium, restrained, and trustworthy, not generic AI-dashboard boilerplate.

## Before writing any code

1. **Inspect existing components first.** Look in `src/components/layout/` and `src/components/dashboard/` (and any other component directories that exist by the time you read this) before creating something new. Reuse or extend an existing component rather than duplicating it.
2. **Preserve the existing project architecture.** Don't restructure folders, rename established conventions, or introduce a new pattern (e.g. a new state-management approach, a new styling method) when the existing one already covers the need.
3. **Check for unnecessary dependencies.** Prefer what's already installed (Tailwind CSS, lucide-react, Next.js/React primitives). Only propose a new dependency if the task genuinely can't be done cleanly without it, and flag it explicitly before adding it.

## Language and content

- All user-facing interface text (labels, buttons, headings, nav items, placeholders, empty states, error messages) must be in **Turkish**.
- Code, variable names, comments, and file names stay in English as normal.
- Do not invent unrelated functionality — no CRM features, property valuation tools, chat/messaging systems, or similar unless the user explicitly asks for them. Stay scoped to what was requested.

## Visual design standards

- **Premium, restrained, trustworthy SaaS aesthetic.** Think high-end real estate brand, not generic startup dashboard.
- **Avoid generic AI-gradient looks.** No default purple-to-blue gradient backgrounds, no glowing blobs, no overused glassmorphism. If a gradient is used, keep it subtle and purposeful (e.g. a small accent, not a dominant surface).
- **Avoid visual clutter.** Generous whitespace, clear grouping, no decorative elements that don't serve the content.
- **Avoid excessive animation.** Transitions should be quick and functional (hover states, open/close), never showy or attention-seeking.
- **Clear information hierarchy.** Every screen should have an obvious primary focus, with secondary/tertiary content visually subordinate (size, weight, color).
- **Excellent readability and accessible contrast.** Body text and UI labels must meet WCAG AA contrast against their background. Don't rely on low-opacity gray-on-gray text for anything the user needs to read.

## Layout and responsiveness

- All layouts must work cleanly at **desktop, tablet, and mobile** breakpoints. Test/verify the responsive behavior mentally (or in the browser if available) before considering a component done — sidebars, grids, and tables need explicit mobile treatment, not just a shrink.
- Follow the existing responsive patterns already in the codebase (e.g. the sidebar drawer pattern in `DashboardShell`) rather than inventing a new responsive strategy per component.

## Components and consistency

- Build **reusable React + TypeScript + Tailwind CSS** components — one component per file, typed props, no inline duplication of markup that already exists elsewhere.
- Keep **spacing, typography, card styles, buttons, and navigation** consistent with what's already established in the project. Reuse existing utility patterns (border colors, radius, padding scale) rather than introducing new one-off values.
- If a new pattern is genuinely needed (e.g. a new card variant), make it consistent with the existing visual language, not a stylistic departure.

## After making code changes

Always run, in this order, before considering the work done:
1. TypeScript check (`npx tsc --noEmit`)
2. Lint (`npm run lint`)
3. Build (`npm run build`)

Report and fix any errors from these steps before handing back to the user.

## Git discipline

- **Never commit or push** as part of this skill's work unless the user explicitly instructs it in that turn.
