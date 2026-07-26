# 001 — Add motion tokens and a reduced-motion baseline

- **Status**: DONE (implemented on this branch)
- **Commit**: 6d0030f
- **Severity**: LOW (but a prerequisite for 002–005)
- **Category**: 7 — Cohesion & tokens / 6 — Accessibility
- **Estimated scope**: 1 file (`src/index.css`), ~30 lines added

## Problem

The app has exactly two hand-typed motion values in the entire codebase, and no
shared tokens:

```css
/* src/index.css:38-47 — current: the only keyframe in the app */
@keyframes slideChip {
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

```tsx
// src/components/MacroSummary.tsx:21 — current
className="... animate-[slideChip_420ms_ease-out] ..."
```

```tsx
// src/pages/Home.tsx:327 — current
className="relative w-full rounded-xl bg-white px-2 py-2 text-left transition-transform duration-300"
```

Both use weak built-in easing (`ease-out` in CSS is `cubic-bezier(0, 0, 0.58, 1)`;
Tailwind's default `transition-transform` timing function is
`cubic-bezier(0.4, 0, 0.2, 1)`, an ease-in-out). Plans 002–005 each need a strong
curve, and hand-typing five near-identical cubic-beziers is exactly the
consolidation problem to avoid up front.

Separately, there is **zero** `prefers-reduced-motion` handling anywhere in the
repo (`grep -r "prefers-reduced-motion" src/` returns nothing), while the app
already ships an 18px translate (`slideChip`) and a smooth scroll
(`src/pages/Home.tsx:203`).

This plan adds no animation of its own. It creates the vocabulary the other
plans consume.

## Target

Tokens defined once, in `src/index.css`, using Tailwind v4's `@theme` block so
they are available **both** as CSS custom properties (`var(--ease-strong)`) and
as generated Tailwind utilities (`ease-strong`, `ease-drawer`):

```css
/* target — src/index.css, immediately after `@import "tailwindcss";` */
@theme {
  /* Strong ease-out for UI entrances/exits. Replaces weak built-in ease-out. */
  --ease-strong: cubic-bezier(0.23, 1, 0.32, 1);
  /* Strong ease-in-out for elements moving/morphing on screen. */
  --ease-inout-strong: cubic-bezier(0.77, 0, 0.175, 1);
  /* iOS-like drawer curve, for the swipe-to-reveal row settle. */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}
```

Durations are **not** tokenised: Tailwind v4 has no `--duration-*` theme
namespace, and its `duration-<number>` utility already accepts bare values
(`duration-160`, `duration-200`, `duration-250`). Plans 002–005 use those
utilities directly with the values below, so the duration scale lives in the
plans rather than in a parallel token system:

| Use | Duration | Utility |
| --- | --- | --- |
| Button press feedback | 160ms | `duration-160` |
| Chip / small popover entrance | 200ms | `duration-200` |
| Swipe row settle | 250ms | `duration-250` |
| Macro bar value change | 300ms | `duration-300` |

And a reduced-motion baseline that **drops movement but keeps opacity and
colour feedback** — reduced motion means gentler, not zero:

```css
/* target — src/index.css, at the end of the file */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    /* Keep transitions, but make positional change instant. Opacity and
       colour transitions are unaffected because they carry meaning. */
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
}
```

> Note for the executor: this is a deliberately blunt global baseline so that
> nothing shipped by plans 002–005 can strand a reduced-motion user mid-slide.
> Every animation in this batch conveys its meaning through its *end state*
> (a bar's length, a chip's presence, a pressed button's scale), so collapsing
> the duration loses nothing. No plan needs a `motion-reduce:` override on top.

## Repo conventions to follow

- All global CSS lives in `src/index.css` (47 lines). There is no `styles/`
  directory and no separate tokens file — **do not create one**.
- `src/index.css:1` is `@import "tailwindcss";`. In Tailwind v4 the `@theme`
  block must come after that import.
- Styling everywhere else is Tailwind utility classes in JSX (see
  `src/pages/Meals.tsx:193` for the house style). Hand-written CSS is reserved
  for what utilities cannot express.
- The existing `@keyframes slideChip` block stays where it is; plan 005 deals
  with it.

## Steps

1. Open `src/index.css`. After line 1 (`@import "tailwindcss";`), insert the
   `@theme { … }` block from **Target** verbatim, including the comments.
2. At the very end of `src/index.css` (after the `@keyframes slideChip` block),
   append the `@media (prefers-reduced-motion: reduce)` block from **Target**
   verbatim.
3. Do not change `@keyframes slideChip`, and do not touch any `.tsx` file.

## Boundaries

- Do NOT modify any file other than `src/index.css`.
- Do NOT create a new CSS or tokens file.
- Do NOT apply the new tokens to any component — that is plans 002–005. This
  plan's diff must be additive CSS only.
- Do NOT add new dependencies.
- Do NOT change `@keyframes slideChip` (plan 005 owns it).
- If `src/index.css` does not start with `@import "tailwindcss";` or already
  contains an `@theme` block, STOP and report instead of improvising.

## Verification

- **Mechanical**: `npm run build` succeeds (`tsc -b && vite build`).
  `npm run lint` (oxlint) reports no new findings.
- **Token check**: run `npm run build`, then
  `grep -r "ease-strong" dist/assets/*.css` — the custom property must appear in
  the built CSS, confirming Tailwind emitted it to `:root`.
- **Feel check**: none. This plan changes no visible behaviour. If anything in
  the UI looks or moves differently after this change, something is wrong —
  investigate before proceeding to plans 002–005.
- **Reduced-motion check**: in Chrome DevTools → Rendering → "Emulate CSS
  prefers-reduced-motion: reduce", reload, tap an entry in the Today list. The
  "Showing …" chip should now appear instantly rather than sliding up. Nothing
  else should change.
- **Done when**: `src/index.css` contains the three easing tokens and the
  reduced-motion block, the build passes, and the UI is visually identical with
  reduced motion off.
