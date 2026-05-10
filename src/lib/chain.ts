// Chain computation. All ratios are derived from authoritative cycleTime data
// in src/data/game.ts — never hard-coded.

import { FACTORIES, FACTORIES_BY_OUTPUT, PRODUCTS, type Factory, type RegionId, type TierId } from '../data/game';

export interface ChainNode {
  factory: Factory;
  /** Fractional count of this factory required to satisfy demand. */
  count: number;
  /** Tons-per-minute of the *output* this node is producing. */
  ratePerMin: number;
  /** Children supplying the inputs of this factory. */
  children: ChainNode[];
}

export interface ChainTotals {
  factoryGuids: number[];        // unique
  factoryCounts: Record<number, number>; // sum of fractional counts
  denariiPerMin: number;
  workforce: Partial<Record<TierId, number>>;
  fertilities: Set<number>;
}

const TIER_ORDER: TierId[] = [
  'liberti', 'plebeians', 'equites', 'patricians',
  'waders', 'smiths', 'aldermen', 'mercators', 'nobles',
];
const tierIdx = (t: TierId | null) => (t ? TIER_ORDER.indexOf(t) : 99);

/**
 * Choose the canonical producing factory for a product within a region.
 * If a product has multiple producers (e.g. Coal: Charcoal Burner OR Coal Mine,
 * or both regions for shared goods), we pick the one with:
 *   1. matching region (or 'both')
 *   2. lowest workforce tier (easiest to unlock)
 *   3. shortest cycle time (most efficient)
 */
export function pickFactoryForProduct(
  productGuid: number,
  region: RegionId,
  preferences?: Record<number, number>, // productGuid → preferred factory guid
): Factory | null {
  if (preferences?.[productGuid]) {
    const f = FACTORIES[preferences[productGuid]];
    if (f) return f;
  }
  const candidates = (FACTORIES_BY_OUTPUT[productGuid] ?? [])
    .map(g => FACTORIES[g])
    .filter(f => f.regions.includes(region) || f.regions.includes('both'));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const ti = tierIdx(a.workforceTier) - tierIdx(b.workforceTier);
    if (ti !== 0) return ti;
    return a.cycleTime - b.cycleTime;
  });
  return candidates[0];
}

/**
 * List every factory in any region that can produce the given product.
 * Used for "alternatives" hints in the UI.
 */
export function alternativesForProduct(productGuid: number): Factory[] {
  return (FACTORIES_BY_OUTPUT[productGuid] ?? []).map(g => FACTORIES[g]);
}

/**
 * Build a chain tree for producing `ratePerMin` tons of `productGuid`'s
 * output, in the given region.
 *
 * For factory F producing `output.amount` per `cycleTime` seconds:
 *   throughput per factory = output.amount * 60 / cycleTime  (t/min)
 *   factories needed       = demand / throughput
 *
 * Each input is then required at `factories * input.amount * 60 / cycleTime` t/min.
 */
export function buildChain(
  productGuid: number,
  region: RegionId,
  ratePerMin: number,
  preferences?: Record<number, number>,
  visited: Set<number> = new Set(),
): ChainNode | null {
  const factory = pickFactoryForProduct(productGuid, region, preferences);
  if (!factory) return null;
  if (visited.has(factory.guid)) return null; // cycle guard (shouldn't happen)
  visited = new Set(visited);
  visited.add(factory.guid);

  const out = factory.outputs.find(o => o.product === productGuid);
  if (!out) return null;
  const throughput = (out.amount * 60) / factory.cycleTime;
  const count = ratePerMin / throughput;

  const children: ChainNode[] = [];
  for (const input of factory.inputs) {
    const inputRate = (count * input.amount * 60) / factory.cycleTime;
    const child = buildChain(input.product, region, inputRate, preferences, visited);
    if (child) children.push(child);
  }

  return { factory, count, ratePerMin, children };
}

/** Walk the tree and aggregate totals. Multiple uses of the same factory sum up. */
export function totalsForChain(root: ChainNode): ChainTotals {
  const factoryCounts: Record<number, number> = {};
  const fertilities = new Set<number>();

  const walk = (n: ChainNode) => {
    factoryCounts[n.factory.guid] = (factoryCounts[n.factory.guid] ?? 0) + n.count;
    if (n.factory.fertility) fertilities.add(n.factory.fertility);
    for (const c of n.children) walk(c);
  };
  walk(root);

  let denariiPerMin = 0;
  const workforce: Partial<Record<TierId, number>> = {};
  for (const [guidStr, count] of Object.entries(factoryCounts)) {
    const f = FACTORIES[+guidStr];
    // upkeep is per-minute regardless of count, but only paid when running.
    // We bill the integer-rounded-up count since you actually build whole buildings.
    const wholeCount = Math.ceil(count - 1e-9);
    denariiPerMin += f.denarii * wholeCount;
    if (f.workforceTier) {
      workforce[f.workforceTier] = (workforce[f.workforceTier] ?? 0) + f.workforceAmount * wholeCount;
    }
  }

  return {
    factoryGuids: Object.keys(factoryCounts).map(Number),
    factoryCounts,
    denariiPerMin,
    workforce,
    fertilities,
  };
}

/** Round a fractional factory count to the smallest count that meets demand. */
export const wholeBuildings = (count: number) => Math.ceil(count - 1e-9);

/** Pretty-print a fractional count, e.g. 1.333 → "1⅓" or "2 (1.33)". */
export function formatCount(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export interface GoodEntry {
  productGuid: number;
  productName: string;
  region: RegionId;
  /** Canonical producer used for tier-grouping in the sidebar. */
  producer: Factory;
}

/**
 * All goods the player can plan production for, deduped by (product, region).
 * Construction materials are included — tiles, planks, marble, granite etc.
 */
export function planableGoods(region: RegionId | 'all'): GoodEntry[] {
  const out: GoodEntry[] = [];
  const seen = new Set<string>(); // key = product:region
  for (const f of Object.values(FACTORIES)) {
    for (const o of f.outputs) {
      const prod = PRODUCTS[o.product];
      if (!prod || prod.isAbstract) continue;
      for (const r of f.regions) {
        if (region !== 'all' && r !== region) continue;
        const key = `${o.product}:${r}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const producer = pickFactoryForProduct(o.product, r);
        if (!producer) continue;
        out.push({ productGuid: o.product, productName: prod.name, region: r, producer });
      }
    }
  }
  out.sort((a, b) => a.productName.localeCompare(b.productName));
  return out;
}

export { TIER_ORDER };
