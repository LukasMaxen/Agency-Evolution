# Client Roster

All 15 active workspaces. For per-client offer, tone, Calendly links, and reply guidelines see `client-management/client-profiles.md`. For campaign offers, script rules, and performance data see `clients/[slug].md`.

## Active Workspaces

| # | Client | Workspace Slug | Contact | Timezone | Campaign Type |
|---|---|---|---|---|---|
| 1 | Larsen Digital | `larsen-digital` | Nicklas Larsen | CET UTC+1 | DTC Shopify brand growth/exit |
| 2 | ACT Capital | `act-capital` | Jeff Zanardi | PST UTC-8 | Sell-side M&A, buy-side acquisition |
| 3 | Acceler8rs | `acceler8rs` | Lukas Maxen | CET UTC+1 | eCommerce brand growth/exit |
| 4 | Hahnbeck | `hahnbeck` | Taliesen Hollywood | GMT UTC+0 | Sell-side + buy-side M&A, eCommerce |
| 5 | 911 Restoration | `911-restoration` | Idan Shpizear | Various (US) | Franchise recruitment |
| 6 | Micro Nordic | `micro-nordic` | — | CET UTC+1 | Rugged IT hardware (ToughBook, scanners) |
| 7 | GN Motion | `gn-motion` | Romain Guillon | CET UTC+1 | CGI product visualization |
| 8 | Statera Capital | `statera-capital` | Svetlin Petrov | EET UTC+2 | PE add-on acquisitions + ZEBS fundraising |
| 9 | Venture Exits | `venture-exits` | Tim Enger | CST UTC-6 | Sell-side M&A, Texas focus |
| 10 | Wrobel Capital | `wrobel-capital` | Stephen Wrobel | CST UTC-6 | Sell-side M&A + debt financing |
| 11 | Zenith Global | `zenith-global` | — | Unknown | Multi-entity businesses (Midas offer) |
| 12 | ITG Group | `itg-group` | — | Unknown | Unknown — needs confirmation |
| 13 | Sonaro AI | `sonaro-ai` | Manuele Giamminola | GMT UTC+0 | AI automation for clinics + law firms |
| 14 | Zebs IBS | `zebs-ibs` | — | CET UTC+1 | EdTech seed round fundraising |
| 15 | SRO Consulting | `sro-consulting` | — | Unknown | Unknown — needs confirmation |

## Shared Infrastructure

- All workspaces run on a single EmailBison instance: `https://send.emailagencyevolution.com`
- Each workspace has its own `email_bison_api_key` and `email_bison_instance_url` stored in the `workspaces` DB table
- Webhook endpoint per workspace: `POST /api/webhook/[slug]`

## Onboarding a New Client

1. Add row to `workspaces` table in PostgreSQL
2. Register webhook in EmailBison → `https://[domain]/api/webhook/[slug]`
3. Create client file at `clients/[slug].md`
4. Fill out client profile in `client-management/client-profiles.md`
5. Add to the roster table above
6. Add follow-up templates in `reply-management/reply-process.md`
