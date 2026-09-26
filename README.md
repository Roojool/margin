# Margin

**Browser tests, with evidence.**

A local-first browser-testing project for the [FlytBase Tireless Hand hackathon](https://luma.com/i8uw5na7).

Public repository: [Roojool/margin](https://github.com/Roojool/margin).

The project learns a fixture journey, replays it deterministically, and remembers validated locator repairs. Sequence repair and broader evaluation remain to be built.

## Start

Node 24 LTS and Git are required. From this directory:

```powershell
npm ci
npx playwright install chromium
npm run verify
npm run dev
```

Open **http://127.0.0.1:4173**. Choose **Working checkout**, then **Run journey**. Next choose **Success screen, missing order** and run again. The second run must fail even though the browser shows a confirmation.

Replay and offline checks need no account, API key, or paid service. Generating a journey through the UI needs a configured OpenAI key. The server only listens on loopback. Keep the terminal running; Ctrl+C stops it.

## What works today

- A typed hand-authored JSON journey, interpreted by real Playwright actions.
- A local store fixture with clean state per run and a seeded false-success defect.
- Quantity/total UI assertions and an independent check of the server's stored order.
- Persisted execution records, a final screenshot, and a Playwright trace.
- A working evidence interface with run history, errors, measured duration, and model-call count.
- Compact semantic observation extracting role, accessible name, semantic scope, state, and ephemeral references using Playwright's accessibility snapshot.
- An OpenAI gateway with structured outputs, schema validation, pre-call budget reservation, and bounded requests/output/retries.
- A persistent local usage ledger recording token usage and cost. Unresolved requests keep a budget hold across restarts.
- Standalone API smoke command (`npm run smoke:api`) failing clearly without a key and never running during tests, CI, or server startup.
- Bounded fixture checkout generation (`src/generator.ts`) using semantic observations, with at most 20 actions and 8 model calls. The public UI uses the fixture's fixed goal and criteria.
- Mandatory browser and application state reset before validation; reports limitation if safe reset is unavailable.
- Deterministic validation replay with model disabled (0 model calls) and outcome verification.
- Versioned memory store (`src/store.ts`) preserving activated journey files and scoping active replay to app, environment, and context version.
- Distinct tracking and UI presentation of cold learning usage vs deterministic warm replay.
- UI source distinction (hand-authored vs generated) tested on Chromium across desktop and narrow layouts.
- Error discrimination distinguishing target outage (BLOCKED), text assertion failure (FAIL), and locator failure without blurring categories.
- 3-tier locator repair (`src/repair.ts`): (1) saved validated alternatives scoped to the active revision, (2) ranked observed candidates approved for the failed step, and (3) model selection with at most two requests and no retries. Similarity only orders candidates; it is not confidence.
- Ambiguity rejection enforcing strict mode across all locator operations without hiding ambiguity via `.first()`.
- Code enforcement of origin restrictions, exact per-step action approval, and unique-target checks (`count === 1`).
- Purchase guard preventing blind repeated clicks on completed purchase/order steps.
- Staged candidate repair validation: checks immediate action outcome, executes remaining steps, resets application and browser state, and performs clean replay with model disabled before memory promotion.
- Persisted validated alternatives and active journey revisions in memory store surviving restarts and replaying with 0 model calls.
- Repair attempt card in the UI displaying original target, proposed target, tier, and activation or rejection status. Successful repair steps and screenshot come from the clean validation replay.
- Offline checks for execution, gateway, observation, generator limits, assertion preservation, store persistence, and locator repair without live API calls.

## Still to build

Sequence repair around insertion/reordering and business context (Milestone D), repeatable mutation evaluation harness and interface completion (Milestone E).

The fixture stores its orders in process memory, independently of the browser. It is a test oracle, not a production database. Run records survive restart; fixture orders deliberately do not. Screenshots show the final page; per-step capture is a later addition.

## Files

```text
src/journey.ts         Validated JSON action contract
src/runner.ts          Browser execution, outcome hook, evidence, error discrimination
src/repair.ts          3-tier verified locator repair and candidate staging validator
src/observer.ts        Compact semantic observation from Playwright accessibility snapshot
src/gateway.ts         OpenAI gateway, pre-call budget guard, persistent usage accounting
src/model.ts           Standard server-side model invocation interface
src/generator.ts       Bounded autonomous test generator and validation runner
src/store.ts           Versioned journey revisions and memory persistence
src/smoke.ts           Tiny standalone API smoke check
src/server.ts          Local HTTP interface, fixture state, run history
src/main.ts            Entry point
fixture/              Store page and baseline journey
ui/                   Product UI; plain HTML/CSS/JavaScript
tests/                Offline integration, observer, gateway, generator, UI, and repair checks
docs/HANDOFF.md        Milestone handoff and review prompts
docs/BRAND.md          Design direction and interaction rules
docs/HOW-IT-WORKS.md   Plain-language walkthrough and architecture
docs/PRESENTATION.md   Pitch, demo, judging evidence, fallback
HACKATHON-PLAN.md      Build plan and remaining milestone prompts
```

`runs/` is generated locally and git-ignored. Trace downloads can be opened with `npx playwright show-trace <path-to-trace.zip>`. The UI escapes output using text nodes and serves only known artifact names, not arbitrary filesystem paths.

## OpenAI setup

Copy `.env.example` to `.env`, then insert a **new** API key locally. Never paste it in a chat or commit it. Rotate any previously exposed key. Antigravity and Codex access do not provide the application's runtime API quota.

The configured starting model is `gpt-6-luna`; use `gpt-6-sol` only if measured repair quality requires it. References: [model](https://developers.openai.com/api/docs/models/gpt-6-luna), [pricing](https://developers.openai.com/api/docs/pricing). Unknown models block live calls to prevent unmetered spending.

The project allowance is configurable (default $10, `PROJECT_BUDGET_USD`), with bounded input/output, per-call retries, and a persistent local usage ledger. No automatic paid-provider fallback. Once that allowance is exhausted, AI work is blocked while deterministic replay remains available. The UI can generate the fixture checkout after a key is configured; hand-authored and saved generated journeys replay offline. Interrupted or usage-unknown requests retain a budget hold until manually reconciled. A local estimate is an application safety guard, not a provider-side billing cap. Live connectivity has not been verified here; test it with `npm run smoke:api` after configuring a new key.

## Limits

One local user, one browser run at a time, one loopback fixture target. Custom goals and criteria need their own independent verifier and action policy. No remote authentication,
payments, deployment, universal site crawling, or production security guarantee.
An unfamiliar app needs its own acceptance criteria and safe reset/verification setup.

## Automated checks

`npm run verify` runs locally without API access. A GitHub Actions template is
saved at `docs/ci-workflow.yml`. It is **not active**: the current GitHub login
lacks permission to upload workflow files. To enable CI later, use a login with
workflow-write permission and move that file to `.github/workflows/check.yml`.

## License

MIT. Built independently for the event; no organizer endorsement implied.
