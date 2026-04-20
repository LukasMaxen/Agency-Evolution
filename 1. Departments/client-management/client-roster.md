# Client Roster

All 15 active workspaces. For per-client offer, tone, Calendly links, and campaign strategy see `campaign-strategy/[client-name].md`.

## Active Workspaces

| # | Client | Workspace Slug | Vertical |
|---|---|---|---|
| 1 | Larsen Digital | `larsen-digital` | [See campaign-strategy/larsen-digital.md] |
| 2 | ACT Capital | `act-capital` | Capital / PE |
| 3 | Acceler8rs | `acceler8rs` | Acquisition / Entrepreneurship |
| 4 | Hahnbeck | `hahnbeck` | [See campaign-strategy/hahnbeck.md] |
| 5 | 911 Restoration | `911-restoration` | Franchise / Restoration |
| 6 | Micro Nordic | `micro-nordic` | [See campaign-strategy/micro-nordic.md] |
| 7 | GN Motion | `gn-motion` | [See campaign-strategy/gn-motion.md] |
| 8 | Statera Capital | `statera-capital` | Capital / Advisory |
| 9 | Venture Exits | `venture-exits` | Business Exits / M&A |
| 10 | Wrobel Capital | `wrobel-capital` | Capital / PE |
| 11 | Zenith Global | `zenith-global` | [See campaign-strategy/zenith-global.md] |
| 12 | ITG Group | `itg-group` | [See campaign-strategy/itg-group.md] |
| 13 | Sonaro AI | `sonaro-ai` | AI / Technology |
| 14 | Zebs IBS | `zebs-ibs` | [See campaign-strategy/zebs-ibs.md] |
| 15 | SRO Consulting | `sro-consulting` | Consulting |

## Shared Infrastructure

- All workspaces run on a single EmailBison instance: `https://send.emailagencyevolution.com`
- Each workspace has its own `email_bison_api_key` and `email_bison_instance_url` stored in the `workspaces` DB table
- Webhook endpoint per workspace: `POST /api/webhook/[slug]`

## Onboarding a New Client

1. Add row to `workspaces` table in PostgreSQL
2. Register webhook in EmailBison → `https://[domain]/api/webhook/[slug]`
3. Create client file in `campaign-strategy/[slug].md`
4. Fill out client profile in `client-management/client-profiles.md`
5. Add follow-up templates in `reply-management/reply-process.md`
6. Add to the roster table above
