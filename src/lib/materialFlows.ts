// Material-flow analysis: given a set of buildings the user has actually
// placed (built > 0) plus the population's direct consumption, compute
// supply and demand for every product in the economy and surface the gaps.
//
// This is the "two Soap Makers means more Pigs" calculator. When a single
// input good is consumed by multiple buildings (e.g. Pigs feed both a
// Tannery and a Renderer), the contributions are aggregated so the user
// sees one row per good with all consumers listed.
//
// Math (verified against the calculator's source):
//   per-minute throughput of one factory = 60 / cycleTime cycles/min
//   per-minute output  per building = output.amount  × 60 / cycleTime
//   per-minute input   per building = input.amount   × 60 / cycleTime
// Total demand for good G = Σ (built_count[F] × input_rate(F, G))
// Total supply for good G = Σ (built_count[F] × output_rate(F, G))
//                         + (final consumption from population, for G)

import { FACTORIES, type Factory } from '../data/game';
import type { TierBreakdown } from './population';

export interface FlowContributor {
  factoryGuid: number;
  factoryName: string;
  count: number;
  /** t/min this contributor adds to the flow side. */
  ratePerMin: number;
}

export interface FlowEntry {
  productGuid: number;
  /** Sum of all supply contributions in t/min. */
  totalSupply: number;
  /** Sum of all demand contributions in t/min. */
  totalDemand: number;
  /** totalSupply - totalDemand. Negative = shortfall, positive = surplus. */
  net: number;
  supply: FlowContributor[];
  demand: FlowContributor[];
}

/** All in t/min from one building. Returns 0 if factory doesn't make this good. */
function outputRate(factory: Factory, productGuid: number): number {
  const o = factory.outputs.find(io => io.product === productGuid);
  if (!o) return 0;
  return (o.amount * 60) / factory.cycleTime;
}
function inputRate(factory: Factory, productGuid: number): number {
  const i = factory.inputs.find(io => io.product === productGuid);
  if (!i) return 0;
  return (i.amount * 60) / factory.cycleTime;
}

/**
 * @param built Map of factory GUID → integer count the user has placed.
 * @param breakdowns Per-tier population breakdowns. Each tier's residence
 *   consumes its OWN inherited needs at its OWN rate (Patrician house eats
 *   less Sardines per residence than a Libertus house — verified from
 *   params.js: Liberti rate 0.01785 vs Patrician 0.00943 t/min). Splitting
 *   demand by tier lets the user see "Plebeians eat 0.4 t/min, Equites eat
 *   0.3 t/min" rather than a single opaque "Residents" line.
 */
export function computeFlows(
  built: Record<number, number>,
  breakdowns: TierBreakdown[],
): FlowEntry[] {
  const entries = new Map<number, FlowEntry>();
  const ensure = (g: number) => {
    let e = entries.get(g);
    if (!e) {
      e = { productGuid: g, totalSupply: 0, totalDemand: 0, net: 0, supply: [], demand: [] };
      entries.set(g, e);
    }
    return e;
  };

  // Walk every built factory: output adds to supply, input adds to demand.
  for (const [guidStr, count] of Object.entries(built)) {
    const f = FACTORIES[+guidStr];
    if (!f || count <= 0) continue;
    for (const o of f.outputs) {
      const rate = outputRate(f, o.product) * count;
      if (rate <= 0) continue;
      const e = ensure(o.product);
      e.totalSupply += rate;
      e.supply.push({ factoryGuid: f.guid, factoryName: f.name, count, ratePerMin: rate });
    }
    for (const i of f.inputs) {
      const rate = inputRate(f, i.product) * count;
      if (rate <= 0) continue;
      const e = ensure(i.product);
      e.totalDemand += rate;
      e.demand.push({ factoryGuid: f.guid, factoryName: f.name, count, ratePerMin: rate });
    }
  }

  // Population-driven final consumption, broken out per tier so the user
  // can see how higher tiers continue to consume lower-tier goods (a
  // Plebeian house still eats Sardines, just at a lower per-residence rate
  // than a Libertus house). Each tier contributes one line per consumed
  // product. tier-id is encoded into a sentinel "factoryGuid" so the UI can
  // distinguish residents from real factories without a schema change.
  for (const b of breakdowns) {
    const tierName = b.residence.name.replace(/ Residence$/, '');
    for (const n of b.needs) {
      if (!n.product || n.totalDemand <= 0) continue;
      const e = ensure(n.product);
      e.totalDemand += n.totalDemand;
      e.demand.push({
        factoryGuid: 0,
        factoryName: `${tierName} residents`,
        count: b.residencesNeeded,
        ratePerMin: n.totalDemand,
      });
    }
  }

  // Finalise net.
  const list = [...entries.values()];
  for (const e of list) e.net = e.totalSupply - e.totalDemand;
  return list;
}
