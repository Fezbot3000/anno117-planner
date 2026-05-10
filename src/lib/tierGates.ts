// Tier-upgrade gate rules for Anno 117: Pax Romana.
//
// Source (verified, official): Anno Union dev blog, "Getting started in
// Anno 117: Pax Romana" — https://www.anno-union.com/getting-started-in-anno-117-pax-romana/
// Quote (T1→T2):
//   "When you have supplied your residences with at least the minimal number
//    of needs (for Tier 1, Liberti or Waders, that's fulfilling one need per
//    each of the three categories) the upgrade button with the arrow will
//    become available."
// Quote (T2→T3):
//   "To progress beyond Tier 2, you will need to fulfill needs worth three
//    supply points in each category. Tier 1 needs provide one such point each,
//    Tier 2 needs provide two points each."
//
// Cross-confirmed by polygon.com, gamerant.com, aelgames.com.
//
// IMPORTANT: there are NO population-number gates in Anno 117 (unlike older
// Anno games). The gate is needs-fulfillment by category. The "200 Liberti
// unlocks Plebeians" rule of thumb floating around online is from Anno 1404
// / 1800 and does not apply here.

import { NEEDS, RESIDENCES, TIERS, type TierId } from '../data/game';

export interface TierGate {
  /** Which tier you're upgrading FROM (the tier whose needs must be met). */
  fromTier: TierId;
  /** Which tier you upgrade TO. */
  toTier: TierId;
  /** Categories that must each meet the point threshold. */
  requiredCategories: string[];
  /** Minimum supply points per category. */
  pointsPerCategory: number;
}

/**
 * Tier order in each region. For Albion T2 the player chooses Smiths (Celtic)
 * OR Mercators (Roman) — both are tier 2 for gate purposes. We treat them
 * as parallel branches.
 */
export const ROMAN_TIER_ORDER: TierId[] = ['liberti', 'plebeians', 'equites', 'patricians'];
export const CELTIC_TIER_ORDER: TierId[] = ['waders', 'smiths', 'aldermen'];
export const ROMANIZED_ALBION_TIER_ORDER: TierId[] = ['waders', 'mercators', 'nobles'];

/**
 * The gate the user must satisfy to upgrade FROM `fromTier`.
 * Returns null if `fromTier` is the top of its region.
 */
export function gateForUpgrade(fromTier: TierId, nextTier: TierId): TierGate | null {
  const tierIdx = tierIndex(fromTier);
  if (tierIdx < 0) return null;
  // Tier 1 → Tier 2: 3 categories, 1 point each. (Verified Anno Union.)
  if (tierIdx === 0) {
    return {
      fromTier, toTier: nextTier,
      requiredCategories: ['Food', 'Public', 'Fashion'],
      pointsPerCategory: 1,
    };
  }
  // Tier 2 → Tier 3: 4 categories, 3 points each. (Verified Anno Union.)
  if (tierIdx === 1) {
    return {
      fromTier, toTier: nextTier,
      requiredCategories: ['Food', 'Public', 'Fashion', 'Household'],
      pointsPerCategory: 3,
    };
  }
  // Tier 3 → Tier 4: pattern continues per Anno Union ("you will need to
  // fulfill needs worth … points in each category"), but the *exact* point
  // threshold and category list for T3→T4 is NOT explicitly stated in the
  // dev blog. Community sources (gamerant, aelgames) confirm the pattern
  // continues with progressively more points and same/expanded categories.
  // ASSUMPTION (flagged): same 4 categories, 3 points each, with T3 needs
  // contributing 3 points each. Adjust here if you find authoritative data.
  if (tierIdx === 2) {
    return {
      fromTier, toTier: nextTier,
      requiredCategories: ['Food', 'Public', 'Fashion', 'Household'],
      pointsPerCategory: 3,
    };
  }
  return null;
}

function tierIndex(tier: TierId): number {
  for (const order of [ROMAN_TIER_ORDER, CELTIC_TIER_ORDER, ROMANIZED_ALBION_TIER_ORDER]) {
    const idx = order.indexOf(tier);
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * The "native" tier of a need = the lowest-tier residence that lists it.
 * Used to compute supply points (T1 need = 1pt, T2 = 2pt, etc.).
 */
export function nativeTierForNeed(needGuid: number): number {
  let best = Infinity;
  for (const r of RESIDENCES) {
    if (!r.needs.some(n => n.need === needGuid)) continue;
    // Map residence.populationLevel back to tier index.
    for (const order of [ROMAN_TIER_ORDER, CELTIC_TIER_ORDER, ROMANIZED_ALBION_TIER_ORDER]) {
      for (let i = 0; i < order.length; i++) {
        if (TIERS[order[i]].guid === r.populationLevel) {
          if (i < best) best = i;
        }
      }
    }
  }
  return best === Infinity ? 0 : best;
}

export interface GateStatus {
  gate: TierGate;
  /** Per-category accumulated points from enabled needs. */
  pointsByCategory: Record<string, number>;
  /** Categories that fall short of the threshold. */
  missing: string[];
  met: boolean;
}

/**
 * Evaluate whether the gate to upgrade from `fromTier` is met given the user's
 * enabled needs at that tier. Points = nativeTier(need)+1 (T1=1pt, T2=2pt, T3=3pt).
 * `enabledNeedGuids` is the set of needs the user is actively fulfilling.
 */
export function evaluateGate(
  gate: TierGate,
  enabledNeedGuids: number[],
): GateStatus {
  const points: Record<string, number> = {};
  for (const cat of gate.requiredCategories) points[cat] = 0;
  for (const guid of enabledNeedGuids) {
    const need = NEEDS[guid];
    if (!need || !need.category) continue;
    if (!(need.category in points)) continue;
    const pts = nativeTierForNeed(guid) + 1;
    points[need.category] += pts;
  }
  const missing = gate.requiredCategories.filter(c => points[c] < gate.pointsPerCategory);
  return {
    gate,
    pointsByCategory: points,
    missing,
    met: missing.length === 0,
  };
}
