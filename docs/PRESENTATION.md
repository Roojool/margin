# Presentation and live demonstration plan

This is a presentation outline, not a generated slide deck. Replace every
measurement placeholder with a result from the evaluation harness. Do not
present planned capabilities as shipped features.

## The pitch

“Margin keeps a browser test useful when the interface changes, while keeping
the original business outcome accountable.”

The interesting claim is not that a model can click. It is that a validated
repair can be remembered, and that the system still catches a broken outcome.

## Six slides / approximately five minutes

| Slide | Time | Visual | What to say |
|---|---|---|---|
| 1. The tenth run | 30s | A journey with one changed control | A successful first run is easy to overvalue. Interfaces change; costs repeat. |
| 2. Keep the contract | 40s | Goal → learned journey → local replay → verified repair | The execution path can change; the business assertion must survive. |
| 3. Watch it change | 100s | Live Margin screen; no slide decoration | Run, mutate, repair, restart, reuse. Show before/after evidence. |
| 4. A green screen can lie | 45s | Success screenshot beside failed order assertion | A confirmed-looking screen did not create an order. Margin must fail it. |
| 5. What we measured | 45s | Small comparison table | Cold learning, first repair, warm replay: correctness, calls, tokens, time. |
| 6. Scope and next step | 30s | Three limits and one next experiment | Explain supported changes, blocked cases, and a held-out target test. |

Use Margin's paper/ink palette, large clear titles, and one meaningful visual per
slide. Show screenshots at readable size. No robot illustrations, futuristic
backgrounds, fabricated percentages, or market-size filler.

## Demo available right now: 60–90 seconds

1. Run `npm run dev`; open http://127.0.0.1:4173.
2. Select Working checkout; Run checkout. Inspect six successful checks.
3. Select Success screen, missing order; Run checkout.
4. Show that the confirmation check passed but stored-order verification failed.
5. Open the trace or screenshot. Explain the independent assertion.
6. State explicitly: “This foundation is hand-authored; learning and repair are the next milestones.”

## Final intended demo: four minutes, only after implementation

1. Start from clearly identified clean learning state. Give a new goal and acceptance criteria.
2. Generate and validate the journey; expose actual model usage.
3. Replay without a model and show the same assertions passing.
4. Rename the accessible control, repair, validate, and show the revision diff.
5. Restart and rerun to prove learned memory reuse.
6. Insert a Review step and show the bounded sequence repair, if implemented reliably.
7. Introduce a wrong/missing order. Show a real failure despite the success screen.
8. Finish with the measured comparison. Unimplemented cases stay out of the live claim.

Do not change only a CSS ID and call it AI healing: semantic locators should
already survive that. Do not call a recorded video live execution. A saved
learning run is fine if clearly disclosed as prior evidence.

## Evaluation table to fill

| Mode | Correct passes / valid runs | Bugs detected / seeded bugs | False passes | Blocked | Model calls | Tokens | Wall time | Estimated API cost |
|---|---|---|---|---|---|---|---|---|
| Semantic Playwright baseline | pending | pending | pending | pending | 0 | 0 | pending | $0 model use |
| Margin cold learning | pending | pending | pending | pending | pending | pending | pending | pending |
| Margin first repair | pending | pending | pending | pending | pending | pending | pending | pending |
| Margin warm replay | pending | pending | pending | pending | pending | pending | pending | pending |

Include learning, validation, failures, and retries in totals. Show denominators
and repetitions. Ten warm reruns and three per mutation are useful demonstrations,
not a statistically established reliability guarantee. Hold out one mutation
combination. Never compare costs against an unmeasured hypothetical agent.

## Likely judge questions

- **Is this just Playwright?** Playwright is the execution engine. The intended contribution is learning, verified repair, remembered revisions, and measured reasoning cost. Demonstrate the implemented difference.
- **Can it hide a regression?** Show the false-success case and checks preventing assertion weakening and unsafe revision promotion.
- **How does it know a change was intended?** Trusted release context plus outcome evidence; otherwise non-breaking difference or uncertainty.
- **What if the API stops working?** Existing deterministic replay remains available. A required AI step blocks honestly.
- **Does this generalize?** Describe exactly what was tested on the fixture and any organizer target. Do not claim universal support.
- **Why not fully local AI?** The hackathon prioritizes a trustworthy testing loop. Model hosting is replaceable later; implementing multiple providers now would dilute that work.

## Before presenting

Rehearse twice, freeze working versions, confirm key/credit expiry, and keep the
local server ready. Keep auto-reload off if that is the owner's preference. Have
a clearly labelled recording and sanitized saved report in case of network
failure. Never display API keys, .env files, account billing pages, or private
target data on slides or in a public recording.
