# 005 — Make the "Showing …" chip interruptible and give it an exit

- **Status**: TODO
- **Depends on**: 001 (needs `--ease-strong`)
- **Commit**: 6d0030f
- **Severity**: MEDIUM
- **Category**: 4 — Interruptibility / 2 — Easing & duration / 8 — Missed opportunities
- **Estimated scope**: 2 files (`src/index.css`, `src/components/MacroSummary.tsx`), ~45 lines

## Problem

The "Showing <meal>" chip slides out from behind the macro card when you tap an
entry. It is the only intentional animation in the app, and it has three
problems.

```css
/* src/index.css:38-47 — current */
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
// src/components/MacroSummary.tsx:19-27 — current
<div className="relative pt-12">
  {showingLabel && (
    <div className="absolute left-8 right-8 top-0 z-0 animate-[slideChip_420ms_ease-out] rounded-t-2xl bg-white px-4 pb-5 pt-3 shadow-md shadow-neutral-200/80">
      <button className="flex w-full items-center justify-between gap-3 text-left" onClick={onClearShowing}>
        <span className="truncate text-sm text-neutral-950">Showing {showingLabel}</span>
        <span className="shrink-0 text-sm font-semibold text-red-600">Remove</span>
      </button>
    </div>
  )}
```

> The excerpt above is quoted from the file as it exists; reproduce the element
> from the **Target** section rather than retyping this one.

### 1. 420ms is far too long

AUDIT's budget for a small popover is 125–200ms, and the hard ceiling for any UI
animation is 300ms. At 420ms the chip is still arriving well after the user's
attention has moved to the macro numbers it is labelling.

### 2. It is a keyframe, so it cannot be interrupted

Keyframes restart from zero and cannot retarget. The chip is dismissed by tapping
"Remove" and re-shown by tapping another entry — the exact rapid-toggle case that
AUDIT category 4 says must use transitions.

### 3. There is no exit at all

`{showingLabel && …}` unmounts the element the instant `selectedEntryId` becomes
`null` (`src/pages/Home.tsx:216`, `src/pages/Home.tsx:172`). The chip slides in
over 420ms and then vanishes in a single frame. Asymmetry in the wrong direction:
the deliberate action (revealing) is slow, and the system's response
(dismissing) has no motion connecting it to anything.

## Target

Replace the keyframe with transitions, entered via `@starting-style` and exited
by keeping the element mounted until its transition finishes.

```css
/* target — src/index.css, replacing the @keyframes slideChip block entirely */

/* The "Showing …" chip slides up from behind the macro card. It emerges from
   behind a solid object, so it translates only — it does not scale. */
.macro-chip {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 200ms var(--ease-strong), transform 200ms var(--ease-strong);
}

@starting-style {
  .macro-chip {
    opacity: 0;
    transform: translateY(12px);
  }
}

.macro-chip[data-closing] {
  opacity: 0;
  transform: translateY(12px);
}
```

200ms sits at the top of the popover budget; `12px` replaces `18px` because the
travel only needs to read as "from behind the card", and the shorter distance
keeps the motion legible at 200ms. `scale(0.98)` is dropped deliberately: an
object emerging from behind another object does not change size.

Browser support note: `@starting-style` requires Safari 17.5+ / Chrome 117+.
Where unsupported, the chip simply appears with no entry animation and still
exits correctly — an acceptable degradation, not a bug to work around.

The component keeps the chip mounted through its exit:

```tsx
/* target — src/components/MacroSummary.tsx */
import { useEffect, useRef, useState } from 'react';
import type { DailyTargets, Macros } from '../types/nutrition';

interface Props {
  totals: Macros;
  targets: DailyTargets;
  showingLabel?: string | null;
  onClearShowing?: () => void;
}

export function MacroSummary({ totals, targets, showingLabel, onClearShowing }: Props) {
  // The chip must outlive `showingLabel` by the length of its exit transition,
  // so its presence is tracked locally rather than read straight from the prop.
  const [chip, setChip] = useState<{ label: string; closing: boolean } | null>(
    showingLabel ? { label: showingLabel, closing: false } : null
  );
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (exitTimer.current) clearTimeout(exitTimer.current);

    if (showingLabel) {
      // Re-showing mid-exit must cancel the exit, not queue behind it.
      setChip({ label: showingLabel, closing: false });
      return;
    }

    setChip((current) => (current ? { ...current, closing: true } : null));
    // Safety net: if transitionend never fires (interrupted layout, unsupported
    // property), unmount anyway.
    exitTimer.current = setTimeout(() => setChip(null), 400);
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [showingLabel]);

  const items = [
    /* unchanged — keep the existing four entries verbatim */
  ] as const;

  return (
    <div className="relative pt-12">
      {chip && (
        <div
          className="macro-chip absolute left-8 right-8 top-0 z-0 rounded-t-2xl bg-white px-4 pb-5 pt-3 shadow-md shadow-neutral-200/80"
          data-closing={chip.closing ? '' : undefined}
          onTransitionEnd={(event) => {
            if (chip.closing && event.propertyName === 'opacity') setChip(null);
          }}
        >
          <button className="flex w-full items-center justify-between gap-3 text-left" onClick={onClearShowing}>
            <span className="truncate text-sm text-neutral-950">Showing {chip.label}</span>
            <span className="shrink-0 text-sm font-semibold text-red-600">Remove</span>
          </button>
        </div>
      )}
      {/* the macro card below is unchanged */}
```

