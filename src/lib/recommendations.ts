// Recommendation engine for the Population view's "Next steps" panel.
//
// The whole point of the planner is "what should I build next?" — this file
// turns the raw flow / workforce / gate data into an ordered, deduplicated
// list of concrete actions the user can take.
//
// Priority order (committed; do not silently re-rank):
//   1 Workforce shortage on any tier  (existing buildings will go idle)
//   2 Domestic shortfall, all inputs already in surplus  (one-click win)
//   3 Domestic shortfall, missing upstream  (multi-step but still doable)
//   4 Tier upgrade gate blocked  (progression locked)
//   5 Surplus with an unbuilt downstream consumer in this region
//   6 Over-build trim suggestion  (surplus > 0.5 t/min AND > 25 % of demand)
//   7 Cross-province import  (no producer in this region — separate workflow)
//
// Each `Recommendation` carries everything the UI needs to render the row
// AND, when applicable, a one-click `action` payload describing the state
// change. The UI never has to recompute priorities or repeat data lookups.

import {
  FACTORIES, PRODUCTS, TIERS,
  type Factory, type RegionId, type TierId,
} from '../data/game';
import type { FlowEntry } from './materialFlows';
import type { GateStatus } from './tierGates';

export type RecKind =
  | 'workforce-shortage'      // P1
  | 'shortfall-easy'          // P2
  | 'shortfall-chain'         // P3
  | 'upgrade-blocked'         // P4
  | 'surplus-downstream'      // P5
  | 'overbuild-trim'          // P6
  | 'shortfall-import';       // P7

/** Ordered weight; lower = more urgent. Used as the primary sort key. */
const PRIORITY: Record<RecKind, number> = {
  'workforce-shortage':  1,
  'shortfall-easy':      2,
  'shortfall-chain':     3,
  'upgrade-blocked':     4,
  'surplus-downstream':  5,
  'overbuild-trim':      6,
  'shortfall-import':    7,
};

export interface RecAction {
  /** 'build' increments built count by `delta`; 'trim' decrements it. */
  kind: 'build' | 'trim';
  factoryGuid: number;
  delta: number;
}

export interface Recommendation {
  /** Stable key for React lists / dedupe. */
  id: string;
  kind: RecKind;
  /** Short imperative headline, e.g. "Build Vintner". */
  title: string;
  /** One-sentence reason: what this fixes and the size of the gap. */
  detail: string;
  /** Optional one-click change. Absent for advisory rows (e.g. imports). */
  action?: RecAction;
  /** Free-form severity within a kind — bigger = more urgent secondary sort. */
  weight: number;
}

