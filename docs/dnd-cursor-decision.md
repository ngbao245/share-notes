# DnD Cursor Decision — Pending

Status: PENDING discussion
Date: 2026-08-16
Affected: Progress kanban, Bookmark grid (any tool using `useFloatingDragPreview` + pragmatic-drag-and-drop)

## Problem

HTML5 Drag API (wrapped by `@atlaskit/pragmatic-drag-and-drop`) controls cursor at OS level during drag session. Cannot be overridden by CSS or JS.

Native cursor shown during drag:
- `dropEffect = 'move'` → "select area" cursor (arrow + white box) on Windows
- `dropEffect = 'copy'` → "select area plus" cursor (arrow + plus sign) on Windows
- No `getDropEffect` on drop target → defaults to 'copy' → inconsistent cursors when pointer moves between targets

## Current state (after partial fix 2026-08-16)

- Added `getDropEffect: () => 'move'` to both card AND column drop targets → cursor consistent
- Cursor is now consistently native "move" icon during drag (arrow + box on Windows)
- Idle hover shows CSS `cursor-grab` (hand open) — this works fine outside drag session

## User requirement

Wants cursor to be grab/grabbing (hand) during drag, not native OS icons.

## Options discussed

### A) Accept native move cursor (current state)
- Consistent, no jumping
- Same as Jira, Trello, Linear, Notion (all use HTML5 drag)
- No extra effort

### B) Rewrite to pointer events (full cursor control)
- Remove `draggable()`, `dropTargetForElements()`, `monitorForElements()` from pragmatic element/adapter
- Keep `attachClosestEdge`, `extractClosestEdge` from pragmatic hitbox (pure math, no HTML5 dependency)
- Implement: pointerdown/pointermove/pointerup + setPointerCapture + elementsFromPoint collision
- Full cursor control via CSS (grabbing during drag)
- Tradeoff: lose HTML5 drag accessibility (screen reader), must implement auto-scroll, cross-browser pointer edge cases
- Effort: ~2-3h Progress, ~3-4h Bookmark

### C) Style injection (FAILED)
- `<style>* { cursor: grabbing !important }</style>` during drag
- Does NOT work — OS-level cursor overrides all CSS during HTML5 drag session
- Tested and confirmed fail on Windows/Chrome

## Decision

TBD — discuss later.
