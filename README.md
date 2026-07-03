# Whaitsapp — Multi-Tenant AI Chatbot SaaS for WhatsApp + Shopify

A production-grade SaaS platform where any Shopify merchant can connect their store + WhatsApp
number and get an AI agent that sells, supports, recovers abandoned carts, and tracks orders — 24/7.

**Architecture:** modular monolith (API + worker) with strict internal package boundaries, per the
[technical build plan](#roadmap-status). Postgres (shared schema + RLS) · Redis/BullMQ · Fastify ·
Next.js · provider-agnostic LLM router (Anthropic/OpenAI).

## Repository layout

```
apps/
  api/         Fastify core — webhook ingestion (Meta + Shopify) + admin API (LLM config, workflows)
  worker/      BullMQ processors — AI agent loop, workflows, outbound sends, cart recovery, catalog sync
  dashboard/   Next.js merchant dashboard — workflow builder + LLM model picker
packages/
  shared/      config, logger, crypto (AES-256-GCM secrets), queue contracts
  db/          Drizzle schema, migrations, RLS policies, idempotency ledger
  channels/    ChannelProvider abstraction + Meta WhatsApp Cloud API impl, 24h-window policy
  commerce/    Shopify client (OAuth, HMAC, GraphQL), webhook topics, cart-recovery logic
  ai/          LLM router (Anthropic/OpenAI), model catalog, agent loop, tools, guardrails, prompts
  workflows/   merchant automation engine — triggers (message keywords, order events) + actions
```

## Merchant-facing configuration

- **Switch the LLM without a redeploy:** each tenant picks its models from a validated catalog
  (`MODEL_CATALOG` in `@whaitsapp/ai`) via the dashboard **AI model** page (or
  `PUT /admin/tenants/:id/llm`). Stored in `tenants.settings.llm`, resolved per message by
  `resolveRouterConfig()`; invalid settings fall back to platform defaults so a bad row never
  takes a bot down.
- **Automated workflows:** merchants define *trigger → actions* rules on the dashboard
  **Workflows** page (or `/admin/tenants/:id/workflows`). Triggers: inbound message (optional
  keyword match, any/all), order created, order fulfilled. Actions: send a templated message
  (`{{order_number}}`-style variables), AI reply with extra instructions, hand off to a human.
  First enabled match wins (ordered by creation); definitions are zod-validated at the API
  boundary and re-validated in the worker. Order sends still pass `checkSendPolicy()` — workflows
  can never bypass the 24h window or opt-in rules.
- The admin API is guarded by `ADMIN_API_TOKEN` (routes are unregistered when unset). The
  dashboard proxies through a server-side route so the token and tenant binding
  (`DASHBOARD_TENANT_ID`) never reach the browser.

## Getting started

```sh
corepack enable                 # pnpm
pnpm install
docker compose up -d            # Postgres (pgvector) + Redis
cp .env.example .env            # fill in secrets
pnpm db:generate && pnpm db:migrate

pnpm dev:api                    # webhook ingestion on :3001
pnpm dev:worker                 # queue processors
pnpm dev:dashboard              # merchant UI on :3000
```

Run checks:

```sh
pnpm typecheck
pnpm test                       # unit tests; set TEST_DATABASE_URL to also run RLS isolation tests
```

## Design invariants (enforced in code)

- **Tenant isolation:** every tenant-owned table has Postgres RLS (`FORCE ROW LEVEL SECURITY`);
  all queries run through `tenantTransaction()` which sets `app.tenant_id`. Webhook routing
  lookups use an explicit SELECT-only `routingTransaction()`. Cross-tenant isolation tests live
  in `packages/db/test/rls.test.ts` and run in CI against real Postgres.
- **Webhooks:** signature/HMAC verified against the raw body, reject early; ack < 1s and process
  async via BullMQ; idempotency via the `processed_events` ledger inside the same transaction as
  side effects, plus queue-level `jobId` dedupe.
- **24-hour window:** every outbound send passes `checkSendPolicy()` — freeform only inside the
  window, marketing templates only with recorded opt-in (Meta policy + Habeas Data/GDPR).
- **LLM facts discipline:** prices/stock/discounts only from tool results; `checkReplyGuardrails()`
  flags numeric claims not present in tool output. Order lookups are verified against the
  conversation's phone number. `handoff_to_human` pauses the bot.
- **Secrets:** Shopify tokens and WABA credentials are AES-256-GCM encrypted at the application
  layer; never plaintext in the DB.

## Roadmap status

- ✅ **Phase 0 — Foundations:** monorepo, CI, tenant model + RLS + isolation tests, crypto, config
- ✅ **Phase 1 — Messaging spine (core):** Meta webhook ingestion, ChannelProvider, outbound with
  window enforcement, conversation/message persistence
- 🟨 **Phase 2 — AI agent:** agent loop + tools + guardrails + prompt builder done; RAG (pgvector
  retrieval), human-takeover UI, live message stream pending
- 🟨 **Phase 3 — Shopify commerce:** OAuth client, webhook handlers, catalog sync, order status
  with phone verification done; embedded app UI, draft-order checkout links, GDPR fulfilment pending
- 🟨 **Phase 4 — Abandoned carts:** detection pipeline, delayed recovery jobs, attribution done;
  Embedded Signup, template manager, analytics pending
- ⬜ **Phase 5 — Commercialize:** Stripe billing, plan enforcement, load testing

External dependencies to start now (longest lead times): Meta Business verification + Tech Provider
application; Shopify Partner account + dev store.
