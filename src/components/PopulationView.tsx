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

  // Aggregate global totals
  const globals = useMemo(() => {
    const factoryCounts: Record<number, number> = {};
    let denarii = 0;
    const workforce: Partial<Record<TierId, number>> = {};
    const fertilities = new Set<number>();
    for (const c of chains) {
      if (!c.tree) continue;
      const totals = totalsForChain(c.tree);
      for (const [g, n] of Object.entries(totals.factoryCounts)) {
        factoryCounts[+g] = (factoryCounts[+g] ?? 0) + (n as number);
      }
      // Recompute workforce/upkeep using *summed* fractional counts later — we
      // don't double-bill upkeep here; do it after merging.
      for (const f of totals.fertilities) fertilities.add(f);
    }
    let totalBuildings = 0;
    for (const [g, n] of Object.entries(factoryCounts)) {
      const f = FACTORIES[+g];
      const whole = wholeBuildings(n);
      totalBuildings += whole;
      denarii += f.denarii * whole;
      if (f.workforceTier) {
        workforce[f.workforceTier] = (workforce[f.workforceTier] ?? 0) + f.workforceAmount * whole;
      }
    }
    return { factoryCounts, totalBuildings, denarii, workforce, fertilities };
  }, [chains]);

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
    const demand = globals.workforce[t] ?? 0;
    return demand > supply && demand > 0;
  });

  /** How many of each factory the user still needs to construct. Negative
   *  numbers (over-built) clamp to 0 so the headline stays accurate. */
  const remainingByFactory: Record<number, number> = {};
  let totalRemaining = 0;
  let totalNeeded = 0;
  for (const [g, count] of Object.entries(globals.factoryCounts)) {
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
              {tierIds.map(t => {
                const tier = TIERS[t];
                const pop = state.populations[t] ?? 0;
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
                  {totalNeeded - totalRemaining} of {totalNeeded} built · {totalResidences} houses · -{globals.denarii.toLocaleString()} denarii/min upkeep when running
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

            {/* Issues banner — only shown when something needs attention */}
            {(workforceShortages.length > 0 || imports.length > 0) && (
              <section className="bg-rose-500/8 border border-rose-400/30 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-rose-200 flex items-center gap-2">
                  <AlertTriangle size={12} />
                  Issues to resolve
                </p>
                {workforceShortages.map(t => {
                  const supply = workforceSupply[t] ?? 0;
                  const demand = globals.workforce[t] ?? 0;
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
                  const tierFactories = Object.entries(globals.factoryCounts)
                    .map(([g, count]) => ({ factory: FACTORIES[+g], count }))
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

            {globals.fertilities.size > 0 && (
              <section>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
                  Required deposits / fertilities
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[...globals.fertilities].map(g => {
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
 * One row in the buildings list. Click the count to mark all built; use the
 * +/− steppers for partial progress (e.g. "I've built 1 of 3 Salt Ponds").
 * Once `built >= needed` the row is dimmed and struck through so it falls
 * into the visual background and the user's eye is drawn to what's left.
 */
function BuildingRow({
  factoryGuid, needed, built, onSetBuilt,
}: {
  factoryGuid: number;
  needed: number;
  built: number;
  onSetBuilt: (next: number) => void;
}) {
  const factory = FACTORIES[factoryGuid];
  const fert = factory.fertility ? FERTILITIES[factory.fertility] : null;
  const done = built >= needed;
  return (
    <div
      className={`group rounded-lg border flex items-center gap-2 px-2 py-1.5 transition-colors ${
        done
          ? 'bg-emerald-500/[0.04] border-emerald-400/15'
          : 'bg-white/[0.04] border-white/10 hover:border-white/20'
      }`}
    >
      <button
        onClick={() => onSetBuilt(done ? 0 : needed)}
        title={done ? 'Mark as not built' : 'Mark all built'}
        className={`shrink-0 w-7 h-7 rounded-md border flex items-center justify-center transition-colors ${
          done
            ? 'bg-emerald-400/20 border-emerald-400/40 text-emerald-200'
            : 'border-white/15 text-white/30 hover:text-white hover:border-white/40'
        }`}
      >
        {done ? '✓' : ''}
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
          {built}/{needed}
        </span>
        <button
          onClick={() => onSetBuilt(built + 1)}
          className="w-5 h-5 rounded text-white/30 hover:text-white hover:bg-white/10 text-sm leading-none"
        >+</button>
      </div>
    </div>
  );
}
