import { useState } from 'react';
import { Workflow, Map } from 'lucide-react';
import { GoodsView } from './components/GoodsView';
import { IslandsView } from './components/IslandsView';

type Tab = 'goods' | 'islands';

export default function App() {
  const [tab, setTab] = useState<Tab>('goods');

  return (
    <div className="flex flex-col h-screen bg-[#0f1117] text-white overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/8 bg-[#11131a]">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold text-white/30 uppercase tracking-widest">Anno 117</p>
          <span className="text-white/15">·</span>
          <h1 className="text-base font-bold text-white">Production Planner</h1>
        </div>
        <nav className="flex items-center gap-1 bg-white/[0.04] border border-white/10 rounded-xl p-1">
          <TabButton active={tab === 'goods'} onClick={() => setTab('goods')} icon={<Workflow size={14} />}>
            Goods
          </TabButton>
          <TabButton active={tab === 'islands'} onClick={() => setTab('islands')} icon={<Map size={14} />}>
            Islands
          </TabButton>
        </nav>
        <p className="text-[11px] text-white/25">data v2025-11-21</p>
      </header>

      {tab === 'goods' ? <GoodsView /> : <IslandsView />}
    </div>
  );
}

function TabButton({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
        active ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
