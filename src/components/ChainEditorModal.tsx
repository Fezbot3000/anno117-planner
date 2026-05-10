// ChainEditorModal — focused, single-product editor.
//
// Why this exists: a flat row in Material Flows is too cramped to actually
// plan a chain. Click a good (e.g. "Bread") and you get one focused dialog
// listing every factory in the chain — Wheat Farm, Grain Mill, Bakery — with
// editable built counts in one place. No nested tree, no scattered controls.
//
// Reusable across views: takes the product, region, target demand, and a
// built-counts map; emits set-built calls back to the parent. The parent
// owns persistence; this component is purely presentational + interactive.

import { useEffect, useMemo } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { FACTORIES, PRODUCTS, type RegionId } from '../data/game';
import { buildChain, wholeBuildings, type ChainNode } from '../lib/chain';

export interface ChainEditorModalProps {
  productGuid: number;
  region: RegionId;
  /** Target output rate (t/min) used to size the chain. */
  demandPerMin: number;
  /** Map of factoryGuid → built count. Same shape as the parent's state. */
  builtCounts: Record<number, number>;
  onSetBuilt: (factoryGuid: number, count: number) => void;
  onClose: () => void;
  /** Optional kicker over the title, e.g. "Provide Bread for Plebeians". */
  kicker?: string;
  /**
   * Optional "I'm providing this need" toggle. When supplied, the modal
   * shows a tick row at the top so the user can mark a need as provided
   * (used by the Plan view's gate computation) without leaving the modal.
   */
  provided?: boolean;
  onToggleProvided?: () => void;
}

interface Row {
  factoryGuid: number;
  /** Indent depth in the chain — leaves (raw producers) are deepest. */
  depth: number;
  /** Whole buildings needed (ceil of fractional count). */
  needed: number;
  /** This node's output rate (t/min) at the sized count. */
  ratePerMin: number;
}

export function ChainEditorModal({
  productGuid, region, demandPerMin, builtCounts, onSetBuilt, onClose, kicker,
  provided, onToggleProvided,
}: ChainEditorModalProps) {
  // Esc closes — common modal expectation, costs nothing to support.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const product = PRODUCTS[productGuid];

  // Build the chain tree once for the demand. The walk produces a leaves-
  // first list so reading top-to-bottom matches build-order in-game (raw
  // farms before processors before final goods).
  const rows = useMemo<Row[]>(() => {
    const tree = buildChain(productGuid, region, demandPerMin);
    if (!tree) return [];
    const out: Row[] = [];
    const seen = new Set<number>();
    const walk = (n: ChainNode, depth: number) => {
      for (const c of n.children) walk(c, depth + 1);
      if (seen.has(n.factory.guid)) return;
      seen.add(n.factory.guid);
      out.push({
        factoryGuid: n.factory.guid,
        depth,
        needed: wholeBuildings(n.count),
        ratePerMin: n.ratePerMin,
      });
    };
    walk(tree, 0);
    return out;
  }, [productGuid, region, demandPerMin]);

  const noProducer = rows.length === 0;
  // Did the user complete the whole chain? Used to bias the close button.
  const allBuilt = !noProducer && rows.every(r => (builtCounts[r.factoryGuid] ?? 0) >= r.needed);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#171a23] border border-white/15 rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col"
        // Stop bubbling so backdrop-click only fires when the user clicks outside.
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 p-5 border-b border-white/10 shrink-0">
          <div className="min-w-0">
            {kicker && (
              <p className="text-[11px] uppercase tracking-widest text-white/40">{kicker}</p>
            )}
            <h2 className="text-lg font-bold text-white mt-0.5 truncate">
              {product?.name ?? `#${productGuid}`}
            </h2>
            <p className="text-xs text-white/45 mt-1">
              Targeting {demandPerMin.toFixed(2)} t/min — set how many of each building you've placed in-game.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white p-1.5 rounded-lg hover:bg-white/10 shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="overflow-y-auto p-5 space-y-2">
          {/* "Mark provided" toggle — only rendered when the modal is opened
              from a need-context (Plan view's tier rows). The user ticks it
              when their chain is actually running in-game; gate evaluation
              picks it up. Independent of built counts so the user can mark
              provided even before the planner thinks the chain is sized. */}
          {onToggleProvided && (
            <button
              onClick={onToggleProvided}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                provided
                  ? 'bg-emerald-400/10 border-emerald-400/40 text-white'
                  : 'bg-white/[0.04] border-white/15 text-white/70 hover:border-white/40'
              }`}
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                provided ? 'bg-emerald-400 border-emerald-400' : 'border-white/40'
              }`}>
                {provided && <X size={10} className="text-emerald-900 rotate-45" />}
              </span>
              <span className="flex-1 text-sm font-semibold">
                {provided ? "I'm providing this need" : "Mark this need as provided"}
              </span>
              <span className="text-[11px] text-white/40">
                {provided ? 'Counts toward the gate' : 'Tick when chain is running'}
              </span>
            </button>
          )}
          {noProducer ? (
            <div className="bg-rose-500/[0.08] border border-rose-400/30 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle size={16} className="text-rose-300 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-rose-200">No producer in {region}.</p>
                <p className="text-xs text-white/60 mt-1">
                  This good must be imported via trade route from the other province.
                </p>
              </div>
            </div>
          ) : (
            rows.map(r => {
              const factory = FACTORIES[r.factoryGuid];
              const built = builtCounts[r.factoryGuid] ?? 0;
              const ok = built >= r.needed;
              return (
                <div
                  key={r.factoryGuid}
                  style={{ marginLeft: r.depth * 16 }}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    ok
                      ? 'bg-emerald-500/[0.06] border-emerald-400/25'
                      : built > 0
                      ? 'bg-amber-500/[0.06] border-amber-400/25'
                      : 'bg-white/[0.04] border-white/10'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{factory.name}</p>
                    <p className="text-[11px] text-white/45 mt-0.5">
                      Produces {r.ratePerMin.toFixed(2)} t/min ·{' '}
                      {factory.workforceTier
                        ? `${factory.workforceAmount} ${factory.workforceTier}`
                        : 'no workforce'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onSetBuilt(r.factoryGuid, Math.max(0, built - 1))}
                      className="w-7 h-7 rounded-md text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-30"
                      disabled={built === 0}
                    >−</button>
                    <span className={`text-sm font-bold tabular-nums w-14 text-center ${
                      ok ? 'text-emerald-200' : built > 0 ? 'text-amber-200' : 'text-white/70'
                    }`}>
                      {built}/{r.needed}
                    </span>
                    <button
                      onClick={() => onSetBuilt(r.factoryGuid, built + 1)}
                      className="w-7 h-7 rounded-md text-white/50 hover:text-white hover:bg-white/10"
                    >+</button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <footer className="p-4 border-t border-white/10 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-white/35">
            {noProducer
              ? 'Cross-province only.'
              : allBuilt
              ? 'Chain complete ✓'
              : `${rows.filter(r => (builtCounts[r.factoryGuid] ?? 0) < r.needed).length} of ${rows.length} buildings still missing`}
          </p>
          <button
            onClick={onClose}
            className={`text-xs px-4 py-1.5 rounded-lg border transition-colors ${
              allBuilt
                ? 'bg-emerald-400/15 border-emerald-400/40 text-emerald-200'
                : 'border-white/15 text-white/70 hover:border-white/40 hover:text-white'
            }`}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
