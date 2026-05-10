import { useMemo, useState } from 'react';
import { ArrowRight, AlertTriangle, Users, Coins, MapPin, Info } from 'lucide-react';
import { FACTORIES, FERTILITIES, PRODUCTS, TIERS, type RegionId, type TierId } from '../data/game';
import { buildChain, totalsForChain, formatCount, wholeBuildings, alternativesForProduct, TIER_ORDER, type ChainNode } from '../lib/chain';

const TIER_DOT: Record<TierId, string> = {
  liberti: 'bg-emerald-400',
  plebeians: 'bg-blue-400',
  equites: 'bg-violet-400',
  patricians: 'bg-amber-300',
  waders: 'bg-teal-400',
  smiths: 'bg-orange-400',
  aldermen: 'bg-rose-400',
  mercators: 'bg-cyan-400',
  nobles: 'bg-pink-300',
};
const TIER_TEXT: Record<TierId, string> = {
  liberti: 'text-emerald-300',
  plebeians: 'text-blue-300',
  equites: 'text-violet-300',
  patricians: 'text-amber-200',
  waders: 'text-teal-300',
  smiths: 'text-orange-300',
  aldermen: 'text-rose-300',
  mercators: 'text-cyan-300',
  nobles: 'text-pink-200',
};

function FactoryCard({ node, depth }: { node: ChainNode; depth: number }) {
  const f = node.factory;
  const fertility = f.fertility ? FERTILITIES[f.fertility] : null;
  const alts = alternativesForProduct(f.outputs[0].product).filter(a => a.guid !== f.guid);
  const whole = wholeBuildings(node.count);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 min-w-[180px] shrink-0">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-black text-white leading-none tabular-nums">{whole}</span>
        {Math.abs(whole - node.count) > 1e-6 && (
          <span className="text-xs text-white/40">need {formatCount(node.count)}</span>
        )}
      </div>
      <p className="text-sm font-semibold text-white mt-1 leading-tight">{f.name}</p>
      <p className="text-xs text-white/40 mt-1">
        1 every <span className="text-white/60 font-medium">{f.cycleTime}s</span>
        {' · '}
        <span className="text-white/60 font-medium">{node.ratePerMin.toFixed(2)} t/min</span>
      </p>
      {f.workforceTier && (
        <p className={`text-xs mt-1.5 ${TIER_TEXT[f.workforceTier]}`}>
          <Users size={11} className="inline mr-1 -mt-0.5" />
          {f.workforceAmount * whole} {TIERS[f.workforceTier].name.toLowerCase()}
        </p>
      )}
      {fertility && (
        <p className="mt-1 text-xs text-amber-300/90 leading-tight">
          <MapPin size={11} className="inline mr-1 -mt-0.5" />
          {fertility.name}
        </p>
      )}
      {alts.length > 0 && depth === 0 && (
        <p className="mt-2 text-[11px] text-white/30">
          <Info size={10} className="inline mr-1 -mt-0.5" />
          alt: {alts.slice(0, 2).map(a => a.name).join(', ')}
        </p>
      )}
    </div>
  );
}

/** Recursive vertical tree renderer. */
function TreeRow({ node, depth }: { node: ChainNode; depth: number }) {
  return (
    <div className="flex items-stretch">
      {/* indent guide */}
      {depth > 0 && (
        <div className="flex items-center pr-3">
          <ArrowRight size={16} className="text-white/15" />
        </div>
      )}
      <div className="flex flex-col gap-3">
        <FactoryCard node={node} depth={depth} />
        {node.children.length > 0 && (
          <div className="ml-6 pl-4 border-l border-white/10 flex flex-col gap-3">
            {node.children.map(c => (
              <TreeRow key={c.factory.guid + ':' + c.ratePerMin} node={c} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export interface ProductionTreeProps {
  productGuid: number;
  region: RegionId;
}

export function ProductionTree({ productGuid, region }: ProductionTreeProps) {
  const [rate, setRate] = useState(1);
  const product = PRODUCTS[productGuid];
  const tree = useMemo(() => buildChain(productGuid, region, rate), [productGuid, region, rate]);
  const totals = useMemo(() => (tree ? totalsForChain(tree) : null), [tree]);

  if (!tree || !totals) {
    return (
      <div className="p-12 text-center text-white/40">
        <AlertTriangle size={28} className="mx-auto mb-3 text-amber-400/70" />
        <p>No production chain found for this good in {region}.</p>
      </div>
    );
  }

  const fertList = [...totals.fertilities].map(g => FERTILITIES[g]).filter(Boolean);

  return (
    <div className="p-8 space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30">
          {region === 'latium' ? 'Latium' : 'Albion'} chain
        </p>
        <h2 className="text-4xl font-black text-white tracking-tight mt-1">{product.name}</h2>
      </header>

      <div className="flex items-center gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30">Target throughput</p>
        <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
          {[0.5, 1, 2, 5, 10].map(r => (
            <button
              key={r}
              onClick={() => setRate(r)}
              className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
                Math.abs(rate - r) < 1e-6 ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'
              }`}
            >
              {r} t/min
            </button>
          ))}
          <input
            type="number"
            value={rate}
            min={0.1}
            step={0.5}
            onChange={e => setRate(Math.max(0.1, +e.target.value || 1))}
            className="w-20 bg-transparent border-l border-white/10 px-2 py-1 text-sm text-white focus:outline-none"
          />
        </div>
      </div>

      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-4">
          Production tree
        </p>
        <div className="overflow-x-auto pb-2">
          <TreeRow node={tree} depth={0} />
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
          Workforce required
        </p>
        <div className="flex flex-wrap gap-2">
          {TIER_ORDER.map(t => {
            const w = totals.workforce[t];
            if (!w) return null;
            return (
              <div key={t} className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2">
                <span className={`w-2 h-2 rounded-full ${TIER_DOT[t]}`} />
                <span className="text-sm font-semibold text-white tabular-nums">{w}</span>
                <span className={`text-xs ${TIER_TEXT[t]}`}>{TIERS[t].name}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
          <p className="text-xs uppercase tracking-widest text-white/30">Upkeep</p>
          <p className="text-2xl font-bold text-yellow-300 mt-1 tabular-nums">
            <Coins size={16} className="inline mr-1 -mt-1" />
            -{totals.denariiPerMin}
            <span className="text-sm text-white/40 font-normal"> /min</span>
          </p>
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
          <p className="text-xs uppercase tracking-widest text-white/30">Total buildings</p>
          <p className="text-2xl font-bold text-white mt-1 tabular-nums">
            {Object.values(totals.factoryCounts).reduce<number>((s, c) => s + wholeBuildings(c as number), 0)}
          </p>
        </div>
      </section>

      {fertList.length > 0 && (
        <section>
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">
            Required fertilities / deposits
          </p>
          <div className="flex flex-wrap gap-2">
            {fertList.map(f => (
              <span
                key={f.guid}
                className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-400/30 text-amber-200 rounded-lg px-3 py-1.5 text-sm"
              >
                <MapPin size={12} />
                {f.name}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export { FACTORIES };
