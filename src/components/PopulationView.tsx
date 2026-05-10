import { useMemo, useState } from 'react';
import { Users, MapPin, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import {
  PRODUCTS, FERTILITIES, FACTORIES, TIERS,
  type RegionId, type TierId,
} from '../data/game';
import {
  computeTierBreakdown, aggregateProductDemand, residenceForTier,
  type TierPlan, type TierBreakdown, type NeedDemand,
} from '../lib/population';
import { buildChain, totalsForChain, wholeBuildings, TIER_ORDER } from '../lib/chain';
import { gateForUpgrade, evaluateGate, type GateStatus } from '../lib/tierGates';
import { computeFlows, type FlowEntry } from '../lib/materialFlows';
import { ChainEditorModal } from './ChainEditorModal';

const TIER_DOT: Record<TierId, string> = {
  liberti: 'bg-emerald-400', plebeians: 'bg-blue-400', equites: 'bg-violet-400',
  patricians: 'bg-amber-300', waders: 'bg-teal-400', smiths: 'bg-orange-400',
  aldermen: 'bg-rose-400', mercators: 'bg-cyan-400', nobles: 'bg-pink-300',
};
const TIER_TEXT: Record<TierId, string> = {
  liberti: 'text-emerald-300', plebeians: 'text-blue-300', equites: 'text-violet-300',
  patricians: 'text-amber-200', waders: 'text-teal-300', smiths: 'text-orange-300',
  aldermen: 'text-rose-300', mercators: 'text-cyan-300', nobles: 'text-pink-200',
};
const CATEGORY_ORDER = ['Food', 'Drink', 'Public', 'Hygiene', 'Fashion', 'Faith', 'Entertainment', 'Other'];

const STORAGE_KEY = 'anno117-planner.population.v1';

interface PopState {
  region: RegionId;
  populations: Partial<Record<TierId, number>>;
  disabled: Partial<Record<TierId, number[]>>;
  /** Per-factory count of "I've already built this many in the game". */
  built: Record<number, number>;
}

const DEFAULT_STATE: PopState = {
  region: 'latium',
  populations: { liberti: 200, plebeians: 0 },
  disabled: {},
  built: {},
};

function loadState(): PopState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_STATE;
}
function saveState(s: PopState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

const TIERS_BY_REGION: Record<RegionId, TierId[]> = {
  latium: ['liberti', 'plebeians', 'equites', 'patricians'],
  albion: ['waders', 'smiths', 'aldermen', 'mercators', 'nobles'],
  both: [],
};

export function PopulationView() {
  const [state, setState] = useState<PopState>(() => loadState());
  const [expanded, setExpanded] = useState<Set<TierId>>(new Set());
  // Single root-level modal state. Any panel (Material Flows row, Building
  // row, anything else) calls this with a product + demand to open the
  // focused chain editor. Centralised so we have one modal, one truth.
  const [chainModal, setChainModal] = useState<{ productGuid: number; demand: number; kicker?: string } | null>(null);

  const update = (patch: Partial<PopState>) => {
    const next = { ...state, ...patch };
    setState(next);
    saveState(next);
  };

  const region = state.region;
  const tierIds = TIERS_BY_REGION[region];

  const breakdowns: TierBreakdown[] = useMemo(() => {
    const out: TierBreakdown[] = [];
    for (const t of tierIds) {
      const pop = state.populations[t] ?? 0;
      if (pop <= 0) continue;
      const residence = residenceForTier(t);
      if (!residence) continue;
      const plan: TierPlan = {
        tier: t,
        residence,
        population: pop,
        disabledNeeds: state.disabled[t] ?? [],
      };
      out.push(computeTierBreakdown(plan));
    }
    return out;
  }, [state, tierIds]);

  const productDemand = useMemo(() => aggregateProductDemand(breakdowns), [breakdowns]);

  // Build all the production chains
  const chains = useMemo(() => {
    const list: { product: number; demand: number; tree: ReturnType<typeof buildChain> }[] = [];
    for (const [product, demand] of productDemand) {
      const tree = buildChain(product, region, demand);
      list.push({ product, demand, tree });
    }
    list.sort((a, b) => (PRODUCTS[a.product]?.name ?? '').localeCompare(PRODUCTS[b.product]?.name ?? ''));
    return list;
  }, [productDemand, region]);

  // What the SUGGESTED plan calls for (driven by population needs). This is
  // the "you should build" view — independent of what the user has actually
  // placed.
  const suggested = useMemo(() => {
    const factoryCounts: Record<number, number> = {};
    const fertilities = new Set<number>();
    for (const c of chains) {
      if (!c.tree) continue;
      const totals = totalsForChain(c.tree);
      for (const [g, n] of Object.entries(totals.factoryCounts)) {
        factoryCounts[+g] = (factoryCounts[+g] ?? 0) + (n as number);
      }
      for (const f of totals.fertilities) fertilities.add(f);
    }
    let totalBuildings = 0;
    for (const n of Object.values(factoryCounts)) totalBuildings += wholeBuildings(n);
    return { factoryCounts, totalBuildings, fertilities };
  }, [chains]);

  // What's ACTUALLY built (suggested + any custom buildings the user added,
  // e.g. lumber camps, brickworks, military). Drives the workforce balance
  // and current upkeep — because a building that isn't placed isn't employing
  // anyone or costing denarii.
  const current = useMemo(() => {
    const workforce: Partial<Record<TierId, number>> = {};
    let denarii = 0;
    let totalBuilt = 0;
    for (const [g, n] of Object.entries(state.built)) {
      const f = FACTORIES[+g];
      if (!f || n <= 0) continue;
      totalBuilt += n;
      denarii += f.denarii * n;
      if (f.workforceTier) {
        workforce[f.workforceTier] = (workforce[f.workforceTier] ?? 0) + f.workforceAmount * n;
      }
    }
    return { workforce, denarii, totalBuilt };
  }, [state.built]);

  // Workforce supply from this population
  const workforceSupply = useMemo(() => {
    const m: Partial<Record<TierId, number>> = {};
    for (const t of tierIds) {
      const pop = state.populations[t] ?? 0;
      if (pop <= 0) continue;
      m[t] = Math.floor(pop * TIERS[t].workforceFactor);
    }
    return m;
  }, [state.populations, tierIds]);

  const totalResidences = breakdowns.reduce((s, b) => s + b.residencesNeeded, 0);
  const totalActualPopulation = breakdowns.reduce((s, b) => s + b.actualPopulation, 0);

  /** Goods that can't be made in this region — must be imported. */
  const imports = chains.filter(c => !c.tree);
  /** Tiers where industry needs more workers than residents can supply. */
  const workforceShortages = TIER_ORDER.filter(t => {
    if (!tierIds.includes(t)) return false;
    const supply = workforceSupply[t] ?? 0;
    const demand = current.workforce[t] ?? 0;
    return demand > supply && demand > 0;
  });

  /** How many of each factory the user still needs to construct. Negative
   *  numbers (over-built) clamp to 0 so the headline stays accurate. */
  const remainingByFactory: Record<number, number> = {};
  let totalRemaining = 0;
  let totalNeeded = 0;
  for (const [g, count] of Object.entries(suggested.factoryCounts)) {
    const needed = wholeBuildings(count as number);
    const built = state.built[+g] ?? 0;
    const remaining = Math.max(0, needed - built);
    remainingByFactory[+g] = remaining;
    totalRemaining += remaining;
    totalNeeded += needed;
  }

  /**
   * Material flows: per-product supply vs demand from EVERY built building
   * plus the population's final consumption. Surfaces shortfalls when one
   * input good is consumed by multiple downstream buildings (e.g. Pigs
   * feeding both Tannery and Renderer).
   */
  const flows = useMemo<FlowEntry[]>(
    () => computeFlows(state.built, breakdowns),
    [state.built, breakdowns],
  );

  /**
   * Build a plain-text snapshot of the user's current planner state and the
   * key derived numbers so they can paste it into a chat / issue and have
   * full context. Two sections:
   *   1. Human-readable summary — what they typed, what they've built, the
   *      headline workforce and material-flow numbers.
   *   2. Embedded JSON — the raw localStorage state, so it can be pasted
   *      back into another browser to reproduce exactly.
   */
  const buildExport = (): string => {
    const lines: string[] = [];
    lines.push('=== ANNO 117 PLANNER STATE ===');
    lines.push(`Region: ${region}`);
    lines.push('');
    lines.push('Population:');
    for (const t of tierIds) {
      const pop = state.populations[t] ?? 0;
      if (pop > 0) lines.push(`  ${TIERS[t].name}: ${pop}`);
    }
    lines.push(`  Total residences: ${totalResidences}`);
    lines.push('');

    lines.push('Workforce balance:');
    for (const t of tierIds) {
      if ((state.populations[t] ?? 0) <= 0) continue;
      const s = workforceSupply[t] ?? 0;
      const d = current.workforce[t] ?? 0;
      lines.push(`  ${TIERS[t].name}: ${s} supply / ${d} employed (${s - d >= 0 ? '+' : ''}${s - d})`);
    }
    lines.push('');

    lines.push('Built buildings:');
    const builtEntries = Object.entries(state.built)
      .map(([g, n]) => ({ f: FACTORIES[+g], n: n as number }))
      .filter(e => e.f && e.n > 0)
      .sort((a, b) => a.f.name.localeCompare(b.f.name));
    if (builtEntries.length === 0) lines.push('  (none)');
    for (const e of builtEntries) lines.push(`  ${e.n}× ${e.f.name}`);
    lines.push('');

    lines.push(`Disabled needs: ${
      Object.entries(state.disabled).filter(([, v]) => (v?.length ?? 0) > 0)
        .map(([t, v]) => `${t}=[${(v ?? []).join(',')}]`).join(' ') || '(none)'
    }`);
    lines.push('');

    const flowsForExport = flows
      .filter(f => f.totalSupply > 0.001 || f.totalDemand > 0.001)
      .sort((a, b) => a.net - b.net);
    const shortCount = flowsForExport.filter(f => f.net < -0.001).length;
    lines.push(`Material flows (${shortCount} shortfall${shortCount === 1 ? '' : 's'}, t/min):`);
    for (const f of flowsForExport) {
      const name = PRODUCTS[f.productGuid]?.name ?? `#${f.productGuid}`;
      const tag = f.net < -0.001 ? 'SHORT' : f.net > 0.001 ? 'surplus' : 'ok';
      lines.push(
        `  [${tag}] ${name}: supply ${f.totalSupply.toFixed(2)} / demand ${f.totalDemand.toFixed(2)} = ${f.net >= 0 ? '+' : ''}${f.net.toFixed(2)}`,
      );
      for (const c of f.supply) lines.push(`      + ${c.count}× ${c.factoryName}  +${c.ratePerMin.toFixed(2)}`);
      for (const c of f.demand) {
        const label = c.factoryGuid === 0 ? `${c.factoryName} (${c.count} houses)` : `${c.count}× ${c.factoryName}`;
        lines.push(`      - ${label}  -${c.ratePerMin.toFixed(2)}`);
      }
    }
    lines.push('');
    lines.push('--- raw state (for re-import) ---');
    lines.push(JSON.stringify(state));
    return lines.join('\n');
  };

  /** Copy the snapshot to the clipboard, with a tiny confirmation pulse. */
  const [exportFlash, setExportFlash] = useState<'idle' | 'ok' | 'err'>('idle');
  const onExport = async () => {
    const text = buildExport();
    try {
      await navigator.clipboard.writeText(text);
      setExportFlash('ok');
    } catch {
      // Fallback: dump into a textarea the user can copy from manually.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setExportFlash('ok'); }
      catch { setExportFlash('err'); }
      finally { document.body.removeChild(ta); }
    }
    setTimeout(() => setExportFlash('idle'), 1500);
  };

  /**
   * Compute the upgrade gate for each tier-pair. A tier T_{n+1} unlocks iff
   * the user's enabled needs at T_n meet the verified Anno Union rule
   * (≥1 need per category in 3 categories for T1→T2; ≥3 points per category
   * in 4 categories for T2+ → next, where T1=1pt, T2=2pt, T3=3pt).
   */
  const tierGates: Partial<Record<TierId, GateStatus | null>> = {};
  for (let i = 0; i < tierIds.length - 1; i++) {
    const from = tierIds[i];
    const to = tierIds[i + 1];
    const gate = gateForUpgrade(from, to);
    if (!gate) { tierGates[to] = null; continue; }
    const fromBreakdown = breakdowns.find(b => b.tier === from);
    if (!fromBreakdown) { tierGates[to] = null; continue; }
    const enabled = fromBreakdown.residence.needs
      .map(n => n.need)
      .filter(needGuid => !(state.disabled[from] ?? []).includes(needGuid));
    tierGates[to] = evaluateGate(gate, enabled);
  }

  /**
   * Open the chain modal for a given factory. We size the chain by the
   * demand on its primary output product (from `flows`); if no demand row
   * exists yet (e.g. brand-new factory the user just clicked) we fall back
   * to the factory's own per-building output rate so the modal is still
   * useful for inspection.
   */
  const openChainForFactory = (factoryGuid: number) => {
    const factory = FACTORIES[factoryGuid];
    if (!factory || factory.outputs.length === 0) return;
    const primary = factory.outputs[0];
    const flow = flows.find(f => f.productGuid === primary.product);
    const demand = flow && flow.totalDemand > 0.001
      ? flow.totalDemand
      : (primary.amount * 60) / factory.cycleTime; // fallback: 1 building's worth
    setChainModal({
      productGuid: primary.product,
      demand,
      kicker: `Chain to feed ${factory.name}`,
    });
  };

  const setBuilt = (factoryGuid: number, count: number) => {
    const next = { ...state.built };
    if (count <= 0) delete next[factoryGuid];
    else next[factoryGuid] = count;
    update({ built: next });
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="w-80 shrink-0 flex flex-col border-r border-white/8 bg-[#11131a] overflow-y-auto">
        <div className="p-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-2">Region</p>
            <div className="flex gap-1 bg-white/[0.04] border border-white/10 rounded-xl p-1">
              {(['latium', 'albion'] as RegionId[]).map(r => (
                <button
                  key={r}
                  onClick={() => update({ region: r })}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                    region === r ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/80'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-2">
              Population per tier
            </p>
            <div className="space-y-2">
              {tierIds.map((t, idx) => {
                const tier = TIERS[t];
                const pop = state.populations[t] ?? 0;
                // Lock rule: real Anno 117 upgrade gate (verified from Anno
                // Union dev blog; see src/lib/tierGates.ts for source quotes).
                // A tier is locked iff the previous tier's enabled needs do
                // NOT satisfy the gate. Self-engagement (pop>0 here) always
                // overrides — the user is in charge.
                const prevTier = idx > 0 ? tierIds[idx - 1] : null;
                const gate = tierGates[t] ?? null;
                const gateMet = !gate || gate.met;
                const locked = idx > 0 && pop === 0 && !gateMet;
                if (locked) {
                  return (
                    <button
                      key={t}
                      onClick={() => update({ populations: { ...state.populations, [t]: 1 } })}
                      className="w-full bg-white/[0.02] border border-dashed border-white/10 rounded-xl p-3 text-left hover:border-white/25 hover:bg-white/[0.04] transition-colors group"
                      title={`Satisfy the ${TIERS[prevTier!].name} upgrade gate, or click to unlock manually.`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full bg-white/15`} />
                        <span className="text-sm font-semibold text-white/35 group-hover:text-white/60">{tier.name}</span>
                        <span className="ml-auto text-[10px] text-white/25 group-hover:text-white/40">
                          🔒 unlock manually
                        </span>
                      </div>
                      {gate && (
                        <p className="text-[11px] text-white/30 mt-1.5 leading-snug">
                          Need {gate.gate.pointsPerCategory} pt
                          {gate.gate.pointsPerCategory > 1 ? 's' : ''} in
                          {' '}{gate.missing.length === 0
                            ? 'every category'
                            : gate.missing.join(', ')}
                          {' '}from {TIERS[prevTier!].name}.
                        </p>
                      )}
                      {!gate && (
                        <p className="text-[11px] text-white/25 mt-1.5 leading-snug">
                          Set {TIERS[prevTier!].name} population first.
                        </p>
                      )}
                    </button>
                  );
                }
                return (
                  <div key={t} className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2 h-2 rounded-full ${TIER_DOT[t]}`} />
                      <span className={`text-sm font-semibold ${TIER_TEXT[t]}`}>{tier.name}</span>
                      <span className="ml-auto text-[10px] text-white/30">
                        ×{tier.workforceFactor} → workforce
                      </span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={pop}
                      onChange={e => update({
                        populations: { ...state.populations, [t]: Math.max(0, +e.target.value || 0) },
                      })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-lg font-bold text-white tabular-nums focus:outline-none focus:border-white/30"
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-white/25 mt-2 leading-snug">
              Tiers unlock by satisfying needs at the previous tier — not by population
              numbers. Anno 117 changed this from older Anno games. T1→T2 needs ≥1 enabled
              need in 3 categories; T2→T3 needs ≥3 points per category in 4 categories
              (T1 needs = 1pt, T2 = 2pt). Click any locked tier to override.
            </p>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {breakdowns.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-12">
            <p className="text-5xl mb-6">👥</p>
            <h2 className="text-2xl font-bold text-white mb-3">Enter your population</h2>
            <p className="text-white/35 max-w-md text-sm leading-relaxed">
              Type how many people you want at each tier. The planner will work backwards
              and tell you how many farms, mills, and workshops you need to feed and clothe them.
            </p>
          </div>
        ) : (
          <div className="p-8 space-y-6 max-w-5xl">
            <header className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
                  To support {totalActualPopulation.toLocaleString()} residents in {region === 'latium' ? 'Latium' : 'Albion'}, you still need:
                </p>
                <h2 className="text-4xl font-black text-white tracking-tight mt-1 tabular-nums">
                  {totalRemaining === 0 ? (
                    <span className="text-emerald-300">All built ✓</span>
                  ) : (
                    <>{totalRemaining} more building{totalRemaining === 1 ? '' : 's'}</>
                  )}
                </h2>
                <p className="text-sm text-white/40 mt-1">
                  {totalNeeded - totalRemaining} of {totalNeeded} built · {totalResidences} houses · -{current.denarii.toLocaleString()} denarii/min upkeep right now
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={onExport}
                  className={`text-xs transition-colors px-3 py-1.5 rounded-lg border ${
                    exportFlash === 'ok'
                      ? 'text-emerald-200 border-emerald-400/50 bg-emerald-400/10'
                      : exportFlash === 'err'
                      ? 'text-rose-200 border-rose-400/50 bg-rose-400/10'
                      : 'text-white/50 hover:text-white border-white/10 hover:border-white/40'
                  }`}
                  title="Copy a full snapshot of your state + computed flows to the clipboard"
                >
                  {exportFlash === 'ok' ? 'Copied ✓' : exportFlash === 'err' ? 'Copy failed' : 'Export'}
                </button>
                {Object.keys(state.built).length > 0 && (
                  <button
                    onClick={() => update({ built: {} })}
                    className="text-xs text-white/35 hover:text-rose-300 transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-rose-400/40"
                  >
                    Reset progress
                  </button>
                )}
              </div>
            </header>

            {/* Workforce balance — always shown so the user can see their
                current situation. Supply = population × tier factor (e.g.
                Liberti 0.5). Demand = sum across BUILT factories' workforce
                requirements (so empty until they tick something). */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
                Workforce balance
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {tierIds.filter(t => (state.populations[t] ?? 0) > 0).map(t => {
                  const supply = workforceSupply[t] ?? 0;
                  const demand = current.workforce[t] ?? 0;
                  const ok = supply >= demand;
                  const ratio = demand === 0 ? 0 : Math.min(supply / demand, 1);
                  return (
                    <div key={t} className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-2 h-2 rounded-full ${TIER_DOT[t]}`} />
                        <span className={`text-sm font-semibold ${TIER_TEXT[t]}`}>{TIERS[t].name}</span>
                        <span className={`ml-auto text-xs font-bold tabular-nums ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {supply} / {demand || '–'}
                          {!ok && demand > 0 && <AlertTriangle size={11} className="inline ml-1 -mt-0.5" />}
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded overflow-hidden">
                        <div
                          className={`h-full transition-all ${ok ? 'bg-emerald-400/70' : 'bg-rose-400/70'}`}
                          style={{ width: `${(demand === 0 ? 1 : ratio) * 100}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-white/40">
                        {demand === 0
                          ? `${supply.toLocaleString()} workers free, no buildings placed yet`
                          : `${supply.toLocaleString()} workers, ${demand.toLocaleString()} employed by buildings you've placed`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Issues banner — only shown when something needs attention */}
            {(workforceShortages.length > 0 || imports.length > 0) && (
              <section className="bg-rose-500/8 border border-rose-400/30 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-rose-200 flex items-center gap-2">
                  <AlertTriangle size={12} />
                  Issues to resolve
                </p>
                {workforceShortages.map(t => {
                  const supply = workforceSupply[t] ?? 0;
                  const demand = current.workforce[t] ?? 0;
                  return (
                    <p key={t} className="text-sm text-white/80">
                      <span className={`font-semibold ${TIER_TEXT[t]}`}>{TIERS[t].name}</span> shortage:
                      industry needs {demand} workers, you only have {supply}. Add {demand - supply} more or reduce production.
                    </p>
                  );
                })}
                {imports.map(c => (
                  <p key={c.product} className="text-sm text-white/80">
                    <span className="font-semibold text-rose-200">{PRODUCTS[c.product]?.name}</span> can't be made in {region}
                    — import {c.demand.toFixed(2)} t/min via trade route.
                  </p>
                ))}
              </section>
            )}

            {/* The single primary answer: every factory across every chain,
                deduped (shared inputs like Salt summed once), grouped by which
                tier of worker can run it — i.e. by what you can build first. */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
                Buildings, by who staffs them
              </p>
              <div className="space-y-4">
                {(['(infra)', ...TIER_ORDER] as const).map(t => {
                  const tierFactories = Object.entries(suggested.factoryCounts)
                    .map(([g, count]) => ({ factory: FACTORIES[+g], count: count as number }))
                    .filter(({ factory }) => {
                      if (t === '(infra)') return !factory.workforceTier;
                      return factory.workforceTier === t;
                    });
                  if (tierFactories.length === 0) return null;
                  tierFactories.sort((a, b) => b.count - a.count);
                  const label = t === '(infra)' ? 'Infrastructure' : TIERS[t].name;
                  const colorText = t === '(infra)' ? 'text-stone-300' : TIER_TEXT[t];
                  const colorDot = t === '(infra)' ? 'bg-stone-400' : TIER_DOT[t];
                  return (
                    <div key={t}>
                      <p className={`text-[11px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-2 ${colorText}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${colorDot}`} />
                        {label} workforce
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        {tierFactories.map(({ factory, count }) => {
                          const needed = wholeBuildings(count);
                          const built = state.built[factory.guid] ?? 0;
                          return (
                            <BuildingRow
                              key={factory.guid}
                              factoryGuid={factory.guid}
                              needed={needed}
                              built={built}
                              onSetBuilt={(v) => setBuilt(factory.guid, v)}
                              onOpenChain={() => openChainForFactory(factory.guid)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Other buildings the user is tracking that aren't part of the
                population-driven suggested plan: lumber camps, brickworks,
                military, decoration, etc. They still count toward workforce
                demand and upkeep. */}
            <CustomBuildingsSection
              region={region}
              built={state.built}
              suggestedGuids={new Set(Object.keys(suggested.factoryCounts).map(Number))}
              unlockedTiers={new Set(tierIds.filter(t => (state.populations[t] ?? 0) > 0))}
              onSetBuilt={setBuilt}
              onOpenChain={openChainForFactory}
            />

            {/* Material flows — per-good supply vs demand sheet. Aggregates
                across every built building so shared inputs (e.g. Pigs used
                by both Tannery and Renderer) appear as one row with the
                full demand list. Shortfalls float to the top. */}
            <MaterialFlowsSection
              flows={flows}
              region={region}
              built={state.built}
              onSetBuilt={setBuilt}
            />

            {/* Drill-down: per-tier consumption with the only useful interactive
                control (toggle individual needs off/on). Closed by default so the
                primary view is simply "what to build". */}
            <details className="group">
              <summary className="cursor-pointer list-none">
                <span className="text-xs font-semibold uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors flex items-center gap-1.5">
                  <ChevronRight size={12} className="group-open:rotate-90 transition-transform" />
                  Adjust which needs you're meeting
                </span>
              </summary>
              <div className="mt-3 space-y-2">
                {breakdowns.map(b => (
                  <TierCard
                    key={b.tier}
                    breakdown={b}
                    expanded={expanded.has(b.tier)}
                    onToggle={() => {
                      const s = new Set(expanded);
                      if (s.has(b.tier)) s.delete(b.tier); else s.add(b.tier);
                      setExpanded(s);
                    }}
                    disabled={state.disabled[b.tier] ?? []}
                    onToggleNeed={(needGuid) => {
                      const cur = state.disabled[b.tier] ?? [];
                      const next = cur.includes(needGuid)
                        ? cur.filter(g => g !== needGuid)
                        : [...cur, needGuid];
                      update({ disabled: { ...state.disabled, [b.tier]: next } });
                    }}
                  />
                ))}
              </div>
            </details>

            {suggested.fertilities.size > 0 && (
              <section>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
                  Required deposits / fertilities
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[...suggested.fertilities].map(g => {
                    const f = FERTILITIES[g];
                    if (!f) return null;
                    return (
                      <span
                        key={g}
                        className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-400/30 text-amber-200 rounded-lg px-3 py-1.5 text-sm"
                      >
                        <MapPin size={12} />
                        {f.name}
                      </span>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
      {chainModal && (
        <ChainEditorModal
          productGuid={chainModal.productGuid}
          region={region}
          demandPerMin={chainModal.demand}
          builtCounts={state.built}
          onSetBuilt={setBuilt}
          onClose={() => setChainModal(null)}
          kicker={chainModal.kicker}
        />
      )}
    </div>
  );
}

function TierCard({
  breakdown, expanded, onToggle, disabled, onToggleNeed,
}: {
  breakdown: TierBreakdown;
  expanded: boolean;
  onToggle: () => void;
  disabled: number[];
  onToggleNeed: (needGuid: number) => void;
}) {
  const tier = TIERS[breakdown.tier];
  const groups: Record<string, NeedDemand[]> = {};
  for (const n of breakdown.needs) (groups[n.category] ??= []).push(n);

  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
        <span className={`w-2 h-2 rounded-full ${TIER_DOT[breakdown.tier]}`} />
        <span className={`text-sm font-semibold ${TIER_TEXT[breakdown.tier]}`}>{tier.name}</span>
        <span className="text-sm text-white/60 tabular-nums">{breakdown.actualPopulation.toLocaleString()}</span>
        <span className="text-xs text-white/35">in {breakdown.residencesNeeded} houses</span>
        <span className="ml-auto text-xs text-white/40">
          <Users size={11} className="inline mr-1 -mt-0.5" />
          {breakdown.residentsPerResidence}/house
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/8 pt-3">
          {CATEGORY_ORDER.filter(c => groups[c]).map(cat => (
            <div key={cat}>
              <p className="text-[10px] uppercase tracking-widest text-white/35 mb-1.5">{cat}</p>
              <div className="space-y-1">
                {groups[cat].map(n => {
                  const isDisabled = disabled.includes(n.needGuid);
                  return (
                    <button
                      key={n.needGuid}
                      onClick={() => onToggleNeed(n.needGuid)}
                      className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                        isDisabled
                          ? 'opacity-40 hover:opacity-70'
                          : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className={`w-3 h-3 rounded border ${
                        isDisabled ? 'border-white/30' : 'bg-emerald-400/70 border-emerald-400'
                      }`} />
                      <span className="text-white/85 flex-1 text-left">
                        {n.product ? PRODUCTS[n.product]?.name ?? n.needName : n.needName.replace(/^Need [A-Za-z]+ \w+ /, '')}
                      </span>
                      {n.population > 0 && (
                        <span className="text-[11px] text-emerald-300/70">+{n.population} pop</span>
                      )}
                      {n.product && !n.isService && (
                        <span className="text-xs text-white/55 tabular-nums w-24 text-right">
                          {n.totalDemand.toFixed(2)} t/min
                        </span>
                      )}
                      {n.isService && (
                        <span className="text-xs text-white/30 italic w-24 text-right">service</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Per-good supply vs demand sheet. Goods with shortfalls (negative net) float
 * to the top in red. Each row is expandable to show every building that
 * contributes to the supply or demand on that good — so when the user adds
 * a second Soap Maker, this is where they see "Pigs: 4 needed, 3 produced".
 */
function MaterialFlowsSection({
  flows, region, built, onSetBuilt,
}: {
  flows: FlowEntry[];
  region: RegionId;
  built: Record<number, number>;
  onSetBuilt: (factoryGuid: number, count: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Modal state — null when closed, otherwise the row the user clicked.
  // Carries the demand-rate snapshot at click-time so the modal sizes the
  // chain by the actual current shortfall (not "produce 1 t/min stub").
  const [modal, setModal] = useState<{ productGuid: number; demand: number } | null>(null);

  /**
   * Given a product GUID, find every factory in the current region that
   * outputs it. Ranked by simplest (fewest inputs) first, since for
   * construction goods the user usually wants the basic producer first.
   */
  const producersFor = (productGuid: number) => {
    return Object.values(FACTORIES)
      .filter(f =>
        f.regions.includes(region) &&
        f.outputs.some(o => o.product === productGuid),
      )
      .sort((a, b) => a.inputs.length - b.inputs.length);
  };

  /**
   * Inverse of producersFor: factories in the current region that take this
   * good as an INPUT. Used to surface downstream chains — when the user has
   * Limestone, they want Concrete Maker one click away. Construction-material
   * consumers don't show up in the supply/demand sheet on their own (the
   * planner only tracks ongoing per-minute flows, not one-off building costs)
   * so this is the only path to discovery in the Material Flows section.
   */
  const consumersFor = (productGuid: number) => {
    return Object.values(FACTORIES)
      .filter(f =>
        f.regions.includes(region) &&
        f.inputs.some(io => io.product === productGuid),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  // Hide goods where nothing's happening (no supply, no demand).
  const visible = flows
    .filter(f => f.totalSupply > 0.001 || f.totalDemand > 0.001)
    // Shortfalls first (most negative net), then surpluses, then zero-balance.
    .sort((a, b) => a.net - b.net);

  if (visible.length === 0) {
    return (
      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
          Material flows
        </p>
        <p className="text-xs text-white/30 italic">
          No buildings or population yet — nothing to balance.
        </p>
      </section>
    );
  }

  const shortfalls = visible.filter(f => f.net < -0.001).length;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
          Material flows {shortfalls > 0 && (
            <span className="ml-2 text-rose-300/80">— {shortfalls} shortfall{shortfalls === 1 ? '' : 's'}</span>
          )}
        </p>
      </div>
      <div className="space-y-1">
        {visible.map(f => {
          const product = PRODUCTS[f.productGuid];
          const isShort = f.net < -0.001;
          const isSurplus = f.net > 0.001;
          // Manually-toggled state takes precedence; otherwise shortfalls AND
          // surpluses are open by default. Shortfalls expose "+ Build producer"
          // upstream chips; surpluses expose "+ Used in" downstream chips
          // (e.g. Limestone surplus → one-click Concrete Maker). Zero-balance
          // rows stay closed because they're noise.
          const autoOpen = isShort || isSurplus;
          const userToggled = expanded.has(f.productGuid);
          const isOpen = userToggled !== autoOpen;
          return (
            <div
              key={f.productGuid}
              className={`rounded-lg border transition-colors ${
                isShort
                  ? 'bg-rose-500/[0.06] border-rose-400/25'
                  : isSurplus
                  ? 'bg-emerald-500/[0.04] border-emerald-400/15'
                  : 'bg-white/[0.04] border-white/10'
              }`}
            >
              <div className="w-full px-3 py-2 flex items-center gap-3">
                {/* Chevron toggles the inline producing/consuming detail
                    panel — kept for power users who want everything visible.
                    The product name itself opens the focused chain editor
                    modal where you can set built counts for every factory
                    in the chain in one place. */}
                <button
                  onClick={() => {
                    const s = new Set(expanded);
                    if (s.has(f.productGuid)) s.delete(f.productGuid); else s.add(f.productGuid);
                    setExpanded(s);
                  }}
                  className="text-white/40 hover:text-white p-0.5"
                  aria-label={isOpen ? 'Hide details' : 'Show details'}
                >
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <button
                  onClick={() => setModal({
                    productGuid: f.productGuid,
                    // Open the modal sized for the FULL demand on this good
                    // (residents + factory inputs combined). If demand is
                    // zero (a pure surplus oddity), use 1 t/min as a sane
                    // floor so the chain is still inspectable.
                    demand: Math.max(f.totalDemand, 1),
                  })}
                  className="text-sm font-semibold text-white flex-1 truncate text-left hover:underline decoration-white/30 underline-offset-2"
                  title="Open the full chain editor for this good"
                >
                  {product?.name ?? `#${f.productGuid}`}
                </button>
                <span className="text-[11px] text-white/40 tabular-nums">
                  supply {f.totalSupply.toFixed(2)} · need {f.totalDemand.toFixed(2)}
                </span>
                <span
                  className={`text-sm font-bold tabular-nums w-20 text-right ${
                    isShort ? 'text-rose-300' : isSurplus ? 'text-emerald-300' : 'text-white/60'
                  }`}
                >
                  {f.net >= 0 ? '+' : ''}{f.net.toFixed(2)}
                </span>
              </div>
              {isOpen && (
                <div className="px-4 pb-3 pt-1 border-t border-white/8 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
                  <div>
                    <p className="text-emerald-300/80 font-semibold uppercase tracking-wider mb-1">Producing</p>
                    {f.supply.length === 0 ? (
                      <p className="text-white/30 italic">Nothing produces this yet.</p>
                    ) : f.supply.map((c, i) => (
                      <p key={i} className="text-white/70 flex items-center gap-1.5">
                        <span className="text-white tabular-nums w-6 inline-block shrink-0">{c.count}×</span>
                        <span className="flex-1 truncate">{c.factoryName}</span>
                        <span className="text-white/40 shrink-0">+{c.ratePerMin.toFixed(2)}/min</span>
                        <button
                          onClick={() => onSetBuilt(c.factoryGuid, (built[c.factoryGuid] ?? 0) + 1)}
                          title="Build one more"
                          className="shrink-0 w-5 h-5 rounded text-white/40 hover:text-white hover:bg-white/10 leading-none"
                        >+</button>
                      </p>
                    ))}
                    {/* When the good is short, expose every candidate producer
                        in this region as a one-click chip. Reachability into
                        construction-material chains (Concrete, Bricks, etc.)
                        is the main motivator — they're never in the
                        population-driven plan. */}
                    {(() => {
                      if (f.net >= -0.001) return null;
                      const candidates = producersFor(f.productGuid)
                        .filter(c => !f.supply.some(s => s.factoryGuid === c.guid));
                      if (candidates.length === 0) {
                        return (
                          <p className="text-rose-300/70 italic mt-1.5 text-[10px]">
                            No producer in {region} — must be imported from another region.
                          </p>
                        );
                      }
                      return (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {candidates.map(c => (
                            <button
                              key={c.guid}
                              onClick={() => onSetBuilt(c.guid, (built[c.guid] ?? 0) + 1)}
                              className="text-[10px] px-2 py-1 rounded-md border border-emerald-400/30 bg-emerald-400/5 text-emerald-200 hover:bg-emerald-400/15 hover:border-emerald-400/50 transition-colors"
                              title={`Add 1× ${c.name}`}
                            >
                              + {c.name}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                    <p className="text-rose-300/80 font-semibold uppercase tracking-wider mb-1">Consuming</p>
                    {f.demand.length === 0 ? (
                      <p className="text-white/30 italic">Nothing consumes this.</p>
                    ) : f.demand.map((c, i) => (
                      <p key={i} className="text-white/70 flex items-center gap-1.5">
                        {c.factoryGuid === 0 ? (
                          <>
                            <span className="text-white flex-1 truncate">{c.factoryName}</span>
                            <span className="text-white/40 shrink-0 text-[10px]">{c.count} houses</span>
                            <span className="text-white/40 shrink-0">−{c.ratePerMin.toFixed(2)}/min</span>
                          </>
                        ) : (
                          <>
                            <span className="text-white tabular-nums w-6 inline-block shrink-0">{c.count}×</span>
                            <span className="flex-1 truncate">{c.factoryName}</span>
                            <span className="text-white/40 shrink-0">−{c.ratePerMin.toFixed(2)}/min</span>
                          </>
                        )}
                      </p>
                    ))}
                    {/* Downstream-discovery chips. For ANY good — surplus, balanced,
                        or short — surface every factory in this region that takes
                        it as input but isn't built yet. This is how Limestone →
                        Concrete Maker becomes one click instead of "where do I
                        even find Concrete in this UI". Construction-material
                        consumers never appear in the demand list on their own
                        because the planner only tracks per-minute flows, not the
                        one-off material cost of placing a building. */}
                    {(() => {
                      const downstream = consumersFor(f.productGuid)
                        .filter(c => !f.demand.some(d => d.factoryGuid === c.guid))
                        .filter(c => (built[c.guid] ?? 0) === 0);
                      if (downstream.length === 0) return null;
                      return (
                        <>
                          <p className="text-amber-300/70 font-semibold uppercase tracking-wider mt-2 mb-1 text-[10px]">
                            Used in {f.totalSupply > 0.001 ? '— build to use your surplus' : ''}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {downstream.map(c => (
                              <button
                                key={c.guid}
                                onClick={() => onSetBuilt(c.guid, (built[c.guid] ?? 0) + 1)}
                                className="text-[10px] px-2 py-1 rounded-md border border-amber-400/30 bg-amber-400/5 text-amber-200 hover:bg-amber-400/15 hover:border-amber-400/50 transition-colors"
                                title={`Add 1× ${c.name}`}
                              >
                                + {c.name}
                              </button>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {modal && (
        <ChainEditorModal
          productGuid={modal.productGuid}
          region={region}
          demandPerMin={modal.demand}
          builtCounts={built}
          onSetBuilt={onSetBuilt}
          onClose={() => setModal(null)}
          kicker={`Chain for ${PRODUCTS[modal.productGuid]?.name ?? '?'}`}
        />
      )}
    </section>
  );
}

/**
 * Section listing buildings the user has placed that aren't part of the
 * population-driven suggested plan — typically construction-material chains
 * (lumber, bricks, marble), defense, or anything else they want to factor
 * into workforce/upkeep totals. Includes a searchable picker to add more.
 */
function CustomBuildingsSection({
  region, built, suggestedGuids, unlockedTiers, onSetBuilt, onOpenChain,
}: {
  region: RegionId;
  built: Record<number, number>;
  suggestedGuids: Set<number>;
  /** Tiers with pop > 0 — used to gate which workforce-tied buildings can be added. */
  unlockedTiers: Set<TierId>;
  onSetBuilt: (factoryGuid: number, count: number) => void;
  onOpenChain?: (factoryGuid: number) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  // Factories the user has actually placed but that aren't on the suggested list.
  const customGuids = Object.keys(built)
    .map(Number)
    .filter(g => !suggestedGuids.has(g) && (built[g] ?? 0) > 0);

  // Available factories to add: every factory in this region that isn't
  // already on the suggested list and isn't already in custom.
  const trackedSet = new Set([...suggestedGuids, ...customGuids]);
  const candidates = Object.values(FACTORIES)
    .filter(f => f.regions.includes(region) && !trackedSet.has(f.guid))
    // Progressive disclosure: hide factories that need a workforce tier the
    // user hasn't reached yet. Infrastructure (no workforce tier) always
    // shows — it's available from the start.
    .filter(f => !f.workforceTier || unlockedTiers.has(f.workforceTier))
    .filter(f => !query || f.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Group customs by tier
  const byTier: Record<string, number[]> = {};
  for (const g of customGuids) {
    const f = FACTORIES[g];
    const key = f.workforceTier ?? '(infra)';
    (byTier[key] ??= []).push(g);
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
          Other buildings I've placed
        </p>
        <button
          onClick={() => { setPicking(p => !p); setQuery(''); }}
          className="text-xs px-2.5 py-1 rounded-lg border border-white/15 text-white/60 hover:text-white hover:border-white/40 transition-colors"
        >
          {picking ? 'Cancel' : '+ Add building'}
        </button>
      </div>

      {picking && (
        <div className="mb-3 bg-white/[0.04] border border-white/10 rounded-xl p-3">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search lumber, bricks, marble, military…"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 mb-2"
          />
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {candidates.length === 0 ? (
              <p className="text-xs text-white/35 p-2">No matching factories.</p>
            ) : candidates.slice(0, 80).map(f => (
              <button
                key={f.guid}
                onClick={() => { onSetBuilt(f.guid, 1); setPicking(false); setQuery(''); }}
                className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-white/5 flex items-center gap-2 text-white/80"
              >
                <span className="flex-1 truncate">{f.name}</span>
                {f.workforceTier && (
                  <span className={`text-[10px] ${TIER_TEXT[f.workforceTier]}`}>
                    {TIERS[f.workforceTier].name} ×{f.workforceAmount}
                  </span>
                )}
                {f.fertility && FERTILITIES[f.fertility] && (
                  <span className="text-[10px] text-amber-300/80">
                    {FERTILITIES[f.fertility].name}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {customGuids.length === 0 && !picking && (
        <p className="text-xs text-white/30 italic">
          Nothing tracked here yet. Add lumber camps, brickworks, defenses, or anything else
          you've built that isn't driven by your residents' needs — they'll count toward your
          workforce demand and upkeep.
        </p>
      )}

      {customGuids.length > 0 && (
        <div className="space-y-4">
          {(['(infra)', ...TIER_ORDER] as const).map(t => {
            const guids = byTier[t];
            if (!guids?.length) return null;
            const label = t === '(infra)' ? 'Infrastructure' : TIERS[t].name;
            const colorText = t === '(infra)' ? 'text-stone-300' : TIER_TEXT[t];
            const colorDot = t === '(infra)' ? 'bg-stone-400' : TIER_DOT[t];
            return (
              <div key={t}>
                <p className={`text-[11px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-2 ${colorText}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${colorDot}`} />
                  {label} workforce
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                  {guids.map(g => (
                    <BuildingRow
                      key={g}
                      factoryGuid={g}
                      needed={0}
                      built={built[g] ?? 0}
                      onOpenChain={onOpenChain ? () => onOpenChain(g) : undefined}
                      onSetBuilt={(v) => onSetBuilt(g, v)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * One row in the buildings list. Click the count to mark all built; use the
 * +/− steppers for partial progress (e.g. "I've built 1 of 3 Salt Ponds").
 * Once `built >= needed` the row is dimmed and struck through so it falls
 * into the visual background and the user's eye is drawn to what's left.
 */
function BuildingRow({
  factoryGuid, needed, built, onSetBuilt, onOpenChain,
}: {
  factoryGuid: number;
  /** 0 means "no target — this is a custom-tracked building". */
  needed: number;
  built: number;
  onSetBuilt: (next: number) => void;
  /** Click the building name → open its full supply chain in a modal. */
  onOpenChain?: () => void;
}) {
  const factory = FACTORIES[factoryGuid];
  const fert = factory.fertility ? FERTILITIES[factory.fertility] : null;
  const hasTarget = needed > 0;
  const done = hasTarget && built >= needed;
  return (
    <div
      className={`group rounded-lg border flex items-center gap-2 px-2 py-1.5 transition-colors ${
        done
          ? 'bg-emerald-500/[0.04] border-emerald-400/15'
          : 'bg-white/[0.04] border-white/10 hover:border-white/20'
      }`}
    >
      <button
        onClick={() => {
          if (hasTarget) onSetBuilt(done ? 0 : needed);
          else onSetBuilt(built === 0 ? 1 : 0);
        }}
        title={hasTarget ? (done ? 'Mark as not built' : 'Mark all built') : (built > 0 ? 'Remove' : 'Add one')}
        className={`shrink-0 w-7 h-7 rounded-md border flex items-center justify-center transition-colors ${
          done || (!hasTarget && built > 0)
            ? 'bg-emerald-400/20 border-emerald-400/40 text-emerald-200'
            : 'border-white/15 text-white/30 hover:text-white hover:border-white/40'
        }`}
      >
        {done || (!hasTarget && built > 0) ? '✓' : ''}
      </button>
      <button
        onClick={onOpenChain}
        disabled={!onOpenChain}
        className="flex-1 min-w-0 text-left disabled:cursor-default"
        title={onOpenChain ? 'Open the full supply chain for this building' : undefined}
      >
        <p className={`text-sm truncate leading-tight ${done ? 'line-through text-white/35' : 'text-white'} ${onOpenChain ? 'group-hover:underline decoration-white/30 underline-offset-2' : ''}`}>
          {factory.name}
        </p>
        {fert && (
          <p className={`text-[10px] truncate leading-tight ${done ? 'text-amber-300/30' : 'text-amber-300/80'}`}>
            <MapPin size={9} className="inline -mt-0.5 mr-0.5" />
            {fert.name}
          </p>
        )}
      </button>
      <div className={`flex items-center gap-1 shrink-0 ${done ? 'opacity-50' : ''}`}>
        <button
          onClick={() => onSetBuilt(Math.max(0, built - 1))}
          disabled={built === 0}
          className="w-5 h-5 rounded text-white/30 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed text-sm leading-none"
        >−</button>
        <span className={`text-sm font-bold tabular-nums w-12 text-center ${done ? 'text-emerald-300' : 'text-white'}`}>
          {hasTarget ? `${built}/${needed}` : built}
        </span>
        <button
          onClick={() => onSetBuilt(built + 1)}
          className="w-5 h-5 rounded text-white/30 hover:text-white hover:bg-white/10 text-sm leading-none"
        >+</button>
      </div>
    </div>
  );
}
