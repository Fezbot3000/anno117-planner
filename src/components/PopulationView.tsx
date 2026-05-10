import { useMemo, useState } from 'react';
import { Users, Coins, Home, Factory as FactoryIcon, MapPin, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
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
}

const DEFAULT_STATE: PopState = {
  region: 'latium',
  populations: { liberti: 200, plebeians: 0 },
  disabled: {},
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
          <div className="p-8 space-y-8">
            <header>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
                {region === 'latium' ? 'Latium' : 'Albion'} economy plan
              </p>
              <h2 className="text-4xl font-black text-white tracking-tight mt-1">
                {totalActualPopulation.toLocaleString()} residents
              </h2>
              <p className="text-sm text-white/40 mt-1">
                Across {totalResidences} residence{totalResidences === 1 ? '' : 's'}, satisfying every basic need at standard consumption.
              </p>
            </header>

            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat icon={<Home size={14} />} label="Houses" value={totalResidences.toLocaleString()} color="text-white" />
              <Stat icon={<FactoryIcon size={14} />} label="Production buildings" value={globals.totalBuildings.toLocaleString()} color="text-white" />
              <Stat icon={<Coins size={14} />} label="Production upkeep" value={`-${globals.denarii.toLocaleString()}`} unit="/min" color="text-yellow-300" />
              <Stat icon={<MapPin size={14} />} label="Deposits required" value={String(globals.fertilities.size)} color="text-amber-200" />
            </section>

            {/* Workforce balance */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
                Workforce balance
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {TIER_ORDER.filter(t => tierIds.includes(t)).map(t => {
                  const supply = workforceSupply[t] ?? 0;
                  const demand = globals.workforce[t] ?? 0;
                  if (supply === 0 && demand === 0) return null;
                  const ok = supply >= demand;
                  const ratio = demand === 0 ? 1 : Math.min(supply / demand, 1);
                  return (
                    <div key={t} className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-2 h-2 rounded-full ${TIER_DOT[t]}`} />
                        <span className={`text-sm font-semibold ${TIER_TEXT[t]}`}>{TIERS[t].name}</span>
                        <span className={`ml-auto text-xs font-bold tabular-nums ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {supply} / {demand}
                          {!ok && <AlertTriangle size={11} className="inline ml-1 -mt-0.5" />}
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded overflow-hidden">
                        <div
                          className={`h-full transition-all ${ok ? 'bg-emerald-400/70' : 'bg-rose-400/70'}`}
                          style={{ width: `${ratio * 100}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-white/40">
                        {supply.toLocaleString()} workers available, {demand.toLocaleString()} required by industry
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Production by good */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
                Production required by good
              </p>
              <div className="space-y-2">
                {chains.map(c => {
                  const product = PRODUCTS[c.product];
                  if (!c.tree) {
                    return (
                      <div key={c.product} className="bg-rose-500/5 border border-rose-400/30 rounded-xl p-3 text-sm">
                        <span className="font-semibold text-rose-200">{product?.name ?? '?'}</span>
                        <span className="text-rose-300/70 ml-2">— no producer in {region}, must import {c.demand.toFixed(2)} t/min</span>
                      </div>
                    );
                  }
                  const totals = totalsForChain(c.tree);
                  const buildings = Object.values(totals.factoryCounts)
                    .reduce<number>((s, n) => s + wholeBuildings(n as number), 0);
                  const root = c.tree.factory;
                  return (
                    <div key={c.product} className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white">{product.name}</p>
                          <p className="text-xs text-white/40 mt-0.5">
                            {c.demand.toFixed(2)} t/min · {buildings} building{buildings === 1 ? '' : 's'} · -{totals.denariiPerMin}/min
                          </p>
                        </div>
                        <span className="text-2xl font-bold text-white tabular-nums">
                          {wholeBuildings(c.tree.count)}
                        </span>
                        <span className="text-xs text-white/50 max-w-[10rem] truncate">{root.name}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Per-tier breakdown */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
                Per-tier consumption breakdown
              </p>
              <div className="space-y-2">
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
            </section>

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

function Stat({
  icon, label, value, unit, color,
}: { icon: React.ReactNode; label: string; value: string; unit?: string; color: string }) {
  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
      <p className="text-[11px] uppercase tracking-widest text-white/30 flex items-center gap-1">
        {icon} {label}
      </p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${color}`}>
        {value}
        {unit && <span className="text-xs text-white/40 font-normal"> {unit}</span>}
      </p>
    </div>
  );
}
