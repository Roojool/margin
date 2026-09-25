# Margin / design notes

Margin is an inspection tool. The name comes from the space beside a record where
someone writes what changed, what matters, and what still needs checking.

**Descriptor:** Browser tests, with evidence.
**Product promise:** Keep the test useful when the interface changes.
**Voice:** specific, calm, candid. Say “Order not stored” instead of “AI detected an anomaly.”

The working name has not been trademark-cleared. Do not use organizer logos as product branding.

## Visual rules

- Paper `#F5F3EE`, ink `#202522`, blue `#254EC7`, rules `#D7DCD5`.
- Secondary text `#59615B`. Failure `#A13420`, success `#24643D`.
- Georgia for the wordmark and opening title; system sans for UI; monospace for IDs and measurements. No font downloads.
- 4px control corners; thin dividers; no decorative cards, blur, gradients, or glow.
- A slash next to the wordmark is the only brand device needed initially.
- Preserve whitespace around evidence. Dense information should remain readable.
- Color never carries status alone. All controls need labels, keyboard focus, and useful errors.

## Why the current screen looks this way

The left column is the journey record. The right column is its browser evidence.
The metrics form a quiet ledger underneath. Run history appears as rows, not
decorative cards. The large opening text is confined to the foundation screen;
as more journeys arrive, shorten the header to keep the working area visible.

Next UI additions must use real data: selectable step captures, expected/observed
values, candidate repair details, revision diffs. Add navigation only when its
destination exists. No fake Live badge, pretend agent chat, random graphs, or
confidence percentage derived from an uncalibrated heuristic.

## Interaction states

Ready → Running → Pass / Fail / Blocked. Later, show repair as a separate finding,
not a replacement for the execution outcome. A repaired journey can still fail.
Keep errors readable and evidence available. Do not hide unsuccessful attempts.

At narrow widths, stack journey above evidence. Never shrink screenshots or text
until unreadable merely to preserve a desktop layout.
