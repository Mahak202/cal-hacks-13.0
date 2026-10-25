# Roomwise — AI Spatial Design Studio

Built at Cal Hacks 13.0. Upload a photo of an empty room, pick a design style, furnish it in an editable 3D scene, shop real products from the live web, optimize the design against a budget, and check out through a real payment sandbox — all narrated by a team of specialist AI agents (Design, Product, Budget, Comparison, Quotation, Finance), driven by a real LLM.

## Features

- **Capture → Inspire → Personalize → Budget → Quote → Checkout** — a full six-step flow from an empty-room photo to a placed order.
- **Editable 3D room** (React Three Fiber) — drag, rotate, duplicate, and delete furniture; swap pieces live; Before/After and Photo/Orbit/Plan/Walk camera modes.
- **Claude-powered chat agent** — the "Message your agents…" box is driven by Claude with real tool-calling (13 actions: swap tiers, remove/duplicate items, change style, adjust wall tone, optimize budget, undo, inspect, compare, shop live, create a quote, navigate steps, or just converse). It keeps conversation memory across turns (so "no, undo that" resolves correctly) and replies under the correct specialist badge (Design/Product/Budget/etc.) via a dedicated `speak` tool. Falls back to a simpler keyword-based parser if the API key is missing or a call fails — the app never breaks either way.
- **Live shopping via Apify (Google Shopping Scraper)** — the "Search live" box in the Personalize step lets you pick one or more retailers (checkboxes) plus an optional free-text query, searches them in parallel, and queries Google's own shopping index for real, structured price/seller/rating/review-count data — not scraped/guessed text. Results are normalized, deduplicated by original product URL, sorted by current price, and include a direct **View original ↗** link back to the real listing. Because it goes through Google's index rather than crawling retailer sites directly, it surfaces listings from stores (e.g. Wayfair) that block direct scraping outright. Real ratings also feed the existing comparison-table "durability" display for live items. Prices, images, and availability can change on the retailer site, so verify the final details there before purchasing.
- **Real AI-generated product images (Apify)** — every product shown anywhere in the app (the full static catalog, live search results, and custom "Generate with AI" library items) gets a real generated photo via Apify's FLUX-based image actor, cached per product so each one is only ever generated once per session.
- **Inspiration scraping via Apify** — pasting a URL in the Inspire step scrapes real page content (`apify/rag-web-browser`) for style/mood extraction.
- **Budget Agent** — automatically swaps pieces to premium/mid/budget tiers to hit a target budget while minimizing style-match loss.
- **Real sandbox checkout + refunds via CyberSource (Visa Acceptance Solutions)** — the Finance Agent's "Place order" step authorizes a spending mandate (total limit, per-item cap, auto-approve threshold), then calls the actual CyberSource sandbox (`POST /pts/v2/payments`, HTTP Signature auth, test card `4111 1111 1111 1111`) per store and shows the real sandbox transaction ID on the receipt. Each confirmed receipt also has a **Refund** button that fires a real `POST /pts/v2/payments/{id}/refunds` against that transaction — a genuine charge-then-refund round trip, not just a one-way charge. The confirmation screen reports exactly how many orders the agent approved **autonomously** within its mandate versus how many needed your sign-off (and how many it skipped for exceeding the mandate), plus how many settled via a real sandbox call versus a simulated fallback if the sandbox was unreachable — an accurate, auditable account of what the agent actually did, not a flat "no real charges were made" placeholder.

## Hyphenate track — "The Hyphenated Enterprise: Autonomous Systems for Finance"

Hyphenate's own product is an enterprise finance-automation platform (order-to-cash, procure-to-pay, treasury, GL close) that runs on top of a company's existing ERP — it has no public, hackathon-facing API, so there's nothing to literally "call." What we built instead is the same architectural pattern Hyphenate is built around, proven with real payment rails rather than a mocked-up demo:

