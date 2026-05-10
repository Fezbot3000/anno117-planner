import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, MapPin, AlertTriangle, Coins, CheckCircle2, Sparkles } from 'lucide-react';
import {
  FACTORIES, FERTILITIES, PRODUCTS, TIERS,
  type Fertility, type RegionId, type TierId,
} from '../data/game';
import { buildChain, totalsForChain, planableGoods, wholeBuildings, TIER_ORDER } from '../lib/chain';
import { loadIslands, saveIslands, newIsland, type Island, type IslandTarget } from '../lib/storage';

const TIER_DOT: Record<TierId, string> = {
  liberti: 'bg-emerald-400', plebeians: 'bg-blue-400', equites: 'bg-violet-400',
  patricians: 'bg-amber-300', waders: 'bg-teal-400', smiths: 'bg-orange-400',
  aldermen: 'bg-rose-400', mercators: 'bg-cyan-400', nobles: 'bg-pink-300',
};

function fertilitiesForRegion(region: RegionId): Fertility[] {
  return Object.values(FERTILITIES).filter(f => f.regions.includes(region));
}

interface IslandSummary {
  totalBuildings: number;
  denariiPerMin: number;
  workforce: Partial<Record<TierId, number>>;
  requiredFertilities: Set<number>;
  missingFertilities: number[];
  unbuildableTargets: IslandTarget[];
}

function summariseIsland(island: Island): IslandSummary {
  const totalsAcc: Required<IslandSummary> = {
    totalBuildings: 0,
    denariiPerMin: 0,
    workforce: {},
    requiredFertilities: new Set<number>(),
    missingFertilities: [],
    unbuildableTargets: [],
  };
  for (const t of island.targets) {
    const tree = buildChain(t.productGuid, island.region, t.ratePerMin);
    if (!tree) {
      totalsAcc.unbuildableTargets.push(t);
      continue;
    }
    const totals = totalsForChain(tree);
    for (const c of Object.values(totals.factoryCounts)) {
      totalsAcc.totalBuildings += wholeBuildings(c as number);
    }
    totalsAcc.denariiPerMin += totals.denariiPerMin;
    for (const tier of TIER_ORDER) {
      const w = totals.workforce[tier];
      if (w) totalsAcc.workforce[tier] = (totalsAcc.workforce[tier] ?? 0) + w;
    }
    for (const f of totals.fertilities) totalsAcc.requiredFertilities.add(f);
  }
  totalsAcc.missingFertilities = [...totalsAcc.requiredFertilities].filter(
    f => !island.fertilities.includes(f),
  );
  return totalsAcc;
}

/** Goods this island could uniquely produce given its deposits — i.e. recommendation
 *  for "is this island worth taking". Picks goods whose chain requires at least one
 *  fertility this island has, that no other island in the workspace has. */
function uniqueGoodsForIsland(island: Island, allIslands: Island[]): string[] {
  const others = allIslands.filter(i => i.id !== island.id && i.region === island.region);
  const otherFerts = new Set<number>();
  others.forEach(i => i.fertilities.forEach(f => otherFerts.add(f)));
  const myUnique = island.fertilities.filter(f => !otherFerts.has(f));
  if (myUnique.length === 0) return [];

  const matches: string[] = [];
  for (const f of Object.values(FACTORIES)) {
    if (!f.regions.includes(island.region)) continue;
    if (!f.fertility || !myUnique.includes(f.fertility)) continue;
    for (const o of f.outputs) {
      const p = PRODUCTS[o.product];
      if (p && !p.isAbstract) matches.push(p.name);
    }
  }
  return [...new Set(matches)];
}