/** Inputs the engine needs. All are already computed by PopulationView. */
export interface RecInputs {
  region: RegionId;
  /** Per-factory built count, mirrors PopState.built. */
  built: Record<number, number>;
  /** Output of computeFlows — already includes resident demand. */
  flows: FlowEntry[];
  /** Workforce supply from population (residents × factor). */
  workforceSupply: Partial<Record<TierId, number>>;
  /** Workforce already employed by built factories. */
  workforceEmployed: Partial<Record<TierId, number>>;
  /** Tier upgrade gate evaluations, keyed by the destination tier. */
  tierGates: Partial<Record<TierId, GateStatus | null>>;
  /** Tiers the user has population on. Drives "is this gate worth flagging?" */
  populatedTiers: Set<TierId>;
  /** All tiers active in the current region (for naming gate sources). */
  tierIds: TierId[];
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Pick the canonical producer for a product in a region. Sorted: in-region
 * first, then fewest inputs (i.e. simplest chain — usually a raw farm
 * before a processed product). Returns null if nothing produces it here.
 */
function pickProducer(productGuid: number, region: RegionId): Factory | null {
  const candidates = Object.values(FACTORIES)
    .filter(f =>
      f.regions.includes(region) &&
      f.outputs.some(o => o.product === productGuid),
    )
    .sort((a, b) => a.inputs.length - b.inputs.length);
  return candidates[0] ?? null;
}

/** Map product GUID → flow entry, for cheap lookup during input-availability checks. */
function indexFlows(flows: FlowEntry[]): Map<number, FlowEntry> {
  const m = new Map<number, FlowEntry>();
  for (const f of flows) m.set(f.productGuid, f);
  return m;
}

/**
 * Decide whether building one of `f` would be an "easy win": every input it
 * needs is already produced in surplus by at least the amount this factory
 * would draw. If any input would tip into shortfall, it's a chain build.
 */
function inputsAlreadyAvailable(f: Factory, flowIdx: Map<number, FlowEntry>): boolean {
  for (const i of f.inputs) {
    const draw = (i.amount * 60) / f.cycleTime;
    const flow = flowIdx.get(i.product);
    const available = flow ? Math.max(0, flow.net) : 0;
    if (available + 1e-6 < draw) return false;
  }
  return true;
}

// --------------------------------------------------------------------------
// Engine
// --------------------------------------------------------------------------

export function computeRecommendations(inp: RecInputs): Recommendation[] {
  const recs: Recommendation[] = [];
  const flowIdx = indexFlows(inp.flows);

  // ---- 1. Workforce shortage --------------------------------------------
  // Buildings the user has placed need more workers than the population
  // supplies at that tier. Surfaced first because it actively breaks
  // production (game will idle factories without staff).
  for (const t of inp.tierIds) {
    const supply = inp.workforceSupply[t] ?? 0;
    const employed = inp.workforceEmployed[t] ?? 0;
    const gap = employed - supply;
    if (gap > 0) {
      recs.push({
        id: `workforce-${t}`,
        kind: 'workforce-shortage',
        title: `${TIERS[t].name} workforce shortage`,
        detail: `Built buildings need ${employed} workers; population only supplies ${supply}. Add ${gap} more residents or trim ${gap} workers' worth of factories.`,
        weight: gap,
      });
    }
  }

  // ---- 2 & 3. Domestic shortfalls ---------------------------------------
  // Per shortfall good, choose the canonical region producer and decide
  // whether building +1 of it is a one-click fix or part of a longer chain.
  // Cross-province goods (no in-region producer) drop into bucket 7 below.
  for (const flow of inp.flows) {
    if (flow.net >= -0.001) continue; // only shortfalls
    const product = PRODUCTS[flow.productGuid];
    const producer = pickProducer(flow.productGuid, inp.region);

    if (!producer) {
      // No producer at all in this region → cross-province import (bucket 7).
      recs.push({
        id: `import-${flow.productGuid}`,
        kind: 'shortfall-import',
        title: `Import ${product?.name ?? `#${flow.productGuid}`}`,
        detail: `Short ${(-flow.net).toFixed(2)} t/min. Not produced in ${inp.region} — set up a trade route from the other province.`,
        weight: -flow.net,
      });
      continue;
    }

    const easy = inputsAlreadyAvailable(producer, flowIdx);
    recs.push({
      id: `shortfall-${flow.productGuid}`,
      kind: easy ? 'shortfall-easy' : 'shortfall-chain',
      title: `Build ${producer.name}`,
      detail: easy
        // When inputs are already in surplus, building one immediately
        // moves the needle. Quote the current shortfall size so the user
        // knows whether one is enough.
        ? `Fixes ${product?.name} shortfall (${(-flow.net).toFixed(2)} t/min). Inputs already in surplus — one-click win.`
        // Otherwise this is the FIRST step of a chain. The user will see
        // new chain shortfalls after building, which the engine will then
        // surface in priority order on the next render.
        : `Short ${(-flow.net).toFixed(2)} t/min of ${product?.name}. Needs upstream chain — ${producer.inputs.map(i => PRODUCTS[i.product]?.name ?? '?').join(', ')} not yet supplied.`,
      action: { kind: 'build', factoryGuid: producer.guid, delta: 1 },
      weight: -flow.net,
    });
  }

  // ---- 4. Upgrade gate blocked ------------------------------------------
  // Surfaced when the user has population on tier T but the gate to T+1
  // isn't met. Advisory only — there's no single click that fixes a gate
  // (it's a fan-out of several need toggles + production decisions).
  for (const [toTier, status] of Object.entries(inp.tierGates) as [TierId, GateStatus | null][]) {
    if (!status || status.met) continue;
    // Only flag if the previous tier has population (otherwise it's the
    // expected locked state for a tier the user hasn't started).
    const prevIdx = inp.tierIds.indexOf(toTier) - 1;
    const prev = prevIdx >= 0 ? inp.tierIds[prevIdx] : null;
    if (!prev || !inp.populatedTiers.has(prev)) continue;
    recs.push({
      id: `gate-${toTier}`,
      kind: 'upgrade-blocked',
      title: `${TIERS[toTier].name} upgrade blocked`,
      detail: `Need ${status.gate.pointsPerCategory} pt${status.gate.pointsPerCategory > 1 ? 's' : ''} in ${
        status.missing.length === 0 ? 'every category' : status.missing.join(', ')
      } from ${TIERS[prev].name} before residences will upgrade.`,
      weight: status.missing.length, // more missing categories = more urgent
    });
  }

  // ---- 5. Surplus with unbuilt downstream consumer ----------------------
  // The Limestone → Concrete Mixer case. Only flag if there's at least one
  // consumer factory in this region that the user hasn't built. Skips
  // construction-material pure surpluses where the consumer doesn't exist.
  for (const flow of inp.flows) {
    if (flow.net <= 0.001) continue;
    const product = PRODUCTS[flow.productGuid];
    const consumers = Object.values(FACTORIES).filter(f =>
      f.regions.includes(inp.region) &&
      f.inputs.some(io => io.product === flow.productGuid) &&
      (inp.built[f.guid] ?? 0) === 0,
    );
    if (consumers.length === 0) continue;
    // Pick the simplest consumer (fewest other inputs) so the suggestion
    // is the easiest extension, not a complex multi-input downstream.
    consumers.sort((a, b) => a.inputs.length - b.inputs.length);
    const c = consumers[0];
    recs.push({
      id: `downstream-${flow.productGuid}`,
      kind: 'surplus-downstream',
      title: `Build ${c.name}`,
      detail: `You have ${flow.net.toFixed(2)} t/min spare ${product?.name}. ${c.name} would use it to produce ${
        c.outputs.map(o => PRODUCTS[o.product]?.name ?? '?').join(', ')
      }.`,
      action: { kind: 'build', factoryGuid: c.guid, delta: 1 },
      weight: flow.net,
    });
  }

  // ---- 6. Over-build trim ----------------------------------------------
  // Surplus large enough to almost certainly be wasted: > 0.5 t/min AND
  // > 25 % of demand. Excludes anything with zero demand (those are
  // covered by bucket 5 — a downstream offer — which is more useful).
  // Picks the largest single source contributor as the trim target.
  for (const flow of inp.flows) {
    if (flow.totalDemand < 0.001) continue; // no demand → bucket 5's job
    if (flow.net <= 0.5) continue;
    if (flow.net <= flow.totalDemand * 0.25) continue;
    if (flow.supply.length === 0) continue;
    // Largest single supplier is the most reasonable trim. Trim count is
    // the minimum that still leaves us non-negative on net.
    const biggest = [...flow.supply].sort((a, b) => b.ratePerMin - a.ratePerMin)[0];
    const perBuilding = biggest.ratePerMin / Math.max(1, biggest.count);
    const trimCount = Math.min(
      biggest.count,
      Math.max(1, Math.floor(flow.net / Math.max(perBuilding, 1e-6))),
    );
    if (trimCount < 1) continue;
    recs.push({
      id: `trim-${flow.productGuid}`,
      kind: 'overbuild-trim',
      title: `Trim ${trimCount}× ${biggest.factoryName}`,
      detail: `${PRODUCTS[flow.productGuid]?.name} surplus is ${flow.net.toFixed(2)} t/min — over-built. Removing ${trimCount} reclaims workforce and upkeep.`,
      action: { kind: 'trim', factoryGuid: biggest.factoryGuid, delta: -trimCount },
      weight: flow.net,
    });
  }

  // ---- Sort: priority bucket first, then weight desc within bucket -------
  recs.sort((a, b) => {
    const dp = PRIORITY[a.kind] - PRIORITY[b.kind];
    if (dp !== 0) return dp;
    return b.weight - a.weight;
  });

  return recs;
}