- **Autonomous by default.** The Finance Agent executes under a human-authorized mandate (total spending limit, per-item cap, auto-approve threshold, allowed merchants). Any order that fits the mandate is checked, priced, and paid with zero clicks — the agent doesn't ask permission for routine work, matching Hyphenate's "agents do the routine work on their own."
- **Escalation on judgment calls, not silent overrides.** The instant an order exceeds the auto-approve threshold, exceeds the per-item/total limit, or targets a merchant outside the mandate, the agent stops and surfaces exactly why — offering Approve / Skip / Find cheaper. It never spends past the boundary a human set.
- **Real money movement, not UI theater.** Every autonomous or approved order fires an actual CyberSource (Visa Acceptance Solutions) sandbox payment through the official REST SDK and gets back a real transaction ID — proof the "autonomy" is doing something, not just animating a progress bar.
- **Fully auditable, end to end.** Every decision (price drop applied, promo applied, auto-approved under threshold, skipped for exceeding the mandate, refunded) is timestamped with its reasoning in an audit log. The final invoice reports exactly how many orders were autonomous vs. human-approved vs. skipped, and how many settled via a real sandbox call vs. a simulated fallback — never a flat "trust me" summary.
- **Reversible, not one-way.** A real refund (CyberSource's refund API) is available per confirmed order, mirroring Hyphenate's emphasis on traceable, correctable financial actions.

See `services/payments.ts` (mandate/order logic), `src/CheckoutPanel.tsx` (the autonomous/escalation state machine), and `agents/financeAgent.ts` (the audit narration) for the implementation.

## Tech stack

- React 19 + Vite 8 + TypeScript, Tailwind CSS v4
- `@react-three/fiber` / `@react-three/drei` / `three` for the 3D room
- A small dev-only backend (`server/`, a Vite middleware plugin) that proxies Anthropic, Apify, and CyberSource calls server-side so API secrets never reach the browser
- [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) — Claude (Sonnet) with tool use, powering the chat agent
- [`cybersource-rest-client`](https://www.npmjs.com/package/cybersource-rest-client) — official SDK for the CyberSource sandbox
- Apify actors: `apify/rag-web-browser` (inspiration scraping), `cheapapi/google-shopping-scraper` (live product search), `akash9078/ai-image-generator` (product image generation)

## Getting started

### 1. Prerequisites

- Node 22 (see `.mise.toml`)
- pnpm 10.34.3 — if you don't have it, use Corepack instead of installing globally:
  ```bash
  corepack pnpm@10.34.3 install
  ```

### 2. Install dependencies

```bash
pnpm install
# or, without pnpm installed globally:
corepack pnpm@10.34.3 install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env` with:

| Variable | Where to get it |
|---|---|
| `APIFY_TOKEN` | [Apify Console → Integrations](https://console.apify.com/account/integrations) — powers live shopping search, product image generation, and inspiration scraping |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) — powers the tool-calling chat agent |
| `VISA_MERCHANT_ID` | Your CyberSource / Visa Acceptance Solutions sandbox Merchant/Organization ID |
| `VISA_KEY_ID` | REST API Key ID from the same sandbox account |
| `VISA_SHARED_SECRET` | REST API Shared Secret Key from the same sandbox account |
| `VISA_RUN_ENVIRONMENT` | Leave as `apitest.cybersource.com` (sandbox) |

**The app runs fine without any of these filled in** — live shopping, image generation, the chat agent, and real checkout all fall back to clear, labeled "no live results" / "simulated" / keyword-parser states instead of crashing. Fill them in to get real Apify results, a real LLM-driven agent, and real CyberSource sandbox transactions.

`.env` is gitignored — never commit real credentials. `.env.example` has no secrets and is safe to commit.

### 4. Run it

```bash
pnpm dev
```

Opens at `http://localhost:8443` by default (or set `PORT`).

### 5. Build for production

```bash
pnpm build
```

## Project structure

```
src/                     React UI — App.tsx is the main screen, SpatialCanvas.tsx is the 3D room, CheckoutPanel.tsx is the Finance Agent flow, ProductThumb.tsx renders real product images with caching
state/                   RoomwiseContext.tsx — all app state (room, budget, chat agent, checkout) in one context
agents/                  mockAgents.ts / financeAgent.ts — the rich agent chat-message generators (swap cards, budget summaries, comparison tables) that both the LLM agent and the keyword fallback post into
data/products.ts         The curated furniture catalog (premium/mid/budget tiers); live Apify results get merged into this same array at runtime
services/                Frontend API clients: claude.ts (chat agent), apify.ts (live shopping/inspiration), imageGen.ts / productImages.ts (image generation + caching), visa.ts (checkout/refunds), payments.ts (mandate/order logic)
server/                  Dev-only backend: claudeAgent.ts (tool-calling agent), apifyClient.ts, cybersourceClient.ts, devApi.ts (the Vite middleware that routes /api/* to all of them)
```

## Known limitations

- The LLM chat agent needs `ANTHROPIC_API_KEY` to work as described; without it (or if a call fails), it silently falls back to a simpler keyword-based parser that only understands a finite set of phrasings.
- CyberSource checkout always uses the fixed sandbox test card (`4111 1111 1111 1111`) with placeholder billing info — there's no real card entry UI, by design (sandbox only).
- The 3D room renders stylized procedural geometry per category/tier, not photoreal 3D models — every product does get a real generated/scraped photo in the product lists and the "selected item" chip, but the 3D scene itself still shows the same category shape regardless of which specific product (live, catalog, or custom) is placed.
- Live search occasionally returns a loosely-related result for ambiguous category names (e.g. "bed" can pull in bedding alongside bed frames) or an occasional duplicate listing — a real-world quirk of aggregated shopping data, not a crash.

## Credits

Built for Cal Hacks 13.0. Sponsor tech: [Apify](https://apify.com) (live shopping, product image generation, content scraping) and [Visa / CyberSource](https://developer.cybersource.com) (sandbox payments and refunds).