### The label swap must NOT re-animate — this is deliberate

Tapping a different entry while the chip is open changes `chip.label` on an
element that stays mounted, so nothing animates: the text swaps in place. That is
correct. Tapping entries is a tens-of-times-per-day action, and re-playing the
slide on every tap would be exactly the decorative-motion-on-a-frequent-action
mistake AUDIT category 1 warns about. **Do not add a `key={showingLabel}`** to
force a remount, and do not add a crossfade to the label.

## Repo conventions to follow

- `src/index.css` is the only stylesheet. The `.macro-chip` class replaces the
  `@keyframes slideChip` block in place, at the end of the file but before the
  `prefers-reduced-motion` block added by plan 001.
- A bare CSS class is used here rather than Tailwind utilities because
  `@starting-style` and attribute-driven exit states cannot be expressed as
  utilities. Every other property on the chip (`absolute left-8 right-8 top-0
  z-0 rounded-t-2xl bg-white px-4 pb-5 pt-3 shadow-md shadow-neutral-200/80`)
  stays as Tailwind classes exactly as it is now.
- `src/components/MacroSummary.tsx` currently imports types only. Add the React
  import as the first line, above the type import — the order used at
  `src/pages/Home.tsx:1-7`.
- This component uses an `interface Props` (line 3). Keep it.

## Steps

1. In `src/index.css`, delete the entire `@keyframes slideChip` block (lines
   38-47) and put the three `.macro-chip` rules from **Target** in its place.
2. In `src/components/MacroSummary.tsx`, add
   `import { useEffect, useRef, useState } from 'react';` as line 1.
3. Add the `chip` state, the `exitTimer` ref, and the `useEffect` from
   **Target**, above the existing `items` array (currently lines 11-16). Leave
   `items` exactly as it is.
4. Replace the `{showingLabel && ( … )}` block (lines 20-27) with the
   `{chip && ( … )}` block from **Target**. Note the three changes to the
   element: `animate-[slideChip_420ms_ease-out]` is replaced by `macro-chip`, a
   `data-closing` attribute is added, and an `onTransitionEnd` handler is added.
   The `showingLabel` reference inside becomes `chip.label`.
5. Leave the macro card `<div className="relative z-10 …">` (lines 28-46)
   untouched.
6. Confirm the old animation is fully gone:
   `grep -rn "slideChip" src/` must return nothing.

## Boundaries

- Do NOT change the `Props` interface or how `Home` calls this component
  (`src/pages/Home.tsx:212-217`) — `showingLabel` and `onClearShowing` keep their
  current contract.
- Do NOT add `key={showingLabel}` or any remount trigger on label change.
- Do NOT touch the macro bars inside this component — that is plan 004. If plan
  004 has already run, leave its `scaleX` bars exactly as they are.
- Do NOT change the chip's position, padding, shadow, `z-0`, or the `pt-12` on
  the wrapper that reserves its space.
- Do NOT add an animation library or `react-transition-group`.
- Do NOT change `src/pages/Home.tsx`.
- If `src/index.css` has no `--ease-strong` token, plan 001 has not been run —
  STOP and report.

## Verification

- **Mechanical**: `npm run build` succeeds. `npm run lint` reports no new
  findings. `grep -rn "slideChip" src/` is empty.
- **Feel check**: `npm run dev`, log two entries, then:
  - Tap entry A. The chip slides up from behind the macro card and fades in,
    noticeably quicker than before.
  - Tap "Remove". The chip now slides back down behind the card and fades out
    instead of vanishing. This is the main thing this plan adds.
  - Tap entry A, then immediately tap "Remove", then immediately tap entry B
    while it is still exiting. The chip must reverse smoothly from wherever it
    is — never a flicker, never a jump to fully-hidden first, never a stuck chip
    left behind.
  - Tap entry A, then entry B. The label text swaps with **no** slide. If the
    chip re-animates, a remount was introduced — remove it.
  - In the Animations panel at 10% playback: entry starts fast and decelerates;
    the chip translates only, with no size change.
  - Leave the chip open and reload the page with an entry selected — it should
    render already in place. (`selectedEntryId` is not persisted, so in practice
    it renders absent; if you see a stray slide on load, report it.)
- **DOM check**: with the chip closed, inspect the DOM — no `.macro-chip`
  element may remain after ~400ms. A leaked node means `onTransitionEnd` and the
  safety timeout both failed.
- **Reduced motion**: emulate `prefers-reduced-motion: reduce`. The chip appears
  and disappears instantly, and — critically — still *unmounts*. Verify no
  orphaned `.macro-chip` node is left in the DOM, since the transition is
  0.01ms there.
- **Done when**: the chip animates in and out at 200ms, interrupting mid-exit
  reverses cleanly, changing the label does not re-animate, and the node always
  unmounts.
