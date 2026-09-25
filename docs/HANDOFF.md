# Start here in Antigravity

Open this `margin` directory, not its parent. Read AGENTS.md and run
`npm run verify`. Start the UI with `npm run dev`.

## Existing foundation

The deterministic checkout, false-success detection, trace/screenshot artifacts,
persisted run history, and real UI exist. Milestone A added an offline-tested
semantic observer and bounded model gateway. The baseline journey is hand-authored.
No AI generation, healing, repair memory, cancellation, or external target support
is implemented yet. Live model access remains unverified.

The owner approved OpenAI runtime usage. Keep Antigravity for implementation and
Codex for review. Public source must not include the owner's API key or browser
artifacts. A previously shared credential must be replaced locally before any
live request. Do not ask for its value in chat.

## Completed Milestone A prompt (archive)

The next implementation prompt is **Milestone B** in HACKATHON-PLAN.md.

```text
Read AGENTS.md, README.md, HACKATHON-PLAN.md, docs/HOW-IT-WORKS.md, and
docs/BRAND.md. Inspect the actual code before editing. Run npm run verify.

Continue the existing Margin foundation; do not re-scaffold it. Complete
Milestone A in HACKATHON-PLAN.md: compact semantic observation and an OpenAI
gateway with schema validation, persistent usage accounting, pre-call budget
reservation, and bounded requests/output/retries. Keep browser actions and
independent assertions deterministic. Keep ordinary tests entirely offline.

Use the existing OpenAI SDK. Begin with the configured LLM_MODEL, proposed
gpt-6-luna; do not silently switch models/providers or assume account access.
Read a replacement key only from server environment at runtime; never print it.
Provide an explicitly invoked, tiny API smoke command. It must fail clearly
without a key and must never run as part of npm test or startup.

Before calling any live API, the budget guard must work and have an offline
check. Capture actual usage including failed/retried attempts where available.
Do not interpret the proposed $10 allowance as a provider-side billing cap.

Do not implement generation or healing in the same increment. Preserve the
current interface and document this milestone's actual behavior and limits.
Run relevant checks and fix failures. End with changed files, verified results,
and the exact next milestone. Never invent a passing result.
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
