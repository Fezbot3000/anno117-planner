import { useState, useMemo } from 'react';
import { Search, ArrowRight, MapPin, Share2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { CHAINS } from './data/chains';
import { BUILDINGS } from './data/buildings';
import type { ProductionChain, Tier, Region } from './data/types';

const TIER_ORDER: Tier[] = ['infrastructure', 'liberti', 'waders', 'plebeians', 'smiths', 'equites', 'aldermen', 'mercators', 'patricians', 'nobles'];

const TIER_LABELS: Record<Tier, string> = {
  infrastructure: 'Infrastructure',
  liberti: 'Liberti',
  waders: 'Waders',
  plebeians: 'Plebeians',
  smiths: 'Smiths',
  equites: 'Equites',
  aldermen: 'Aldermen',
  mercators: 'Mercators',
  patricians: 'Patricians',
  nobles: 'Nobles',
};

const TIER_DOT: Record<Tier, string> = {
  infrastructure: 'bg-stone-400',
  liberti: 'bg-green-400',
  waders: 'bg-teal-400',
  plebeians: 'bg-blue-400',
  smiths: 'bg-orange-400',
  equites: 'bg-purple-400',
  aldermen: 'bg-red-400',
  mercators: 'bg-cyan-400',
  patricians: 'bg-yellow-400',
  nobles: 'bg-rose-400',
};

const TIER_TEXT: Record<Tier, string> = {
  infrastructure: 'text-stone-400',
  liberti: 'text-green-400',
  waders: 'text-teal-400',
  plebeians: 'text-blue-400',
  smiths: 'text-orange-400',
  equites: 'text-purple-400',
  aldermen: 'text-red-400',
  mercators: 'text-cyan-400',
  patricians: 'text-yellow-400',
  nobles: 'text-rose-400',
};

const REGION_LABEL: Record<Region, string> = {
  latium: 'Latium',
  albion: 'Albion',
  both: 'Both regions',
};

function formatTime(sec: number): string {
  if (sec < 60) return `${sec} sec`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m} min`;
}

// ── Production step card ───────────────────────────────────────────────────
function StepCard({ buildingId, count, isShared }: { buildingId: string; count: number; isShared: boolean }) {
  const b = BUILDINGS[buildingId];
  if (!b) return null;

  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-1 min-w-[140px] shrink-0 ${
      isShared
        ? 'bg-violet-950/60 border-violet-500/30'
        : 'bg-white/[0.04] border-white/10'
    }`}>
      {/* Count — the most important number */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-black text-white leading-none">{count}</span>
        <span className="text-sm text-white/40 font-medium">× {count === 1 ? '' : ''}</span>
      </div>

      {/* Name */}
      <p className="text-sm font-semibold text-white leading-snug">{b.name}</p>

      {/* Cycle time */}
      <p className="text-xs text-white/40 mt-1">
        Makes 1 every <span className="text-white/60 font-medium">{formatTime(b.productionTimeSec)}</span>
      </p>

      {/* Shared badge */}
      {isShared && (
        <span className="mt-1 self-start text-xs text-violet-300 bg-violet-500/20 border border-violet-400/30 px-2 py-0.5 rounded-full">
          can be shared
        </span>
      )}

      {/* Terrain */}
      {b.terrainRequirement && (
        <p className="mt-1 text-xs text-amber-400/80">
          📍 {b.terrainRequirement}
        </p>
      )}
    </div>
  );
}

