import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { TIERS, type RegionId, type TierId } from '../data/game';
import { planableGoods, TIER_ORDER, type GoodEntry } from '../lib/chain';
import { ProductionTree } from './ProductionTree';

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

type RegionFilter = 'all' | RegionId;

export function GoodsView() {
  const [region, setRegion] = useState<RegionFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const goods: GoodEntry[] = useMemo(
    () => planableGoods(region === 'all' ? 'all' : region),
    [region],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return goods;
    return goods.filter(g => g.productName.toLowerCase().includes(q));
  }, [goods, search]);

  const grouped = useMemo(() => {
    const m: Partial<Record<TierId | 'infrastructure', GoodEntry[]>> = {};
    for (const g of filtered) {
      const key = g.producer.workforceTier ?? 'infrastructure';
      (m[key] ??= []).push(g);
    }
    return m;
  }, [filtered]);

  const groupOrder: (TierId | 'infrastructure')[] = ['infrastructure', ...TIER_ORDER];
  const selected = selectedKey
    ? filtered.find(g => `${g.productGuid}:${g.region}` === selectedKey)
      ?? goods.find(g => `${g.productGuid}:${g.region}` === selectedKey)
    : null;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* sidebar */}
      <aside className="w-72 shrink-0 flex flex-col border-r border-white/8 bg-[#11131a]">
        <div className="px-3 pt-4 pb-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input
              type="text"
              placeholder="Search goods…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/8 rounded-xl pl-8 pr-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>
        </div>

        <div className="px-3 pb-3 flex gap-1">
          {(['all', 'latium', 'albion'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                region === r ? 'bg-white/12 text-white' : 'text-white/35 hover:text-white/60'
              }`}
            >
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-4">
          {groupOrder.map(g => {
            const items = grouped[g];
            if (!items?.length) return null;
            const label = g === 'infrastructure' ? 'Infrastructure' : TIERS[g as TierId].name;
            const colorText = g === 'infrastructure' ? 'text-stone-400' : TIER_TEXT[g as TierId];
            const colorDot = g === 'infrastructure' ? 'bg-stone-400' : TIER_DOT[g as TierId];
            return (
              <div key={g}>
                <p className={`mx-2 mb-1 text-[11px] font-bold uppercase tracking-widest ${colorText}`}>
                  {label}
                </p>
                <div className="space-y-0.5">
                  {items.map(it => {
                    const key = `${it.productGuid}:${it.region}`;
                    const sel = selectedKey === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedKey(key)}
                        className={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-2.5 transition-colors ${
                          sel ? 'bg-white/10 border border-white/15' : 'hover:bg-white/5 border border-transparent'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${colorDot} shrink-0`} />
                        <span className={`text-sm flex-1 truncate ${sel ? 'text-white' : 'text-white/65'}`}>
                          {it.productName}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-white/25">
                          {it.region === 'latium' ? 'L' : 'A'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-center py-10 text-white/25 text-sm">Nothing found</p>
          )}
        </div>
      </aside>

      {/* detail */}
      <main className="flex-1 overflow-y-auto">
        {selected ? (
          <ProductionTree productGuid={selected.productGuid} region={selected.region} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-12">
            <p className="text-5xl mb-6">🏛️</p>
            <h2 className="text-2xl font-bold text-white mb-3">Pick a good</h2>
            <p className="text-white/35 max-w-sm text-sm leading-relaxed">
              Select any good from the left. The planner will build the full
              production tree, compute exact factory counts, workforce by tier,
              upkeep and required deposits.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
