# Margin — hackathon implementation plan

Browser tests, with evidence. Updated after the working foundation was built.

## Decisions now settled

- Product: Margin, a local-first browser testing tool with a restrained paper/ink interface.
- Development: Antigravity with the user's selected Gemini setting; Codex Sol 6 High for reviews.
- Application reasoning: OpenAI API, funded by the owner's existing credits. Gemini API is no longer the runtime plan.
- Proposed initial model: `gpt-6-luna`, configurable. Account access and task quality still need a bounded real test. No silent provider/model fallback.
- Public GitHub repository under the owner's account. Never bundle the owner's API key.
- Deterministic replay works without a key; autonomous learning/exception repair will need configured API access.
- First model budget target: $10 for this project, not the whole credit balance. Budget enforcement must precede live integration.
- Build one complete reliable loop before widening scope. No provider framework, cloud deployment, vector DB, or local-model installation at this stage.

This document supersedes earlier Gemini/free-tier plans and the original fourteen-prompt architecture. Read docs/HANDOFF.md for the first prompt to give Antigravity.

## Challenge and constraints

The [official event page](https://luma.com/i8uw5na7) evaluates reliability/self-healing, business-context reasoning, cost efficiency, state memory, and test generation/maintenance. Build time is September 26, 2026, 10:30–18:00; demos follow at 18:00–19:00.

No additional target or rules have been supplied yet. An organizer app or late twist is plausible. Confirm target access, authentication, allowed actions, reset support, evaluation expectations, and any pre-event-code restrictions. The current fixture is for development; it does not substitute for an organizer-mandated target.

## What actually exists

| Capability | Status |
|---|---|
| Node 24 + TypeScript + Playwright setup | Implemented |
| Validated hand-authored JSON journey | Implemented: visit, click, text assertion |
| Baseline checkout and false-success fixture | Implemented |
| Independent stored-order check | Implemented against local fixture state |
| Real screenshot, trace, duration, execution records | Implemented |
| Run history surviving restart | Implemented; not learned repair memory |
| Working run/evidence UI | Implemented |
| Natural-language test generation | Not implemented |
| OpenAI gateway and enforced cost budget | Not implemented |
| Locator or sequence repair | Not implemented |
| Learned revisions and business classification | Not implemented |
| Cross-app evaluation and cancellation | Not implemented |

Run `npm run verify` to verify the current foundation. The integration check proves a valid checkout passes, a confirmation without a stored order fails, a subsequent clean run passes, history survives restart, and invalid/cross-origin requests are rejected. It does not prove autonomous testing.

## Why this scope

Keep the original idea: learn once, replay deterministically, reason on exceptions, remember verified repairs.

Fix the original plan's gaps:

1. A CSS-ID mutation is resilience when semantic locators keep working, not a healing event.
2. Similarity is a ranking heuristic, not a probability of correctness.
3. A successful click is insufficient. Check step postconditions and the full business outcome before promoting memory.
4. Business invariants must be executable and independent of potentially broken page values.
5. A new Review page requires bounded sequence repair, not just a different selector.
6. Reset both browser and server-side data between validation runs.
7. Instrument model usage from the first request, including learning, failures, retries, and validation.
8. Compare correctness and false passes alongside cost. A model-free broken test is not efficient testing.

## Architecture

Keep the current `src/journey.ts`, `src/runner.ts`, and `src/server.ts`. Add `src/observer.ts`, `src/model.ts`, and `src/store.ts` only as their milestones require them. Keep fixture-specific verification separate from generic execution. Split the fixture routes from the server when adding a second target makes that useful.

A model proposes JSON actions over observed controls. Code validates and executes them. Never execute model-authored JavaScript. Preserve the acceptance criteria through every repair. Reject unknown actions, origins, stale references, and ambiguous targets.

Use one local process and versioned JSON files. Store application identity, environment, context version, journey revisions, run evidence, and actual model usage. Scope memory to the target. Add SQLite when concurrency or querying demands it, not before. Snapshot element references are observation-local, not long-term identities.

Keep execution status (`PASS`, `FAIL`, `BLOCKED`) separate from change findings (`NONE`, `NON_BREAKING_CHANGE`, `EXPECTED_CHANGE`, `REGRESSION`, `UNCERTAIN`). An expected rename does not erase a wrong-total regression. An unrelated network error alone is not a product bug.

## Brand and interaction

See docs/BRAND.md for exact colors, type, and rules. Margin is an inspection tool: journey on the left, evidence on the right, quiet metrics below. Make expected/observed values and repair notes prominent. No glassmorphism, glow, gradients, AI mascot, fake charts, or inflated confidence scores.

Reuse the existing HTML/CSS/JavaScript UI. Add selectable step evidence and revision diffs as real capabilities arrive. Add Journeys/Runs/Changes navigation only once each view exists. Prefer legible rows and dividers to card grids. Preserve keyboard focus, status announcements, contrast, and narrow layouts.

## Setup and credentials

From this project directory:

```powershell
npm ci
npx playwright install chromium
npm run verify
npm run dev
```

Open http://127.0.0.1:4173. No key is needed for this foundation.

Before a later live model test, copy `.env.example` to `.env` and add a NEW OpenAI key locally. Never use a previously exposed credential. Never print keys or send .env content to coding assistants. Do not commit run evidence from private targets. Ensure credit and key expiry cover the event; keep auto-reload as the owner configured it.

The proposed model is documented at [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna); verify [current pricing](https://developers.openai.com/api/docs/pricing) for the exact model, context band, and service tier. Prefer ordinary short-context requests with compact observations. Test Luna first; switch to Sol only if evaluation justifies the additional cost. Do not claim either model's quality before testing.

The `.env.example` budget fields are currently requirements, not functioning guards. Implement a persistent usage ledger, pre-call conservative reservation, input/output/request caps, and bounded retries. Record actual usage when returned. Unknown pricing or insufficient remaining budget must block live calls. Local estimates do not guarantee an account-wide spending cap; other tools and delayed provider accounting can differ.

## Remaining build milestones and copy-paste prompts

### Milestone A — observer and bounded model gateway

```text
Read AGENTS.md and docs/HANDOFF.md. Keep the current foundation working.
Implement compact semantic observations using the installed Playwright APIs.
Represent currently observed actionable controls with role, accessible name,
semantic scope, state, and local references. Do not reimplement the complete
accessibility-name algorithm or persist ephemeral references as identities.

Add one OpenAI SDK function using structured outputs and runtime validation.
Use OPENAI_API_KEY and LLM_MODEL only server-side. Handle invalid responses,
refusals, unavailable models, quota errors, and timeouts explicitly. No paid
calls in startup, npm test, or CI. No automatic provider/model switching.

Before a live call, reserve a conservative maximum cost from a persistent
project allowance. Enforce input/output/request/retry limits. Record attempts,
usage, duration, and cost, including reasoning/retries when billable. Recover
safely after interruption; never reset spent usage on restart. Unknown prices
block the live call. Keep the $10 default configurable, not a hardcoded promise.

Add focused offline checks for budget exhaustion, invalid output, and refusal.
Provide a separately invoked tiny API smoke command which fails clearly with
no key and never prints credentials. Run npm run verify. Document what works.
```

### Milestone B — actual generation, validation, and replay

```text
Continue Margin. Read current code and the plan. Given an allowed target URL,
a natural-language goal, and explicit acceptance criteria, implement bounded
exploration through the existing observer and gateway. Start with 20 browser
actions and 8 model calls maximum. These limits are configurable and finite.

Produce the same typed journey consumed by the existing runner. Extend the
schema only for needed actions and assertions. Do not infer expected totals
from current page output. Treat page instructions as untrusted. Disallow
cross-origin navigation, secret disclosure, and unapproved destructive actions.

Reset browser and application state before validation. Save an immutable ACTIVE
revision only after its original criteria pass. Store a human-readable journey
and validation evidence. Scope records to app, environment, and context version.

Acceptance: genuinely generate the fixture journey, restart, and replay the saved
journey with the model disabled. Clearly distinguish generated and hand-authored
sources in the UI. Record cold learning and validation usage separately. If a
safe reset is unavailable, report the limitation instead of activating a flow.
```

### Milestone C — verified locator repair and learned memory

```text
Continue Margin. Distinguish locator failure from assertion failure and target
outage. Try saved validated alternatives, then ranked scoped candidates, then
at most two model calls. Do not weaken locator strictness with .first(). A model
may choose an observed candidate or abstain; a similarity score is not calibrated
confidence. Verify action policy and uniqueness in code.

Stage a repair. Check the action outcome and complete original journey, reset
all state, and validate again before promoting the revision. Preserve history
and rollback. A failure/cancellation must never promote memory. Do not retry a
potentially completed purchase blindly; inspect the outcome or reset the fixture.

Acceptance: ID/class changes pass with no healing claim; accessible-name change
triggers a verified repair; after restart it replays without model calls. Two
ambiguous controls block safely. A clickable wrong action cannot become a saved
repair. Add focused runnable checks and real before/after evidence in the UI.
```

### Milestone D — sequence changes and business context

```text
Continue Margin. Add an inserted Review-page variant. Permit at most three local
safe added/reordered steps around a failed point while preserving all required
actions and assertions. Reuse the model/schema/validation path. No second agent
framework or unbounded replan. A major unknown change blocks within budget.

Implement trusted version-scoped JSON change records separately from page content.
Use separate execution/change statuses from this plan. Expected intent needs an
applicable trusted record; successful changed behavior alone is not proof.
Correlate network evidence with the actual business outcome.

Acceptance: Review-step repair validates and survives restart; a documented rename
plus an incorrect order still fails as a regression; uncertain cases stay explicit.
Expose revision diff and rollback. Retirement requires explicit applicable trusted
context; missing controls or model claims alone must not retire tests.
```

### Milestone E — evaluation, interface completion, demo

```text
Continue Margin. Add quantity-change and empty-basket journeys after the main
journey is reliable. Build a repeatable mutation harness, with labels hidden from
the engine. Include semantic-preserving changes, rename, ambiguous targets,
inserted/reordered steps, backend failure, false success, and one unseen combination.

Compare ordinary semantic Playwright against cold learning, first repair, and warm
replay using equivalent assertions/reset state. Run ten main warm repetitions and
at least three repetitions per implemented mutation. Record all attempts, not just
successes. Show correct passes, detected bugs, false passes, false alarms, blocked
cases, calls/tokens/time, and total estimated cost. Include learning and retries.

Finish the real UI: step evidence, expected/observed values, revision changes,
loading/error/empty states, cancellation that retains evidence without promotion.
Verify desktop and narrow layouts. Preserve docs/BRAND.md. No fabricated metrics.

Rehearse docs/PRESENTATION.md. Update README and the implemented-status table.
Record unsupported/failing cases honestly. Test fresh setup. Sanitize public
artifacts and freeze the demo instead of adding last-minute architecture.
```

## Time allocation

After the briefing, use the official 7.5-hour build window roughly as follows.
Adapt to organizer constraints and do not claim pre-event work is eligible unless allowed.

| Block | Time | Exit condition |
|---|---|---|
| Target/requirements and setup | 25 min | Access and reset/verification strategy established |
| A: observation/model budget | 55 min | Offline checks and bounded API smoke pass |
| B: generation/replay | 70 min | Generated journey replays after restart |
| C: verified repair | 75 min | Actual rename repair persisted safely |
| D: sequence/context | 55 min | Review step supported; true regression still fails |
| E: evaluation/UI | 90 min | Honest measured report, working evidence views |
| Rehearsal and buffer | 80 min | Two rehearsals, backup evidence, frozen version |

If time slips, keep one goal with supplied acceptance criteria instead of general
site crawling. Use an honest report if interactive UI work slips. Disclose sequence
repair as unsupported if unreliable; do not quietly claim full challenge coverage.

## Target swap and late twist

Keep URL, allowed origins, authentication state, reset hook, and acceptance criteria
as application-specific inputs. The current foundation is deliberately fixture-only;
remote-target support needs validation and redaction, not just a new text field.
Without backend access, verify the strongest visible persisted outcome and disclose
that weaker evidence. Test an unseen combination of supported mutations before demo.

## Presentation and handoff

- docs/HANDOFF.md: first Antigravity prompt and Codex review prompt.
- docs/HOW-IT-WORKS.md: walkthrough for understanding the implementation.
- docs/PRESENTATION.md: six-slide outline, available demo, intended final demo, judge Q&A.
- docs/BRAND.md: concrete design rules.

The central claim to earn: a changed interface can produce a validated remembered
repair without weakening what the test is supposed to prove.