// ── Chain detail panel ─────────────────────────────────────────────────────
function ChainDetail({ chain, onClose }: { chain: ProductionChain; onClose: () => void }) {
  const [showTips, setShowTips] = useState(false);

  const totalCosts = useMemo(() => {
    let denarii = 0, workforce = 0, planks = 0, tiles = 0;
    chain.steps.forEach(({ buildingId, count }) => {
      const b = BUILDINGS[buildingId];
      if (!b) return;
      denarii += b.maintenanceCost.denarii * count;
      workforce += b.maintenanceCost.workforce * count;
      planks += (b.constructionCost.planks ?? 0) * count;
      tiles += (b.constructionCost.tiles ?? 0) * count;
    });
    return { denarii, workforce, planks, tiles };
  }, [chain]);

  const allTips = useMemo(() => {
    const tips: { building: string; tips: string[] }[] = [];
    chain.steps.forEach(({ buildingId }) => {
      const b = BUILDINGS[buildingId];
      if (b?.placementTips.length) tips.push({ building: b.name, tips: b.placementTips });
    });
    return tips;
  }, [chain]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ── Top bar ── */}
      <div className="sticky top-0 z-10 bg-[#0f1117]/95 backdrop-blur border-b border-white/8 flex items-center justify-between px-8 py-4">
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full shrink-0 ${TIER_DOT[chain.tier]}`} />
          <span className={`text-sm font-medium ${TIER_TEXT[chain.tier]}`}>{TIER_LABELS[chain.tier]}</span>
          <span className="text-white/20">·</span>
          <span className="text-sm text-white/40">{REGION_LABEL[chain.region]}</span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white/30 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-8 py-8 space-y-10">
        {/* ── Heading ── */}
        <div>
          <h2 className="text-4xl font-black text-white tracking-tight">{chain.name}</h2>
          <p className="text-white/40 mt-1 text-base">
            {chain.totalBuildingCount} buildings needed for one full production cycle
          </p>
        </div>

        {/* ── The chain flow — hero section ── */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-5">How to build it</p>
          <div className="flex items-center gap-3 overflow-x-auto pb-2">
            {chain.steps.map(({ buildingId, count }, idx) => (
              <div key={buildingId} className="flex items-center gap-3">
                <StepCard
                  buildingId={buildingId}
                  count={count}
                  isShared={!!chain.sharedBuildings?.includes(buildingId)}
                />
                {idx < chain.steps.length - 1 && (
                  <ArrowRight size={20} className="text-white/20 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Shared buildings note ── */}
        {chain.sharedBuildings && chain.sharedBuildings.length > 0 && (
          <div className="flex items-start gap-3 bg-violet-950/50 border border-violet-500/25 rounded-2xl p-5">
            <Share2 size={16} className="text-violet-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-violet-300 mb-1">Save money by sharing</p>
              <p className="text-sm text-white/50 leading-relaxed">
                The <span className="text-white/70 font-medium">
                  {chain.sharedBuildings.map(id => BUILDINGS[id]?.name).filter(Boolean).join(', ')}
                </span> {chain.sharedBuildings.length === 1 ? 'building' : 'buildings'} in this chain{' '}
                {chain.sharedBuildings.length === 1 ? 'can' : 'can all'} be shared with other nearby production chains —
                you don't need to build a separate one for each chain.
              </p>
            </div>
          </div>
        )}

        {/* ── Where to place it ── */}
        <div className="bg-emerald-950/40 border border-emerald-500/20 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={15} className="text-emerald-400" />
            <p className="text-sm font-semibold text-emerald-300">Where to place it</p>
          </div>
          <p className="text-sm text-white/60 leading-relaxed">{chain.placementSummary}</p>
        </div>

        {/* ── Running costs ── */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-4">What it costs to run</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Upkeep per minute', value: `-${totalCosts.denarii}`, unit: 'denarii', color: 'text-yellow-300' },
              { label: 'Workers needed', value: totalCosts.workforce, unit: 'people', color: 'text-blue-300' },
              { label: 'To build — planks', value: totalCosts.planks, unit: 'planks', color: 'text-green-300' },
              { label: 'To build — tiles', value: totalCosts.tiles, unit: 'tiles', color: 'text-orange-300' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white/[0.04] border border-white/8 rounded-xl p-4">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-white/35 mt-1 leading-snug">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tips — collapsed by default ── */}
        <div>
          <button
            onClick={() => setShowTips(v => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-white/40 hover:text-white/70 transition-colors"
          >
            {showTips ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {showTips ? 'Hide' : 'Show'} detailed placement tips
          </button>

          {showTips && (
            <div className="mt-4 space-y-4">
              {allTips.map(({ building, tips }) => (
                <div key={building} className="bg-white/[0.03] border border-white/8 rounded-xl p-4">
                  <p className="text-sm font-semibold text-white/60 mb-2">{building}</p>
                  <ul className="space-y-2">
                    {tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-white/45 leading-relaxed">
                        <span className="text-emerald-500 shrink-0 mt-0.5">›</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar list item ──────────────────────────────────────────────────────
function ChainListItem({ chain, selected, onClick }: { chain: ProductionChain; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-3 group ${
        selected
          ? 'bg-white/10 border border-white/15'
          : 'hover:bg-white/5 border border-transparent'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TIER_DOT[chain.tier]}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${selected ? 'text-white' : 'text-white/65 group-hover:text-white/90'}`}>
          {chain.name}
        </p>
        <p className="text-xs text-white/25 mt-0.5">{chain.totalBuildingCount} buildings</p>
      </div>
    </button>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────
