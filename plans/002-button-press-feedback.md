# 002 — Add press feedback to every tap target

- **Status**: DONE (implemented on this branch)
- **Depends on**: 001 (needs `--ease-strong`)
- **Commit**: 6d0030f
- **Severity**: MEDIUM
- **Category**: 3 — Physicality & origin
- **Estimated scope**: 3 files (`src/index.css`, `src/main.tsx`, `src/pages/Home.tsx`), ~15 lines

## Problem

This is a touch-first PWA (`src/index.css:20` sets `touch-action: manipulation`;
`src/App.tsx:14` pins the app to the viewport). It has roughly twenty `<button>`
elements and **not one of them has a `:active` state** — `grep -rn ":active" src/`
returns nothing.

That matters most on the primary action, because the response is slow. Tapping
"Log" fires an AI request:

```tsx
// src/pages/Home.tsx:279-285 — current
<button
  className="mt-3 w-full rounded-2xl bg-neutral-950 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
  onClick={() => submitText(input)}
  disabled={isBusy || !input.trim()}
>
  {editingEntryId ? 'Save changes' : 'Log'}
</button>
```

The only acknowledgement the user gets is `{isBusy && <p>Thinking...</p>}` at
`src/pages/Home.tsx:292`, which appears *after* the state update lands. Between
finger-down and that text there is no feedback at all, and on a touch device
there is no hover state to fall back on. The same is true of "Ask"
(`src/pages/Home.tsx:363`), "Save & Log" (`src/pages/Home.tsx:243`), every
button in `src/pages/Meals.tsx`, and every button in `src/pages/Settings.tsx`.

Press feedback is the one animation category that *earns* its place on a
high-frequency element: it is not decoration, it is confirmation that the tap
registered.

## Target

One global rule, applied to every `<button>` that is not disabled and has not
opted out:

```css
/* target — src/index.css */
button {
  transition: transform 160ms var(--ease-strong);
}

button:not(:disabled):not([data-no-press]):active {
  transform: scale(0.97);
}
```

`scale(0.97)` is deliberate — AUDIT's press range is 0.95–0.98, and 0.97 reads
as firm without feeling mushy on the large full-width buttons this app uses.
160ms sits in the 100–160ms press budget.

Two exclusions are load-bearing:

1. **`:disabled`** — the disabled buttons in this app already communicate state
   via `disabled:opacity-50`. Scaling a button that will not respond is a lie.
2. **`[data-no-press]`** — `transform` is a single CSS property, so a `scale()`
   on `:active` would **wipe out** the `translateX()` that drives the
   swipe-to-reveal row:

```tsx
// src/pages/Home.tsx:326-328 — current; its transform must not be overridden
<button
  className="relative w-full rounded-xl bg-white px-2 py-2 text-left transition-transform duration-300"
  style={{ transform: `translateX(${actionsOpenId === e.id ? -92 : touchDeltaX}px)` }}
```

That row gets `data-no-press`. Its transform belongs to plan 003.

The tab bar is **already correct and must not change**. `src/App.tsx:26-38`
renders `NavLink`s, which produce `<a>` elements, so the global `button` rule
does not reach them. Tab switching is a tens-of-times-per-day action; per AUDIT
category 1 it should have colour change only, which is exactly what it has.

### iOS caveat the executor must handle

On iOS Safari, `:active` does not fire for an element unless a `touchstart`
listener exists on it or on an ancestor. Without this, the entire plan is a
no-op on the target device (an iPhone PWA). Register a passive no-op listener
once:

```tsx
// target — src/main.tsx, before ReactDOM render
// iOS Safari only applies :active styles when a touchstart listener exists.
document.addEventListener('touchstart', () => {}, { passive: true });
```

## Repo conventions to follow

- Global element-level styling already lives in `src/index.css` — see
  `src/index.css:25-30`, which sets `font: inherit` on
  `button, input, textarea, select`. Add the new `button` rules directly below
  that existing block so all bare-element styling stays together.
- `src/main.tsx` is the app entry point; put the listener there, not in a
  component.
- Tailwind utilities are the norm in JSX, but a global press affordance is
  precisely the case where a bare-element rule beats repeating
  `active:scale-97` on twenty call sites.

## Steps

1. In `src/index.css`, immediately after the existing
   `button, input, textarea, select { font: inherit; }` block (currently lines
   25-30), insert both rules from **Target** verbatim.
2. In `src/pages/Home.tsx`, add `data-no-press` to the swipe row button that
   currently begins at line 326 — the one with
   `className="relative w-full rounded-xl bg-white px-2 py-2 text-left transition-transform duration-300"`.
   Add the attribute only; change nothing else about that element.
3. In `src/main.tsx`, add the passive `touchstart` listener from **Target**
   before the React render call, with the explanatory comment.
4. Change no other `.tsx` file. Every other button picks the behaviour up from
   the global rule automatically.

## Boundaries

- Do NOT add `active:` Tailwind utilities to individual buttons.
- Do NOT touch `src/App.tsx` — the tab bar is correct as-is and must keep its
  colour-only transition.
- Do NOT add press feedback to `<a>`, `<input>`, `<label>`, or the checkbox at
  `src/pages/Settings.tsx:138-143`.
- Do NOT change the swipe row's `className` or `style` — only add the
  `data-no-press` attribute.
- Do NOT add new dependencies.
- If `src/index.css` has no `--ease-strong` token, plan 001 has not been run —
  STOP and report.

## Verification

- **Mechanical**: `npm run build` succeeds. `npm run lint` reports no new
  findings.
- **Feel check (desktop, Chrome DevTools)**: `npm run dev`, then press and hold
  the "Log" button:
  - It shrinks slightly and *stays* shrunk while held, returning on release.
  - With the textarea empty, "Log" is disabled — press and hold does **nothing**
    (no scale). Same for "Ask" with an empty question.
  - In the Animations panel at 10% playback, the shrink starts fast and
    decelerates — it must not ease in.
  - Swipe a Today-list entry left to reveal Edit/Delete, then tap the row: the
    row must still translate horizontally. If tapping it makes it *shrink*
    instead of slide, `data-no-press` was not applied.
- **Feel check (real iPhone, required)**: open the PWA over `vite --host`
  (`npm run dev` already passes `--host`) and tap the "Log" button. The shrink
  must be visible on the device. If nothing happens on iOS but works in Chrome,
  the `touchstart` listener in `src/main.tsx` is missing or not passive.
- **Reduced motion**: with `prefers-reduced-motion: reduce` emulated, the press
  becomes instant rather than absent — the button still visibly shrinks while
  held. That is intended: the feedback is the point, the animation is not.
- **Done when**: every enabled button in Home, Meals and Settings visibly
  responds to press on a real iPhone; disabled buttons and the swipe row do not.
