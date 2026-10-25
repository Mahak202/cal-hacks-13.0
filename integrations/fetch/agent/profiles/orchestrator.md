![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# Roomwise Orchestrator

Plan a room's furniture from live product listings, within your budget, with a team of specialist agents.

## What it does

Tell it the room, style, items and budget. It coordinates six Roomwise agents:

- **Design agent**: turns your style and item list into a room brief and search terms.
- **Product agent**: searches live Google Shopping listings.
- **Budget agent**: picks the best-rated combination that fits your budget, **including estimated sales tax and delivery**.
- **Comparison agent**: compares alternatives for an item.
- **Quotation agent**: returns the itemized quote with prices in USD, links and the estimated total.
- **Finance agent**: splits the plan into per-retailer orders and checks spending limits (planning only).

Follow-ups work in the same chat: change the budget, add or remove items, compare options, choose a specific option, split by store, or start over.

## The team

| Agent | Address |
|---|---|
| Roomwise Orchestrator | `agent1qttdww3mm6hmlz5x8zefhwr4532c52f8dpj8lw4dlk5g37xgjfap55ntf79` |
| Design agent | `agent1qdkksys0cstwjvzgukfree7z62p0qmd8tjrq2wzgq9hmt36w59u8wzujdhf` |
| Product agent | `agent1q09tg7uzqxeqepvy97fq4x8c8hurdknm2kxztf3a6trm67ltqwscspv6vuk` |
| Budget agent | `agent1qflg73xwltghuzrsg3j8dny6sxcfugamc9m374wrdypkfq6h4jmlxl4tgsy` |
| Comparison agent | `agent1q2xk8sjjph0a7wdr3amykuxxq56p236rz0hzh6jpvmu8wpa2w7n4jg9627k` |
| Quotation agent | `agent1qdlpvc7t2alhhhvgrq3slv7pwrul6nzsrmf2ydl303vnzeuuaerl5ef68cm` |
| Finance agent | `agent1qvwa4sfeadlwy8j5dl3muwlxpctqucrwe9nznas6pempgwsgmw09csgejxn` |

The orchestrator delegates each step to the specialist that owns it over a dedicated agent-to-agent protocol (RoomwiseDelegation); specialists accept delegated work only from the orchestrator.

## Supported items

Indoor: bed, rug, pendant lights, side tables, bench, planter, wall art, curtains, chair, ceiling fan.
Outdoor: outdoor planter, outdoor chair, pergola, string lights.

## Example prompts

- "Japandi bedroom with a bed, a rug and 2 side tables, budget $2,000"
- "Compare rugs"
- "Choose option 2 for the rug"
- "Set my budget to $1,500"
- "Split my plan by store, max $600 per item"

## Accuracy notes

- Tax and delivery are **estimates** (a flat 9.375% tax rate unless you give yours, and USD 49 per retailer), not retailer quotes.
- Stock, discounts and exact shipping are **not** checked.
- If a live search fails, the item is left out and the reply says so. Roomwise demo catalog prices are only used if you explicitly ask, and are labelled as illustrative.
- Planning only: nothing is reserved, charged or purchased.
