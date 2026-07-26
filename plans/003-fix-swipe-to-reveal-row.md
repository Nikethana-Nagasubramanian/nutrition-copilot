# 003 — Fix the swipe-to-reveal row: per-row drag, no transition lag, velocity dismissal

- **Status**: DONE (implemented on this branch)
- **Depends on**: 001 (needs `--ease-drawer`), 002 (adds `data-no-press` to this row)
- **Commit**: 6d0030f
- **Severity**: HIGH
- **Category**: 4 — Interruptibility / 5 — Performance / 3 — Physicality
- **Estimated scope**: 1 file (`src/pages/Home.tsx`), ~120 lines changed

## Problem

The swipe-to-reveal gesture on the Today list has four distinct defects, all in
`src/pages/Home.tsx`. They share one code path, so they are one plan.

### 1. Dragging one row drags every row (the worst of the four)

Drag offset is held in a single page-level state value, not per row:

```tsx
// src/pages/Home.tsx:47-48 — current
const [touchStartX, setTouchStartX] = useState<number | null>(null);
const [touchDeltaX, setTouchDeltaX] = useState(0);
```

```tsx
// src/pages/Home.tsx:326-328 — current
<button
  className="relative w-full rounded-xl bg-white px-2 py-2 text-left transition-transform duration-300"
  style={{ transform: `translateX(${actionsOpenId === e.id ? -92 : touchDeltaX}px)` }}
```

Every row whose id is not `actionsOpenId` receives `touchDeltaX`. Swiping one
entry therefore slides **all** the other entries left in lockstep. With more
than one item logged, the gesture is visibly broken.

### 2. The row fights the finger

`transition-transform duration-300` is unconditionally present on the same
element whose `transform` is updated from `onTouchMove`. Every finger position
change is animated over 300ms, so the row chases the finger with a permanent
~300ms lag instead of tracking it 1:1. Direct manipulation must be instantaneous;
the transition belongs to the release, not the drag.

The curve is wrong too: Tailwind's `transition-transform` defaults to
`cubic-bezier(0.4, 0, 0.2, 1)` (an ease-in-out), and 300ms exceeds what this
reveal needs.

### 3. A React re-render per touch frame

```tsx
// src/pages/Home.tsx:310-314 — current
onTouchMove={(event) => {
  if (touchStartX === null) return;
  const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStartX;
  setTouchDeltaX(Math.min(0, Math.max(delta, -96)));
}}
```

`setTouchDeltaX` at finger rate re-renders all of `Home` — the `MacroSummary`
chart, the whole entries list, and the Ask panel — on every frame of the drag.

### 4. Distance-only dismissal and a hard boundary

```tsx
// src/pages/Home.tsx:186-198 — current
const handleTouchEnd = (entryId: string, x: number) => {
  if (touchStartX === null) return;
  const delta = x - touchStartX;
  if (delta < -44) {
    setActionsOpenId((current) => (current === entryId ? null : entryId));
    setSuppressClickId(entryId);
    setTimeout(() => setSuppressClickId(null), 250);
  } else if (delta > 44 && actionsOpenId === entryId) {
    setActionsOpenId(null);
  }
  setTouchDeltaX(0);
  setTouchStartX(null);
};
```

A fast, short flick — the natural gesture — does not open the row, because only
distance is considered. And `Math.min(0, Math.max(delta, -96))` stops the row
dead at 96px with no resistance build-up, which reads as a bug rather than a
limit.

Two smaller issues in the same handler, fixed incidentally by the rewrite:
`event.changedTouches[0]?.clientX ?? 0` falls back to `0`, which on a missing
touch yields a large negative delta and spuriously opens the row; and
`setActionsOpenId((current) => current === entryId ? null : entryId)` closes an
already-open row on a *left* swipe, when left should only ever open.

## Target

