# Margin

**Browser tests, with evidence.**

A local-first browser-testing project for the [FlytBase Tireless Hand hackathon](https://luma.com/i8uw5na7).

Public repository: [Roojool/margin](https://github.com/Roojool/margin).

The intended product learns a journey, replays it cheaply, and remembers validated repairs. **This repository currently contains the deterministic foundation, not the completed autonomous agent.**

## Start

Node 24 LTS and Git are required. From this directory:

```powershell
npm ci
npx playwright install chromium
npm run verify
npm run dev
```

Open **http://127.0.0.1:4173**. Choose **Working checkout**, then **Run checkout**. Next choose **Success screen, missing order** and run again. The second run must fail even though the browser shows a confirmation.

No account, API key, or paid service is needed for this foundation. The server only listens on loopback. Keep the terminal running; Ctrl+C stops it.

## What works today

- A typed hand-authored JSON journey, interpreted by real Playwright actions.
- A local store fixture with clean state per run and a seeded false-success defect.
- Quantity/total UI assertions and an independent check of the server's stored order.
- Persisted execution records, a final screenshot, and a Playwright trace.
- A working evidence interface with run history, errors, measured duration, and model-call count.
- Compact semantic observation extracting role, accessible name, semantic scope, state, and ephemeral references using Playwright's accessibility snapshot.
- An OpenAI gateway with structured outputs, schema validation, a pre-call reservation for all allowed attempts, and bounded input/output/retries.
- A persistent local usage ledger recording returned token usage and estimated cost. Unresolved requests keep a budget hold across restarts.
- A standalone API smoke command (`npm run smoke:api`) that fails clearly without a key and never runs during tests, CI, or server startup.
- Focused offline checks for checkout execution, observer parsing, budget exhaustion, model refusal, schema invalidation, and ledger persistence.

## Still to build

Natural-language test generation and replay (Milestone B), validated locator repair and learned memory (Milestone C),
sequence repair and business context (Milestone D), repeatable mutation evaluation harness and interface completion (Milestone E).

The fixture stores its orders in process memory, independently of the browser. It is a test oracle, not a production database. Run records survive restart; fixture orders deliberately do not. Screenshots show the final page; per-step capture is a later addition.

## Files

```text
src/journey.ts         Validated JSON action contract
src/runner.ts          Browser execution, outcome hook, evidence
src/observer.ts        Compact semantic observation from Playwright accessibility snapshot
src/gateway.ts         OpenAI gateway, pre-call budget guard, persistent usage accounting
src/model.ts           Standard server-side model invocation interface
src/smoke.ts           Tiny standalone API smoke check
src/server.ts          Local HTTP interface, fixture state, run history
src/main.ts            Entry point
fixture/              Store page and baseline journey
ui/                   Product UI; plain HTML/CSS/JavaScript
tests/                Offline integration, observer, and gateway unit checks
docs/HANDOFF.md        Milestone A handoff and review prompt
docs/BRAND.md          Design direction and interaction rules
docs/HOW-IT-WORKS.md   Plain-language walkthrough and architecture
docs/PRESENTATION.md   Pitch, demo, judging evidence, fallback
HACKATHON-PLAN.md      Build plan and remaining milestone prompts
```

`runs/` is generated locally and git-ignored. Trace downloads can be opened with `npx playwright show-trace <path-to-trace.zip>`. The UI escapes output using text nodes and serves only known artifact names, not arbitrary filesystem paths.

## OpenAI setup

Copy `.env.example` to `.env`, then insert a **new** API key locally. Never paste it in a chat or commit it. Rotate any previously exposed key. Antigravity and Codex access do not provide the application's runtime API quota.

The configured starting model is `gpt-6-luna`; use `gpt-6-sol` only if measured repair quality requires it. References: [model](https://developers.openai.com/api/docs/models/gpt-6-luna), [pricing](https://developers.openai.com/api/docs/pricing). Unknown models block live calls to prevent unmetered spending.

The project allowance is configurable (default $10, `PROJECT_BUDGET_USD`), with bounded input/output, per-call retries, and a persistent local usage ledger. No automatic paid-provider fallback. Once that allowance is exhausted, AI work is blocked while deterministic replay remains available. The gateway runs only when explicitly called; the UI still uses the hand-authored journey. Interrupted or usage-unknown requests retain a budget hold until manually reconciled. A local estimate is an application safety guard, not a provider-side billing cap. Live connectivity has not been verified here; test it with `npm run smoke:api` after configuring a new key.

## Limits

One local user, one browser run at a time, one controlled target. No remote authentication,
payments, deployment, universal site crawling, or production security guarantee.
An unfamiliar app needs its own acceptance criteria and safe reset/verification setup.

## Automated checks

`npm run verify` runs locally without API access. A GitHub Actions template is
saved at `docs/ci-workflow.yml`. It is **not active**: the current GitHub login
lacks permission to upload workflow files. To enable CI later, use a login with
workflow-write permission and move that file to `.github/workflows/check.yml`.

## License

MIT. Built independently for the event; no organizer endorsement implied.
