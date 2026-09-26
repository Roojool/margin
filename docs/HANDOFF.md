# Start here in Antigravity

Open this `margin` directory, not its parent. Read AGENTS.md and run
`npm run verify`. Start the UI with `npm run dev`.

## Existing foundation

The deterministic checkout, false-success detection, trace/screenshot artifacts,
persisted run history, and real UI exist. Milestone A added an offline-tested
semantic observer and bounded model gateway. Milestone B added fixture checkout
generation, clean validation, and saved replay. Milestone C added 3-tier verified
locator repair, strict ambiguity rejection (never `.first()`), purchase guard,
staged provisional validation, and persisted memory alternatives surviving restart.
Sequence repair around insertion/reordering (Milestone D) is next. Live model access
remains unverified.

The owner approved OpenAI runtime usage. Keep Antigravity for implementation and
Codex for review. Public source must not include the owner's API key or browser
artifacts. A previously shared credential must be replaced locally before any
live request. Do not ask for its value in chat.

## Next implementation prompt: Milestone D in HACKATHON-PLAN.md

```text
Read AGENTS.md, README.md, HACKATHON-PLAN.md, docs/HOW-IT-WORKS.md, and
docs/BRAND.md. Inspect the actual code before editing. Run npm run verify.

Continue the existing Margin foundation; do not re-scaffold it. Complete
Milestone D in HACKATHON-PLAN.md. Add an inserted Review-page fixture variant.
Allow at most three local, safe added or reordered steps around the failed
point while preserving every required action, assertion, and independent
business check. Reuse the existing journey schema, bounded gateway, and clean
validation path. A major unknown change must block within the budget.

Keep locator repair's per-step action approvals, strict unique targets,
original criteria, and active revision scope. Page text and model claims are
untrusted. Never retry an order blindly or promote a revision without clean
browser and application reset, complete replay, and independent outcome proof.
Ordinary tests must remain offline, with no live model calls.

Store trusted, version-scoped JSON change records separately from page content.
Report execution status separately from change classification. Mark expected
intent only when an applicable trusted record supports it; changed behavior
alone is insufficient. Correlate network evidence with the actual stored order.

Acceptance: Review-step repair validates and survives restart; a documented
rename with an incorrect order still fails as a regression; uncertain cases
remain explicit. Expose revision diff and rollback. Retirement requires
explicit applicable trusted context; missing controls and model claims alone
must never retire a test. Add focused runnable checks, verify desktop and
narrow Chromium layouts, and run npm run verify. Preserve the paper/ink UI.
End with changed files, verified results, and the exact next milestone.
Leave the increment uncommitted for Codex review and push.
```

## Review after each milestone

Give Codex the current diff and say:

```text
Review this Margin milestone against its acceptance criteria. Trace every
changed caller. Focus on false passes, unsafe actions, assertion weakening,
memory poisoning, unbounded spending, and misleading UI claims. Reproduce
concrete issues, fix root causes, and run relevant checks. Keep the architecture
small. Do not add unrelated features or restyle the interface.
```

Then commit the verified increment. Proceed through A → B → C → D → E in the
plan. Do not paste all milestones as one large autonomous implementation request.