Replace the page-level drag state with a memoised `EntryRow` component that owns
its own gesture, writes `transform` directly to its own DOM node during the drag
(no React render per frame), and animates only on release.

```tsx
/* target — src/pages/Home.tsx, module scope, above `export default function Home()` */

const SWIPE_OPEN_X = -92;        // resting offset when actions are revealed
const SWIPE_MAX_X = -96;         // full-reveal boundary
const SWIPE_TRIGGER_PX = 44;     // distance threshold
const SWIPE_TRIGGER_V = 0.11;    // px/ms flick threshold (AUDIT §4)
const SWIPE_SETTLE = 'transform 250ms var(--ease-drawer)';

// Rising resistance past the boundaries instead of a hard stop.
function rubberBand(x: number): number {
  if (x > 0) return x * 0.15;
  if (x < SWIPE_MAX_X) return SWIPE_MAX_X + (x - SWIPE_MAX_X) * 0.15;
  return x;
}
```

```tsx
/* target — src/pages/Home.tsx, module scope */

const EntryRow = memo(function EntryRow({
  entry,
  isSelected,
  isOpen,
  onSetOpen,
  onSelect,
  onEdit,
  onDelete,
}: {
  entry: LoggedEntry;
  isSelected: boolean;
  isOpen: boolean;
  onSetOpen: (id: string, open: boolean) => void;
  onSelect: (id: string) => void;
  onEdit: (entry: LoggedEntry) => void;
  onDelete: (id: string) => void;
}) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const drag = useRef<{ startX: number; startT: number; delta: number } | null>(null);
  const movedRef = useRef(false);

  const restingX = isOpen ? SWIPE_OPEN_X : 0;

  // Settle to the resting offset whenever open state changes (including the
  // initial mount, where transform is already 0 so nothing visibly animates).
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    el.style.transition = SWIPE_SETTLE;
    el.style.transform = `translateX(${restingX}px)`;
  }, [restingX]);

  return (
    <li
      className={`rounded-2xl bg-white p-2 shadow-sm shadow-neutral-200/70 ${
        isSelected ? 'ring-2 ring-green-500' : ''
      }`}
      style={{ touchAction: 'pan-y' }}
      onTouchStart={(event) => {
        const x = event.touches[0]?.clientX;
        if (x === undefined) return;
        drag.current = { startX: x, startT: performance.now(), delta: 0 };
        movedRef.current = false;
        // Direct manipulation must track the finger 1:1 — no transition.
        if (rowRef.current) rowRef.current.style.transition = 'none';
      }}
      onTouchMove={(event) => {
        const d = drag.current;
        const x = event.touches[0]?.clientX;
        if (!d || x === undefined || !rowRef.current) return;
        d.delta = x - d.startX;
        if (Math.abs(d.delta) > 6) movedRef.current = true;
        rowRef.current.style.transform =
          `translateX(${rubberBand(restingX + d.delta)}px)`;
      }}
      onTouchEnd={() => {
        const d = drag.current;
        drag.current = null;
        const el = rowRef.current;
        if (!d || !el) return;

        const velocity = Math.abs(d.delta) / Math.max(performance.now() - d.startT, 1);
        const flicked = velocity > SWIPE_TRIGGER_V;

        let next = isOpen;
        if (d.delta < 0 && (flicked || d.delta <= -SWIPE_TRIGGER_PX)) next = true;
        else if (d.delta > 0 && (flicked || d.delta >= SWIPE_TRIGGER_PX)) next = false;

        // Always settle, even when the open state is unchanged — the effect
        // below only fires when `restingX` actually changes.
        el.style.transition = SWIPE_SETTLE;
        el.style.transform = `translateX(${next ? SWIPE_OPEN_X : 0}px)`;
        if (next !== isOpen) onSetOpen(entry.id, next);
      }}
    >
      <div className="relative overflow-hidden rounded-xl">
        <div className="absolute inset-y-0 right-2 flex items-center gap-3">
          <button className="grid h-10 w-10 place-items-center text-blue-600" onClick={() => onEdit(entry)} aria-label="Edit">
            <EditIcon />
          </button>
          <button className="grid h-10 w-10 place-items-center text-red-600" onClick={() => onDelete(entry.id)} aria-label="Delete">
            <TrashIcon />
          </button>
        </div>
        <button
          ref={rowRef}
          data-no-press
          className="relative w-full rounded-xl bg-white px-2 py-2 text-left"
          onClick={() => {
            // A drag is not a tap.
            if (movedRef.current) return;
            onSelect(entry.id);
          }}
        >
          <div className="text-sm font-medium text-neutral-900">{entry.description}</div>
          <div className="text-xs text-neutral-500">
            {Math.round(entry.calories)} kcal · {Math.round(entry.protein)}g protein · {Math.round(entry.carbs)}g carbs · {Math.round(entry.fat)}g fat
          </div>
        </button>
      </div>
      {isOpen && (
        <div className="mt-1 text-right text-[11px] font-medium text-neutral-400">
          Swipe right to close
        </div>
      )}
    </li>
  );
});
```

