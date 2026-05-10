# Anno 117 Planner — Overhaul Checklist

Source of truth for data: `anno-mods/anno-117-calculator` repo, file `js/params.js`
(canonical extraction from game files, dated 2025-11-21).

Cloned to `/tmp/anno117-data/anno-117-calculator`.

## Phase 1 — Data accuracy (DONE)

- [x] Built `scripts/extract.mjs`. Emits a single canonical `src/data/game.ts`
      (6743 lines, 144 factories, 145 products, 26 fertilities, 9 population tiers,
      9 residence buildings, all needs).
- [x] Old `chains.ts`, `buildings.ts`, `types.ts` deleted — they were hand-written
      and full of unverifiable ratios and fabricated construction costs.
- [x] All ratios are now computed at runtime from authoritative `cycleTime` in
      `src/lib/chain.ts` — never asserted in data.
- [x] TS compiles, vite build succeeds.

TRADE-OFF: construction costs (planks/tiles per building) are not in the data
dump — they are not part of the calculator's source data. The original app's
costs were fabricated. I removed them entirely rather than carry forward bad data.
The proper version would scrape Construction costs from the wiki or game XML.

TRADE-OFF: when a product has multiple producers in a region (e.g. Coal can come
from Charcoal Burner OR Coal Mine), the chain auto-picks the lowest-tier / fastest
factory. There's no UI yet to override this per-chain. Alternatives are shown as
a hint on the root factory card. The proper version would let the user pin a
specific factory per product per island.

## Phase 2 — Visual + UX (DONE for v1)

- [x] App rewritten from scratch around the new data. The old App.tsx with all
      its bugs is gone:
      - dead `× {count === 1 ? '' : ''}` ternary — gone
      - bogus region filter logic — replaced with simple `'all' | RegionId` filter
      - mis-tiered Olive Oil and other hand-classification errors — gone, tier
        comes from the producing factory's workforce requirement
      - tier order in sidebar — Latium tiers, then Albion tiers, in canonical order
      - bogus construction costs — removed (see trade-off above)
- [x] Two clean tabs: Goods and Islands
- [x] Header shows data version stamp.

## Phase 3 — Island planner (DONE for v1)

- [x] Add island (Latium or Albion).
- [x] Toggle deposits and fertilities the island has.
- [x] Add production targets (good + t/min); remove and edit them.
- [x] Per-island totals: total buildings, upkeep, workforce by tier, deposits
      satisfied vs missing.
- [x] Auto-warning when a target needs a deposit the island doesn't have.
- [x] "Worth commandeering" recommendation panel: lists goods this island
      uniquely unlocks (deposits no other island in your plan has).
- [x] Persisted to localStorage (`anno117-planner.islands.v1`).

## Pending / future work

- [ ] Pin alternative producers per chain (override Charcoal Burner vs Coal Mine).
- [ ] Show the residence/needs side of the calculation: how many Plebeians can a
      given upkeep/output support.
- [ ] Add construction-cost data once we have an authoritative source.
- [ ] Mobile/narrow viewport polish (current layout is desktop-first).
- [ ] Recompute extractor when a new params.js is published.

## Out-of-scope findings (record only, do not action)

(to be added during Phase 2)
