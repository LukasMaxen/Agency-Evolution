# Agency Evolution — Client Roster

All 15 active workspaces. For full per-client profiles (offer, target audience, Calendly link, reply tone, objections) see `skills/AllClient_Skill.md`.

## Active Workspaces

| # | Client | Workspace Slug | Vertical |
|---|---|---|---|
| 1 | Larsen Digital | `larsen-digital` | [See SKILL.md] |
| 2 | ACT Capital | `act-capital` | Capital / PE |
| 3 | Acceler8rs | `acceler8rs` | Acquisition / Entrepreneurship |
| 4 | Hahnbeck | `hahnbeck` | [See SKILL.md] |
| 5 | 911 Restoration | `911-restoration` | Franchise / Restoration |
| 6 | Micro Nordic | `micro-nordic` | [See SKILL.md] |
| 7 | GN Motion | `gn-motion` | [See SKILL.md] |
| 8 | Statera Capital | `statera-capital` | Capital / Advisory |
| 9 | Venture Exits | `venture-exits` | Business Exits / M&A |
| 10 | Wrobel Capital | `wrobel-capital` | Capital / PE |
| 11 | Zenith Global | `zenith-global` | [See SKILL.md] |
| 12 | ITG Group | `itg-group` | [See SKILL.md] |
| 13 | Sonaro AI | `sonaro-ai` | AI / Technology |
| 14 | Zebs IBS | `zebs-ibs` | [See SKILL.md] |
| 15 | SRO Consulting | `sro-consulting` | Consulting |

## Shared Infrastructure

- All workspaces run on a single EmailBison instance: `https://send.emailagencyevolution.com`
- Each workspace has its own `email_bison_api_key` and `email_bison_instance_url` stored in the `workspaces` DB table
- Webhook endpoint per workspace: `POST /api/webhook/[slug]`

## Onboarding a New Client

1. Add row to `workspaces` table in PostgreSQL
2. Register webhook in EmailBison → `https://[domain]/api/webhook/[slug]`
3. Fill out client profile in `skills/AllClient_Skill.md`
4. Add follow-up templates in `skills/REPLIES_Skill.md`
