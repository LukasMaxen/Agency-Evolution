# Agency Evolution — Client Roster

This file contains per-client context for all 15 active workspaces managed by Agency Evolution.
Claude should read this before any task involving reply generation, follow-up templates,
AI prompt tuning, or client-specific logic.

All workspaces share the same EmailBison instance: `https://send.emailagencyevolution.com`

---

## Client Index

| # | Client Name | Workspace Slug | Status |
|---|---|---|---|
| 1 | Larsen Digital | `larsen-digital` | Active |
| 2 | ACT Capital | `act-capital` | Active |
| 3 | Acceler8rs | `acceler8rs` | Active |
| 4 | Hahnbeck | `hahnbeck` | Active |
| 5 | 911 Restoration | `911-restoration` | Active |
| 6 | Micro Nordic | `micro-nordic` | Active |
| 7 | GN Motion | `gn-motion` | Active |
| 8 | Statera Capital | `statera-capital` | Active |
| 9 | Venture Exits | `venture-exits` | Active |
| 10 | Wrobel Capital | `wrobel-capital` | Active |
| 11 | Zenith Global | `zenith-global` | Active |
| 12 | ITG Group | `itg-group` | Active |
| 13 | Sonaro AI | `sonaro-ai` | Active |
| 14 | Zebs IBS | `zebs-ibs` | Active |
| 15 | SRO Consulting | `sro-consulting` | Active |

---

## Client Profiles

### 1. Larsen Digital
- **Slug:** `larsen-digital`
- **Offer:** [What are they selling / what service/deal are they outreaching for?]
- **Target audience:** [Who are they emailing? Industry, role, geography, company size?]
- **Calendly link:** [Insert link]
- **Reply tone:** [e.g. Formal, concise, professional / Conversational and warm / Short and direct]
- **Interested signal:** [What does an interested reply look like for this client?]
- **Not interested signal:** [What disqualifies a lead? e.g. deal size too small, wrong geography]
- **Notes:** [Any quirks, objections they commonly get, things to never say, specific terminology to use]

---

### 2. ACT Capital
- **Slug:** `act-capital`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 3. Acceler8rs
- **Slug:** `acceler8rs`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 4. Hahnbeck
- **Slug:** `hahnbeck`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 5. 911 Restoration
- **Slug:** `911-restoration`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 6. Micro Nordic
- **Slug:** `micro-nordic`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 7. GN Motion
- **Slug:** `gn-motion`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 8. Statera Capital
- **Slug:** `statera-capital`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 9. Venture Exits
- **Slug:** `venture-exits`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 10. Wrobel Capital
- **Slug:** `wrobel-capital`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 11. Zenith Global
- **Slug:** `zenith-global`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 12. ITG Group
- **Slug:** `itg-group`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 13. Sonaro AI
- **Slug:** `sonaro-ai`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 14. Zebs IBS
- **Slug:** `zebs-ibs`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

### 15. SRO Consulting
- **Slug:** `sro-consulting`
- **Offer:**
- **Target audience:**
- **Calendly link:**
- **Reply tone:**
- **Interested signal:**
- **Not interested signal:**
- **Notes:**

---

## Global Reply Guidelines

Rules that apply across all clients unless a client profile says otherwise:

- Always use the lead's first name
- Keep replies short — 3 to 5 sentences max
- Never mention competitors or make price promises
- If a lead gives a specific time/date, treat as `interested_urgent` and confirm immediately
- If a lead asks to be removed, mark `unsubscribe` — do not follow up
- Follow-up cadence: every 7 days unless client profile specifies otherwise

---

## Adding a New Client

When onboarding a new workspace:
1. Add a row to the Client Index table above
2. Copy a client profile block and fill in all fields
3. Add the workspace to the DB: `INSERT INTO workspaces (id, slug, name, email_bison_api_key, email_bison_instance_url) VALUES (...)`
4. Register the webhook in EmailBison pointing to: `https://[your-domain]/api/webhook/[slug]`