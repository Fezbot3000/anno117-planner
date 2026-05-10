// Population → demand calculator.
//
// Source semantics (verified against anno-mods/anno-117-calculator
// src/consumption.ts):
//
//   need.amount (t/min) = residences × needConsumptionRate × consumptionFactor
//   residents per residence = sum over met needs of need.needAttributes.Population
//
// We assume the player meets every consumable need of a tier (i.e. residence
// is at maximum capacity). The user can deselect needs to model partial
// satisfaction. consumptionFactor defaults to 1.0 (the game's "Standard" setting).

import { NEEDS, RESIDENCES, TIERS, type RegionId, type Residence, type TierId } from '../data/game';

export interface TierPlan {
  /** Tier id (e.g. 'liberti'). */
  tier: TierId;
  /** Residence asset for this tier. */
  residence: Residence;
  /** Population the user wants on this tier. */
  population: number;
  /** Need GUIDs the user has chosen NOT to provide. */
  disabledNeeds: number[];
}

export interface NeedDemand {
  needGuid: number;
  needName: string;
  category: string;
  /** Population value of this need. */
  population: number;
  /** Product GUID consumed; null for service needs. */
  product: number | null;
  ratePerResidence: number; // t/min per residence (0 for service needs)
  /** Demand in t/min once we know how many residences exist. */
  totalDemand: number;
  isService: boolean;
}

export interface TierBreakdown {
  tier: TierId;
  region: RegionId;
  residence: Residence;
  /** Residents per residence assuming every selected need is met. */
  residentsPerResidence: number;
  residencesNeeded: number;
  actualPopulation: number; // residencesNeeded × residentsPerResidence
  needs: NeedDemand[];
}

export function computeTierBreakdown(plan: TierPlan): TierBreakdown {
  const residence = plan.residence;
  const tier = TIERS[plan.tier];
  const enabled = residence.needs.filter(n => !plan.disabledNeeds.includes(n.need));

  // residents per residence — only enabled needs count
  let residentsPerResidence = 0;
  for (const n of enabled) {
    const need = NEEDS[n.need];
    if (need) residentsPerResidence += need.population;
  }
  if (residentsPerResidence < 1) residentsPerResidence = 1; // sanity floor

  const residencesNeeded = Math.ceil(plan.population / residentsPerResidence);
  const actualPopulation = residencesNeeded * residentsPerResidence;

  const needs: NeedDemand[] = residence.needs.map(n => {
    const need = NEEDS[n.need];
    const isEnabled = enabled.some(e => e.need === n.need);
    const rate = n.rate ?? 0;
    return {
      needGuid: n.need,
      needName: need?.name ?? `Need ${n.need}`,
      category: need?.category ?? 'Other',
      population: need?.population ?? 0,
      product: need?.product ?? null,
      ratePerResidence: rate,
      totalDemand: isEnabled ? rate * residencesNeeded : 0,
      isService: !need?.product,
    };
  });

  return {
    tier: plan.tier,
    region: tier.region,
    residence,
    residentsPerResidence,
    residencesNeeded,
    actualPopulation,
    needs,
  };
}

/** Aggregate demand across many tiers, by product. */
export function aggregateProductDemand(
  breakdowns: TierBreakdown[],
): Map<number, number> {
  const m = new Map<number, number>();
  for (const b of breakdowns) {
    for (const n of b.needs) {
      if (!n.product || n.totalDemand <= 0) continue;
      m.set(n.product, (m.get(n.product) ?? 0) + n.totalDemand);
    }
  }
  return m;
}

/** Default residence per tier id. */
export function residenceForTier(tier: TierId): Residence | null {
  // populationLevel GUIDs map back to tiers
  const lvlGuid = TIERS[tier].guid;
  return RESIDENCES.find(r => r.populationLevel === lvlGuid) ?? null;
}
