# Semantic decisions — "which screen is this, which element do I tap"

An optional layer that lets a plugin ask a decision model about the current
screen instead of hardcoding selectors or coordinates. Backed by TypeSafe's
Jev API (`POST https://api.typesafe.ai/v1/systemone`). The whole feature is
off unless `TYPESAFE_API_KEY` is set; with it unset every plugin runs its
existing logic and nothing leaves the machine.

## The one rule

**The model never produces a coordinate or a selector.** It answers with an
index into a list *we* built from the accessibility tree. Our code maps
index → element rect → centre → `tap(x, y)`. A reply that is not an index we
offered is discarded and flagged for escalation, even if it looks like a
point. `test/decisions.test.ts` asserts this.

## Pieces

| Where | What |
| --- | --- |
| `context.automation.elements()` | Visible, hittable, meaningful on-screen elements, pruned and numbered (≤ 120, nearest-to-centre kept when over). `src/devices/elements.ts`. |
| `src/decisions/` | `createDecisions(scope)` → `decideScreen`, `chooseElement`, `ask`. Our interface, so the backend is swappable. |
| `scheduler.decisions` | One row per decision: execution, device, question set, chosen value, probability map, confidence, fit, escalated, latency, tokens. |
| `GET /api/decisions/metrics` | Escalation rate per ISO week — the number that decides whether this approach is working. |

## Verdicts and escalation

Every answer carries `{ value, confidence, probabilities, escalate, reason }`.
`escalate: true` means **do not act on `value`** — fall back to your existing
logic. It is set when any of these hold:

- confidence is under `DECISIONS_CONFIDENCE_THRESHOLD` (default 0.75)
- the model picked the explicit `unknown` option
- the paired Noul ("does any listed option actually fit?") is under
  `DECISIONS_FIT_THRESHOLD` (default 0.5) — a Choice is relative and always
  crowns a winner even when every option is wrong; this catches that
- the reply was not an option we offered
- the request timed out (`DECISIONS_TIMEOUT_MS`, default 3000) or errored

Every call is one request: the Choice and its Noul travel together because
questions evaluate in parallel and each only costs its own tokens. 429 and
529 are retried with exponential backoff; a timeout is never a verdict.

## Using it in a task

```ts
import { createDecisions } from '@git-agni/phone-farm-core';

const decisions = createDecisions({
    executionId: context.executionId, deviceUdid: context.device.udid, source: 'my-plugin/task',
});
if (!decisions.available) { /* TYPESAFE_API_KEY unset — use your usual path */ }

const elements = await context.automation.elements();
const screen = await decisions.decideScreen(elements, {
    feed: 'The main feed of posts',
    'system-prompt': 'An iOS alert or permission sheet on top',
});
if (!screen.escalate && screen.value === 'system-prompt') {
    const pick = await decisions.chooseElement(elements, 'Dismiss the prompt without granting anything');
    if (!pick.escalate && pick.tapPoint) {
        await context.automation.tap(pick.tapPoint.x, pick.tapPoint.y);
        // Verify — this matters more than the pick. A wrong tap on a warmed account is expensive.
        const after = await context.automation.elements();
        const check = await decisions.ask(after, { appeared: 'Is the main feed now showing?' });
        await context.log(`feed appeared: ${Math.round((check.answers.appeared ?? 0) * 100)}%`);
    }
}
```

The reference implementation is the example plugin's `open-app@1`
(`src/example-plugin.ts`), gated by `OPEN_APP_USE_DECISIONS=true`. Off, the
original path runs unchanged; on, it identifies what appeared after launch,
clears a system prompt by index, and verifies with a Noul. Both paths stay
until the telemetry says which is better.

## Configuration

```
TYPESAFE_API_KEY=                 # unset = decisions unavailable
JEV_MODEL=jev-1.13.0              # pinned; jev-latest changes under you
DECISIONS_CONFIDENCE_THRESHOLD=0.75
DECISIONS_FIT_THRESHOLD=0.5
DECISIONS_TIMEOUT_MS=3000
OPEN_APP_USE_DECISIONS=false      # the comparison flag for open-app@1
```

## Privacy

With a key set, the pruned element list — roles, labels, and text-field
values visible on screen — is sent to TypeSafe. No screenshots, no
coordinates of yours, no device identifiers. If screen state must not leave
the machine, leave `TYPESAFE_API_KEY` unset.

## Tuning the pruner

Each `elements()` call logs `kept N of M candidates (T nodes) · ~K tokens`
into the execution log. The budget is ~4000 tokens for the list; Jev's
accuracy degrades as irrelevant state grows, so smaller is better, not just
cheaper. On the App Store's Today tab: 162 nodes → 29 elements → ~600 tokens.
