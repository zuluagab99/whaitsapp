# Dashboard Design System

## Philosophy

**Simple but transparent.** Every screen should answer "what is actually happening?" — not abstract it away. Show real model IDs, queue names, counts, and errors. No spinners that never resolve, no vague "processing" states.

The dashboard is for technical merchants and operators who want control. Treat them like adults.

---

## Colour palette

All colours via CSS custom properties defined in `app/globals.css`.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#ffffff` | Page/panel backgrounds |
| `--surface` | `#f8fafc` | Sidebar, cards, input fields |
| `--border` | `#e2e8f0` | Dividers, card outlines, input borders |
| `--text` | `#0f172a` | Primary text, headings |
| `--text-2` | `#64748b` | Secondary labels, descriptions |
| `--text-3` | `#94a3b8` | Placeholder, timestamps, muted hints |
| `--accent` | `#0f172a` | CTA buttons, active nav item background |
| `--green` | `#10b981` | Active, online, success |
| `--amber` | `#f59e0b` | Warning, degraded, paused |
| `--red` | `#ef4444` | Error, blocked, deleted |
| `--blue` | `#3b82f6` | Informational, links |

Status dots: 8px circle, colour = one of green/amber/red/text-3.

---

## Typography

Single font stack: `system-ui, -apple-system, sans-serif`.  
Technical values (model IDs, queue names, IDs, timestamps): `font-family: monospace`.

| Role | Size | Weight |
|---|---|---|
| Page title | 1.25rem | 700 |
| Section heading | 0.95rem | 700 |
| Body | 0.9rem | 400 |
| Label / eyebrow | 0.75rem | 600, uppercase, letter-spacing 0.06em |
| Caption / muted | 0.8rem | 400 |
| Mono value | 0.8rem | 400, monospace |

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│  Sidebar (200px fixed)  │  Content (flex 1, scroll)  │
│  ─────────────────────  │  ─────────────────────────  │
│  Brand                  │  <page content>             │
│  Nav items              │                             │
│  ─────────────────────  │                             │
│  (bottom) status hint   │                             │
└─────────────────────────────────────────────────────┘
```

- Sidebar: `200px`, fixed height, white background, right border.
- Content: `flex: 1`, `overflow-y: auto`, `padding: 2rem 2.5rem`.
- Max content width: `860px` (centre it on wide screens if needed — not yet required).
- The **Workflow Builder** is full-screen (`position: fixed; inset: 0; z-index: 50`) — it intentionally hides the sidebar.

---

## Navigation

```
🏠  Dashboard
💬  Conversations    (phase 2 — show greyed, not hidden)
⚡  Workflows
🧠  Brain
```

Active item: `background #0f172a, color #fff, border-radius 8px`.  
Inactive item: `color var(--text-2)`, hover `background var(--surface)`.  
Coming-soon items: `opacity 0.45`, `cursor not-allowed`, no link.

Never hide planned features — show them greyed so the operator can see the roadmap at a glance.

---

## Components

### Cards

```
border: 1px solid var(--border)
border-radius: 12px
padding: 1.25rem
background: var(--bg)
```

Card header: eyebrow label (uppercase, --text-3) above the main value.  
Card body: main metric or list.  
Cards do not have shadows — borders only.

### Buttons

| Variant | Style |
|---|---|
| Primary | `bg var(--accent), color #fff, border: none` |
| Secondary | `bg transparent, border 1px solid var(--border), color var(--text)` |
| Danger | `bg transparent, border 1px solid #fca5a5, color var(--red)` |
| Ghost | `bg transparent, border none, color var(--text-2)` |

All buttons: `border-radius: 8px, padding: 0.5rem 1rem, font-size: 0.875rem, cursor: pointer`.

### Form fields

`border: 1px solid var(--border), border-radius: 8px, padding: 0.5rem 0.75rem, font-size: 0.9rem, outline: none`.  
Focus: `border-color: var(--accent)`.

### Status badge

`border-radius: 6px, padding: 2px 8px, font-size: 0.75rem`.  
- Active: `bg #dcfce7, color #166534`
- Paused: `bg #fef9c3, color #854d0e`
- Error: `bg #fee2e2, color #991b1b`
- Unknown: `bg var(--surface), color var(--text-3)`

---

## Terminology

| Avoid | Use instead | Reason |
|---|---|---|
| AI model / LLM | **Brain** | Friendly, memorable, opaque detail hidden behind the name |
| conversation model | **Brain (thinking)** | The tier that handles customer replies |
| routing model | **Brain (routing)** | The cheap-fast tier for internal classification |
| Provider | Anthropic / OpenAI | Be specific, not generic |
| Error | Show the actual error message | Merchants need to act on errors |

**Brain page** should show: provider name, exact model ID (monospace), tier label, and what it does in one sentence. No marketing copy.

---

## "Under the hood" principle

Every data-heavy page must have a "System" or "Under the hood" section that shows the raw plumbing:
- Actual model IDs (not just "fast model")  
- Queue names and counts  
- DB connection status  
- API versions (Meta Graph API, Shopify API)  

This is not a debug page — it's normal operating information for operators who need to know what's actually running.

---

## Writing style

- Short sentences. No marketing language.
- Labels describe the data, not the action. **"Active workflows"** not **"Your active automations"**.
- Error messages say what went wrong and what to do. **"ADMIN_API_TOKEN not set — add it to .env"** not **"Configuration error"**.
- Coming-soon states explain why, not just "coming soon". **"Conversations — live viewer and human takeover (Phase 2)"**.