Note what left the code: `transition-transform duration-300` from the
`className` (transition is now set imperatively, per phase),
`style={{ transform: … }}` (React no longer owns the transform, so it cannot
fight the imperative writes), and the `suppressClickId` state plus its
`setTimeout`.

Call site:

```tsx
/* target — src/pages/Home.tsx, replacing the <li> block currently at 300-345 */
<ul className="mt-2 space-y-2">
  {entries.map((e) => (
    <EntryRow
      key={e.id}
      entry={e}
      isSelected={selectedEntryId === e.id}
      isOpen={actionsOpenId === e.id}
      onSetOpen={handleSetOpen}
      onSelect={selectEntry}
      onEdit={handleEdit}
      onDelete={handleDelete}
    />
  ))}
</ul>
```

For `memo` to pay off, every callback passed in must be referentially stable, so
each is wrapped in `useCallback`:

```tsx
/* target — src/pages/Home.tsx, inside Home() */
const handleSetOpen = useCallback((id: string, open: boolean) => {
  setActionsOpenId(open ? id : null);
}, []);
```

`handleEdit`, `handleDelete` and `selectEntry` must be wrapped in `useCallback`
too. `handleDelete` closes over `selectedEntryId`, `editingEntryId` and
`refresh`; write it with the functional-update form so the dependency array is
just `[refresh]`:

```tsx
/* target */
const handleDelete = useCallback(async (id: string) => {
  await deleteLoggedEntry(id);
  setSelectedEntryId((current) => (current === id ? null : current));
  setEditingEntryId((current) => {
    if (current === id) setInput('');
    return current === id ? null : current;
  });
  await refresh();
}, [refresh]);
```

## Repo conventions to follow

- `src/pages/Home.tsx` already defines presentational sub-components at module
  scope below the default export — see `AskResultCard`
  (`src/pages/Home.tsx:377`), `MacroMini` (`:435`) and `AskBar` (`:447`). Put
  `EntryRow` in that same region, and keep `EditIcon` / `TrashIcon` where they
  are (`:414`, `:423`) — `EntryRow` references them.
- Props are typed inline with an object literal type, as in
  `MacroMini` (`src/pages/Home.tsx:435`). Do not introduce a separate
  `interface` — that pattern only appears in `src/pages/Meals.tsx:11`.
- `refresh` is already a `useCallback` (`src/pages/Home.tsx:52-56`); follow it.
- Extend the existing React import at `src/pages/Home.tsx:1` to
  `import { memo, useCallback, useEffect, useRef, useState } from 'react';`.
- `var(--ease-drawer)` comes from plan 001. It is used inside an imperative
  `style.transition` string, which resolves the custom property normally.

## Steps

