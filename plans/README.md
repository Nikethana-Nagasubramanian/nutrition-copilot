# Animation plans

Produced by an `improve-animations` audit of `nutrition-copilot` at commit
`6d0030f`. Each plan is self-contained: exact file paths, current-code excerpts,
exact target values, and a feel check. They can be handed to any agent,
including a cheaper model, without this audit's context.

## Scope of the audit

- **Audited**: the Vite + React 19 + Tailwind v4 web PWA in `src/` (1,122 lines
  across `App.tsx`, three pages, one component). No motion library is installed —
  `package.json` has no Framer Motion / React Spring / GSAP, so all motion is
  CSS plus one inline `transform`.
- **Not audited**: the untracked SwiftUI app in `NutritionCopilotiOS/` (929
  lines). It contains no animation code to review — the only motion-adjacent
  lines are two `ProgressView`s and a `scaleEffect(x: 1, y: 1.6)` at
  `ContentView.swift:375-395`, none of them animated. Worth a separate pass if
  that app becomes the primary client.
- The whole app's motion surface was five lines. Four of the five plans below
  therefore *add* motion where a state change currently teleports, rather than
  correcting existing curves.

## Plans

| # | Title | Severity | Status |
| --- | --- | --- | --- |
| [001](001-motion-tokens-and-reduced-motion.md) | Add motion tokens and a reduced-motion baseline | LOW (prerequisite) | DONE |
| [002](002-button-press-feedback.md) | Add press feedback to every tap target | MEDIUM | DONE |
| [003](003-fix-swipe-to-reveal-row.md) | Fix the swipe-to-reveal row | HIGH | DONE |
| [004](004-animate-macro-progress-bars.md) | Animate the macro bars with transform, not width | MEDIUM | DONE |
| [005](005-showing-chip-enter-and-exit.md) | Make the "Showing …" chip interruptible, give it an exit | MEDIUM | DONE |

## Execution order and dependencies

```
001 (tokens)  ──┬──> 002 (press feedback) ──> 003 (swipe row)
                ├──> 004 (macro bars)
                └──> 005 (showing chip)
```

- **001 must run first.** Plans 002–005 all consume `--ease-strong`,
  `--ease-inout-strong` or `--ease-drawer`. Each downstream plan is instructed to
  stop and report if the tokens are missing.
- **002 must run before 003.** 002 adds a global `button:active` scale, which
  would clobber the swipe row's `translateX` (both live on `transform`). 002 adds
  the `data-no-press` opt-out that 003 depends on. 003 contains a fallback
  instruction if they are run out of order.
- **004 and 005 are independent** of each other and of 002/003, and both touch
  `src/components/MacroSummary.tsx` — 004 changes the bars inside it, 005 changes
  the chip above them. Either order works; run them sequentially rather than in
  parallel to keep the diffs reviewable.
- 003 is the only HIGH and the only one fixing a visible defect rather than
  adding polish. If only one plan gets executed, execute 001 then 003.

## Deferred — deliberately not planned

Recorded so they are not mistaken for oversights:

- **Tab bar route transitions** (`src/App.tsx:23-41`). The bottom nav changes
  colour only, with no motion. This is **already correct** — tab switching is a
  tens-of-times-per-day action, and per the audit's frequency rule it should be
  reduced, not animated. Adding page transitions here would make the app worse.
- **Toast in Meals** (`src/pages/Meals.tsx:219-223`). Appears and disappears with
  no motion; auto-dismisses after 1500ms. A genuine LOW-value opportunity, but
  the element already carries `-translate-x-1/2` for centring, so any animation
  must compose with that transform rather than replace it — enough fiddliness to
  not be worth it before the five above land. Note: re-logging the same meal
  within the 1500ms window sets `toast` to an identical string, so the state
  never changes and the dismiss timer is not reset. That is a logic bug, not a
  motion one; out of scope here.
- **Meals form expand/collapse** (`src/pages/Meals.tsx:116-184`). `formOpen`
  toggles a whole card into existence, instantly pushing the list below it down.
  A height transition is the right fix but needs `grid-template-rows: 0fr → 1fr`
  or a measured height, which is more machinery than the payoff justifies for a
  once-in-a-while action.
- **Animating the macro numbers** (`src/components/MacroSummary.tsx:36-38`).
  Counting the digits up alongside the bar in plan 004 would be a nice touch, but
  the values already use `tabular-nums` so they do not reflow, and a tick
  animation on a value that changes on every log risks becoming noise. Revisit
  after 004 is on device.
- **`AskResultCard` entrance** (`src/pages/Home.tsx:371`, `:377-412`). The result
  card appears instantly after an AI round-trip of several seconds. A 200ms
  fade-and-rise would be justified here; it is left out only to keep this batch
  focused, and is the strongest candidate for a sixth plan.

## A note on repo instructions

`AGENTS.md` says "Expo HAS CHANGED — read the exact versioned docs at
https://docs.expo.dev/versions/v57.0.0/ before writing any code." No Expo or
React Native code exists in the tracked project — `src/` is a Vite web app, and
the native client in `NutritionCopilotiOS/` is a plain SwiftUI Xcode project, not
Expo. None of these plans touch Expo APIs, so that instruction does not bind
them. If Expo is planned for this repo, `AGENTS.md` is currently misleading about
what the codebase is.
