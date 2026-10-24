# Roomwise — AI Spatial Design Studio

Built at Cal Hacks 13.0. Upload a photo of an empty room, pick a design style, furnish it in an editable 3D scene, shop real products from the live web, optimize the design against a budget, and check out through a real payment sandbox — all narrated by a team of specialist AI agents (Design, Product, Budget, Comparison, Quotation, Finance).

## Features

- **Capture → Inspire → Personalize → Budget → Quote → Checkout** — a full six-step flow from an empty-room photo to a placed order.
- **Editable 3D room** (React Three Fiber) — drag, rotate, duplicate, and delete furniture; swap pieces live; Before/After and Photo/Orbit/Plan/Walk camera modes.
- **Live shopping via Apify** — the "Shop live (Apify)" search in the Personalize step runs a real web search (`apify/rag-web-browser` actor) for furniture matching your style, optionally scoped to one retailer, and returns real prices, images, and URLs you can drop straight into the room. Pasting a URL in the Inspire step scrapes real page content the same way.
- **Budget Agent** — automatically swaps pieces to premium/mid/budget tiers to hit a target budget while minimizing style-match loss.
- **Chat-driven agents** — a lightweight keyword-based command parser (not an LLM) in the "Message your agents…" box understands things like `upgrade the rug`, `remove the bench`, `switch to coastal light`, `replace the bed with something cheaper`, `keep it under $2,000`, `create my quote`.
- **Real sandbox checkout via CyberSource (Visa Acceptance Solutions)** — the Finance Agent's "Place order" step authorizes a spending mandate, then calls the actual CyberSource sandbox (`POST /pts/v2/payments`, HTTP Signature auth, test card `4111 1111 1111 1111`) per store and shows the real sandbox transaction ID on the receipt. Falls back to a clearly-labeled simulated order if the sandbox is unreachable.

## Tech stack

- React 19 + Vite 8 + TypeScript, Tailwind CSS v4
- `@react-three/fiber` / `@react-three/drei` / `three` for the 3D room
- A small dev-only backend (`server/`, a Vite middleware plugin) that proxies Apify and CyberSource calls server-side so API secrets never reach the browser
- [`cybersource-rest-client`](https://www.npmjs.com/package/cybersource-rest-client) — official SDK for the CyberSource sandbox
- Apify's `rag-web-browser` actor for live web search/scrape

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
| `APIFY_TOKEN` | [Apify Console → Integrations](https://console.apify.com/account/integrations) |
| `VISA_MERCHANT_ID` | Your CyberSource / Visa Acceptance Solutions sandbox Merchant/Organization ID |
| `VISA_KEY_ID` | REST API Key ID from the same sandbox account |
| `VISA_SHARED_SECRET` | REST API Shared Secret Key from the same sandbox account |
| `VISA_RUN_ENVIRONMENT` | Leave as `apitest.cybersource.com` (sandbox) |

**The app runs fine without any of these filled in** — live shopping and real checkout fall back to clear, labeled "no live results" / "simulated" states instead of crashing. Fill them in to get real Apify search results and real CyberSource sandbox transactions.

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
src/                  React UI — App.tsx is the main screen, SpatialCanvas.tsx is the 3D room, CheckoutPanel.tsx is the Finance Agent flow
state/                RoomwiseContext.tsx — all app state (room, budget, chat agents, checkout) in one context
agents/               mockAgents.ts / financeAgent.ts — the scripted "agent" chat message generators + chat command parser
data/products.ts      The curated furniture catalog (premium/mid/budget tiers); live Apify results get merged into this same array at runtime
services/              Frontend API clients: apify.ts (live shopping/scraping), visa.ts (checkout), payments.ts (mandate/order logic)
server/                Dev-only backend: apifyClient.ts, cybersourceClient.ts, devApi.ts (the Vite middleware that routes /api/* to them)
```

## Known limitations

- The chat "agents" are a rule-based keyword matcher, not a real LLM — they understand a broad but finite set of phrasings (see `state/RoomwiseContext.tsx`'s `runCommand`), not arbitrary free text.
- Some large retailers (Wayfair, CB2, IKEA) run bot protection that blocks the live-shopping scraper outright — smaller/independent retailers return results reliably. The UI degrades gracefully (shows "no priced results," never crashes) when a store blocks the scrape.
- CyberSource checkout always uses the fixed sandbox test card (`4111 1111 1111 1111`) with placeholder billing info — there's no real card entry UI, by design (sandbox only).
- The 3D room renders stylized procedural geometry per category/tier, not photoreal models of the actual scraped products — live-shopped items get a real price/photo in the product list, but still render as the same category shape in the 3D scene as their tier-matched static counterpart.

## Credits

Built for Cal Hacks 13.0. Sponsor tech: [Apify](https://apify.com) (live product/content search), [Visa / CyberSource](https://developer.cybersource.com) (sandbox payments).
