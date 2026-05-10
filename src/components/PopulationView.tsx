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
                // TRADE-OFF: real Anno 117 unlock thresholds (e.g. "Plebeians
                // unlock at 200 Liberti residents") are NOT in the data dump
                // — params.js only stores tier GUIDs, not population gates.
                // Rather than fabricate wiki numbers, we gate purely on
                // structure: tier N+1 unlocks once tier N has any residents.
                // The user can override at any time by clicking the lock.
                // Lock rule: a tier is locked iff the immediately-prior tier
                // has pop=0 AND this tier has pop=0. So setting Liberti to >0
                // reveals Plebeians; setting Plebeians to >0 reveals Equites;
                // etc. Setting this tier to >0 (self-engage) keeps it
                // unlocked so reducing earlier tiers doesn't yank away
                // numbers you'd already entered.
                const prevTier = idx > 0 ? tierIds[idx - 1] : null;
                const prevPop = prevTier ? (state.populations[prevTier] ?? 0) : 1;
                const locked = idx > 0 && pop === 0 && prevPop === 0;
                if (locked) {
                  return (
                    <button
                      key={t}
                      onClick={() => update({ populations: { ...state.populations, [t]: 1 } })}
                      className="w-full bg-white/[0.02] border border-dashed border-white/10 rounded-xl p-3 text-left hover:border-white/25 hover:bg-white/[0.04] transition-colors group"
                      title={`Reach the ${TIERS[prevTier!].name} tier first, or click to unlock manually.`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full bg-white/15`} />
                        <span className="text-sm font-semibold text-white/35 group-hover:text-white/60">{tier.name}</span>
                        <span className="ml-auto text-[10px] text-white/25 group-hover:text-white/40">
                          🔒 unlock manually
                        </span>
                      </div>
                      <p className="text-[11px] text-white/25 mt-1.5 leading-snug">
                        Reach {TIERS[prevTier!].name} first, or tap to reveal.
                      </p>
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
              Higher tiers unlock as you start populating the previous one. Real in-game
              thresholds aren't in our data, so this gates structurally — click any
              locked tier to reveal it manually.
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
              {Object.keys(state.built).length > 0 && (
                <button
                  onClick={() => update({ built: {} })}
                  className="text-xs text-white/35 hover:text-rose-300 transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-rose-400/40 shrink-0"
                >
                  Reset progress
                </button>
              )}
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
 * Section listing buildings the user has placed that aren't part of the
 * population-driven suggested plan — typically construction-material chains
 * (lumber, bricks, marble), defense, or anything else they want to factor
 * into workforce/upkeep totals. Includes a searchable picker to add more.
 */
function CustomBuildingsSection({
  region, built, suggestedGuids, unlockedTiers, onSetBuilt,
}: {
  region: RegionId;
  built: Record<number, number>;
  suggestedGuids: Set<number>;
  /** Tiers with pop > 0 — used to gate which workforce-tied buildings can be added. */
  unlockedTiers: Set<TierId>;
  onSetBuilt: (factoryGuid: number, count: number) => void;
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
  factoryGuid, needed, built, onSetBuilt,
}: {
  factoryGuid: number;
  /** 0 means "no target — this is a custom-tracked building". */
  needed: number;
  built: number;
  onSetBuilt: (next: number) => void;
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
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate leading-tight ${done ? 'line-through text-white/35' : 'text-white'}`}>
          {factory.name}
        </p>
        {fert && (
          <p className={`text-[10px] truncate leading-tight ${done ? 'text-amber-300/30' : 'text-amber-300/80'}`}>
            <MapPin size={9} className="inline -mt-0.5 mr-0.5" />
            {fert.name}
          </p>
        )}
      </div>
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