export function IslandsView() {
  const [islands, setIslands] = useState<Island[]>(() => loadIslands());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => { saveIslands(islands); }, [islands]);
  useEffect(() => {
    if (!selectedId && islands.length > 0) setSelectedId(islands[0].id);
  }, [islands, selectedId]);

  const selected = islands.find(i => i.id === selectedId) ?? null;

  const update = (id: string, patch: Partial<Island>) => {
    setIslands(list => list.map(i => (i.id === id ? { ...i, ...patch } : i)));
  };
  const remove = (id: string) => {
    setIslands(list => list.filter(i => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const addIsland = (region: RegionId) => {
    const island = newIsland(region);
    setIslands(list => [...list, island]);
    setSelectedId(island.id);
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="w-72 shrink-0 flex flex-col border-r border-white/8 bg-[#11131a]">
        <div className="px-3 pt-4 pb-3 flex gap-2">
          <button
            onClick={() => addIsland('latium')}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.06] hover:bg-white/12 border border-white/10 text-white/70 transition-colors flex items-center justify-center gap-1"
          >
            <Plus size={12} /> Latium
          </button>
          <button
            onClick={() => addIsland('albion')}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.06] hover:bg-white/12 border border-white/10 text-white/70 transition-colors flex items-center justify-center gap-1"
          >
            <Plus size={12} /> Albion
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
          {islands.length === 0 && (
            <p className="text-center py-10 text-white/30 text-sm leading-relaxed px-4">
              Add an island to plan your economy.<br />Each island has its own deposits and assigned production.
            </p>
          )}
          {islands.map(i => {
            const summary = summariseIsland(i);
            const sel = selectedId === i.id;
            return (
              <button
                key={i.id}
                onClick={() => setSelectedId(i.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                  sel ? 'bg-white/10 border border-white/15' : 'hover:bg-white/5 border border-transparent'
                }`}
              >
                <p className="text-sm font-semibold text-white truncate">{i.name}</p>
                <p className="text-xs text-white/40 mt-0.5">
                  {i.region === 'latium' ? 'Latium' : 'Albion'} · {i.targets.length} chains
                  {summary.missingFertilities.length > 0 && (
                    <span className="ml-2 text-amber-400/90">
                      <AlertTriangle size={10} className="inline -mt-0.5" /> {summary.missingFertilities.length}
                    </span>
                  )}
                </p>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {selected ? (
          <IslandDetail
            island={selected}
            allIslands={islands}
            onChange={patch => update(selected.id, patch)}
            onRemove={() => remove(selected.id)}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-12">
            <p className="text-5xl mb-6">🗺️</p>
            <h2 className="text-2xl font-bold text-white mb-3">Plan your island economy</h2>
            <p className="text-white/35 max-w-sm text-sm leading-relaxed">
              Add an island, mark which deposits it has, then assign goods to produce.
              The planner shows totals across the island and warns you if a chain
              needs a deposit you haven't claimed.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function IslandDetail({
  island, allIslands, onChange, onRemove,
}: {
  island: Island;
  allIslands: Island[];
  onChange: (patch: Partial<Island>) => void;
  onRemove: () => void;
}) {
  const summary = useMemo(() => summariseIsland(island), [island]);
  const ferts = useMemo(() => fertilitiesForRegion(island.region), [island.region]);
  const allGoods = useMemo(() => planableGoods(island.region), [island.region]);
  const unique = useMemo(() => uniqueGoodsForIsland(island, allIslands), [island, allIslands]);
  const [addProduct, setAddProduct] = useState<number | ''>('');
  const [addRate, setAddRate] = useState(1);

  const addTarget = () => {
    if (!addProduct) return;
    if (island.targets.some(t => t.productGuid === addProduct)) return;
    onChange({ targets: [...island.targets, { productGuid: addProduct, ratePerMin: addRate }] });
    setAddProduct('');
    setAddRate(1);
  };

  const updateTarget = (productGuid: number, patch: Partial<IslandTarget>) => {
    onChange({
      targets: island.targets.map(t => t.productGuid === productGuid ? { ...t, ...patch } : t),
    });
  };
  const removeTarget = (productGuid: number) => {
    onChange({ targets: island.targets.filter(t => t.productGuid !== productGuid) });
  };

  const toggleFertility = (guid: number) => {
    const next = island.fertilities.includes(guid)
      ? island.fertilities.filter(f => f !== guid)
      : [...island.fertilities, guid];
    onChange({ fertilities: next });
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
            {island.region === 'latium' ? 'Latium island' : 'Albion island'}
          </p>
          <input
            value={island.name}
            onChange={e => onChange({ name: e.target.value })}
            className="mt-1 text-3xl font-black text-white tracking-tight bg-transparent border-b border-transparent hover:border-white/10 focus:border-white/30 focus:outline-none w-full"
          />
        </div>
        <button
          onClick={onRemove}
          className="text-white/30 hover:text-rose-400 transition-colors p-2"
          title="Remove island"
        >
          <Trash2 size={16} />
        </button>
      </header>

      {/* Deposits */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
          Deposits and fertilities on this island
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ferts.map(f => {
            const have = island.fertilities.includes(f.guid);
            const required = summary.requiredFertilities.has(f.guid);
            return (
              <button
                key={f.guid}
                onClick={() => toggleFertility(f.guid)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                  have
                    ? 'bg-amber-500/15 border-amber-400/40 text-amber-200'
                    : required
                    ? 'bg-rose-500/10 border-rose-400/30 text-rose-300 hover:bg-rose-500/20'
                    : 'bg-white/[0.03] border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'
                }`}
              >
                <MapPin size={11} />
                {f.name}
                {required && !have && <AlertTriangle size={11} />}
              </button>
            );
          })}
        </div>
        {summary.missingFertilities.length > 0 && (
          <p className="mt-3 text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle size={12} />
            {summary.missingFertilities.length} required deposit{summary.missingFertilities.length === 1 ? '' : 's'} missing — chains needing them won't run.
          </p>
        )}
      </section>

      {/* Targets */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
          Production targets
        </p>
        <div className="space-y-2">
          {island.targets.length === 0 && (
            <p className="text-sm text-white/35">No targets yet. Add a good below.</p>
          )}
          {island.targets.map(t => {
            const p = PRODUCTS[t.productGuid];
            const tree = buildChain(t.productGuid, island.region, t.ratePerMin);
            const totals = tree ? totalsForChain(tree) : null;
            const buildings = totals
              ? Object.values(totals.factoryCounts).reduce<number>((s, c) => s + wholeBuildings(c as number), 0)
              : 0;
            return (
              <div key={t.productGuid} className="bg-white/[0.04] border border-white/10 rounded-xl p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{p?.name ?? '?'}</p>
                  <p className="text-xs text-white/40">{buildings} buildings · -{totals?.denariiPerMin ?? 0} denarii/min</p>
                </div>
                <input
                  type="number"
                  min={0.1}
                  step={0.5}
                  value={t.ratePerMin}
                  onChange={e => updateTarget(t.productGuid, { ratePerMin: Math.max(0.1, +e.target.value || 1) })}
                  className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-white/30"
                />
                <span className="text-xs text-white/40">t/min</span>
                <button
                  onClick={() => removeTarget(t.productGuid)}
                  className="text-white/30 hover:text-rose-400 transition-colors"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-2 bg-white/[0.02] border border-dashed border-white/10 rounded-xl p-3">
          <select
            value={addProduct}
            onChange={e => setAddProduct(e.target.value ? +e.target.value : '')}
            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-white/30"
          >
            <option value="">Add a good…</option>
            {allGoods
              .filter(g => !island.targets.some(t => t.productGuid === g.productGuid))
              .map(g => (
                <option key={`${g.productGuid}:${g.region}`} value={g.productGuid}>
                  {g.productName}
                </option>
              ))}
          </select>
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={addRate}
            onChange={e => setAddRate(Math.max(0.1, +e.target.value || 1))}
            className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-white/30"
          />
          <span className="text-xs text-white/40">t/min</span>
          <button
            onClick={addTarget}
            disabled={!addProduct}
            className="bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed border border-white/15 rounded px-3 py-1.5 text-sm text-white transition-colors"
          >
            Add
          </button>
        </div>
      </section>

      {/* Totals */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
          Island totals
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="Buildings" value={String(summary.totalBuildings)} color="text-white" />
          <Stat
            label="Upkeep"
            value={`-${summary.denariiPerMin}`}
            unit="/min"
            color="text-yellow-300"
            icon={<Coins size={14} className="inline mr-1 -mt-0.5" />}
          />
          <Stat label="Chains" value={String(island.targets.length)} color="text-white" />
          <Stat
            label="Deposits used"
            value={`${summary.requiredFertilities.size - summary.missingFertilities.length}/${summary.requiredFertilities.size}`}
            color={summary.missingFertilities.length > 0 ? 'text-rose-300' : 'text-emerald-300'}
            icon={summary.missingFertilities.length > 0 ? <AlertTriangle size={14} className="inline mr-1 -mt-0.5" /> : <CheckCircle2 size={14} className="inline mr-1 -mt-0.5" />}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {TIER_ORDER.map(t => {
            const w = summary.workforce[t];
            if (!w) return null;
            return (
              <div key={t} className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-1.5 text-sm">
                <span className={`w-2 h-2 rounded-full ${TIER_DOT[t]}`} />
                <span className="text-white tabular-nums font-semibold">{w}</span>
                <span className="text-white/50">{TIERS[t].name}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Worth commandeering */}
      {unique.length > 0 && (
        <section className="bg-emerald-950/40 border border-emerald-500/25 rounded-2xl p-5">
          <p className="text-sm font-semibold text-emerald-300 flex items-center gap-2 mb-2">
            <Sparkles size={14} /> Worth commandeering
          </p>
          <p className="text-sm text-white/55 leading-relaxed mb-3">
            This island has deposits no other island in your plan does. Goods
            you can <em>only</em> produce here:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unique.map(name => (
              <span key={name} className="text-xs bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 rounded-md px-2 py-1">
                {name}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({
  label, value, unit, color, icon,
}: { label: string; value: string; unit?: string; color: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
      <p className="text-[11px] uppercase tracking-widest text-white/30">{label}</p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${color}`}>
        {icon}{value}
        {unit && <span className="text-xs text-white/40 font-normal"> {unit}</span>}
      </p>
    </div>
  );
}