export default function App() {
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState<'all' | 'latium' | 'albion'>('all');

  const allChains = Object.values(CHAINS);

  const filteredChains = useMemo(() =>
    allChains.filter(c => {
      const q = search.toLowerCase();
      const matchesSearch = !q ||
        c.name.toLowerCase().includes(q) ||
        c.outputGood.toLowerCase().includes(q) ||
        c.steps.some(s => BUILDINGS[s.buildingId]?.name.toLowerCase().includes(q));
      const matchesRegion = regionFilter === 'all' || c.region === regionFilter || c.region === 'both';
      return matchesSearch && matchesRegion;
    }),
  [allChains, search, regionFilter]);

  const groupedChains = useMemo(() => {
    const groups: Partial<Record<Tier, ProductionChain[]>> = {};
    TIER_ORDER.forEach(tier => {
      const chains = filteredChains.filter(c => c.tier === tier);
      if (chains.length) groups[tier] = chains;
    });
    return groups;
  }, [filteredChains]);

  const selectedChain = selectedChainId ? CHAINS[selectedChainId] : null;

  return (
    <div className="flex h-screen bg-[#0f1117] text-white overflow-hidden">

      {/* ── Sidebar ── */}
      <div className="w-64 shrink-0 flex flex-col border-r border-white/8 bg-[#11131a]">

        {/* Brand */}
        <div className="px-5 py-5 border-b border-white/8">
          <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-0.5">Anno 117</p>
          <h1 className="text-base font-bold text-white">Production Planner</h1>
        </div>

        {/* Search */}
        <div className="px-3 pt-4 pb-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/8 rounded-xl pl-8 pr-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/20 transition-all"
            />
          </div>
        </div>

        {/* Region tabs */}
        <div className="px-3 pb-3 flex gap-1">
          {(['all', 'latium', 'albion'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRegionFilter(r)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                regionFilter === r
                  ? 'bg-white/12 text-white'
                  : 'text-white/35 hover:text-white/60'
              }`}
            >
              {r === 'all' ? 'All' : r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>

        {/* Chain list */}
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-5">
          {Object.entries(groupedChains).map(([tier, chains]) => (
            <div key={tier}>
              <p className={`mx-2 mb-1 text-[11px] font-bold uppercase tracking-widest ${TIER_TEXT[tier as Tier]}`}>
                {TIER_LABELS[tier as Tier]}
              </p>
              <div className="space-y-0.5">
                {chains!.map(chain => (
                  <ChainListItem
                    key={chain.id}
                    chain={chain}
                    selected={selectedChainId === chain.id}
                    onClick={() => setSelectedChainId(chain.id)}
                  />
                ))}
              </div>
            </div>
          ))}
          {filteredChains.length === 0 && (
            <p className="text-center py-10 text-white/25 text-sm">Nothing found</p>
          )}
        </div>
      </div>

      {/* ── Detail panel ── */}
      <div className="flex-1 overflow-hidden">
        {selectedChain ? (
          <ChainDetail chain={selectedChain} onClose={() => setSelectedChainId(null)} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-12">
            <p className="text-5xl mb-6">🏛️</p>
            <h2 className="text-2xl font-bold text-white mb-3">Pick a production chain</h2>
            <p className="text-white/35 max-w-xs text-sm leading-relaxed">
              Select anything from the left panel to see how many buildings you need, where to place them, and what it'll cost to run.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