1. Extend the React import on `src/pages/Home.tsx:1` with `memo`.
2. Add the four `SWIPE_*` constants, `SWIPE_SETTLE`, and `rubberBand()` at module
   scope, next to the existing `ZERO_MACROS` / `ZERO_RANGE` constants
   (`src/pages/Home.tsx:9-16`).
3. Add the `EntryRow` component at module scope, below `AskResultCard`.
4. Delete the `touchStartX`, `touchDeltaX` and `suppressClickId` state
   declarations (`src/pages/Home.tsx:47-49`).
5. Delete `handleTouchEnd` entirely (`src/pages/Home.tsx:186-198`).
6. Add `handleSetOpen` as shown in **Target**.
7. Wrap `handleEdit` (`:180-184`) and `selectEntry` (`:200-204`) in
   `useCallback`. `handleEdit`'s deps are `[]` (it only calls setters);
   `selectEntry`'s deps are `[]`.
8. Replace `handleDelete` (`:170-178`) with the `useCallback` version in
   **Target**.
9. Replace the `<li>…</li>` block inside the `entries.map()` (`:301-345`) with
   the `<EntryRow … />` call site from **Target**.
10. Verify no reference to `touchDeltaX`, `touchStartX`, `suppressClickId` or
    `handleTouchEnd` remains: `grep -n "touchDeltaX\|touchStartX\|suppressClickId\|handleTouchEnd" src/pages/Home.tsx` must return nothing.

## Boundaries

- Do NOT change any other file. `MacroSummary` and the Ask panel are out of scope
  (plans 004 and 005).
- Do NOT change the Edit/Delete action buttons' markup, icons, colours or
  `aria-label`s, and do NOT change the `-92px` reveal distance or the
  `ring-2 ring-green-500` selected treatment — this plan changes how the row
  moves, not what it looks like at rest.
- Do NOT add a gesture or animation library. This must stay dependency-free.
- Do NOT reintroduce `transition-transform` as a Tailwind class on the row; the
  transition is set imperatively so it can be switched off mid-drag.
- Do NOT put `transform` back into a React `style` prop on `rowRef`'s element —
  React would overwrite the imperative writes on the next render.
- If `data-no-press` is absent from the row button, plan 002 has not run. Add it
  as part of step 3's target code, and note it in your report.
- If the code you find does not match the excerpts above, STOP and report.

## Verification

- **Mechanical**: `npm run build` succeeds (`tsc -b && vite build`).
  `npm run lint` reports no new findings. Confirm the grep in step 10 is empty.
- **Feel check (real iPhone, required — this is a touch gesture)**: log at least
  three entries, then:
  - Drag one row left slowly. **Only that row moves.** The other rows stay put.
    (This is the primary regression test — it fails on `main` today.)
  - During the drag, the row edge stays pinned under your finger with no
    perceptible lag.
  - Keep dragging past the reveal point: resistance builds and the row slows
    rather than stopping dead at 96px.
  - Release below the threshold: the row springs back to 0 rather than sticking.
  - Flick left quickly but only ~20px: the row opens anyway (velocity
    dismissal). On `main` this does nothing.
  - With a row open, flick right: it closes.
  - Drag a row left by 30px and release, then tap it: it selects (the chart
    swaps). Drag 60px and release: the tap that opened it must **not** also
    select.
  - Drag vertically down the list starting on a row: the page still scrolls
    (`touch-action: pan-y`).
- **Feel check (DevTools)**: with the Animations panel at 10% playback, release a
  drag — the settle starts fast and decelerates (`--ease-drawer`); it must not
  ease in or overshoot.
- **Perf check**: open React DevTools Profiler, record a drag. `MacroSummary`
  must not re-render during the gesture, and only the dragged `EntryRow` may
  re-render (once, on release).
- **Done when**: dragging one row moves only that row, the row tracks the finger
  without lag, a short flick opens it, and the Profiler shows no per-frame
  re-render of `Home`.
