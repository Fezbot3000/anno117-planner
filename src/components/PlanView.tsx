// PlanView — the new experience.
//
// Reframe (per user, May 2026): the tool is a progression planner, not a
// balance calculator. The user starts with nothing and builds up. The tool's
// job in any moment is to answer:
//   1. Where am I? (current state)
//   2. What am I working toward? (a goal — default is the next tier upgrade)
//   3. What's the path? (reverse-chained requirements, each marked done /
//      partial / todo, ticking things off updates the rest)
//
// Built as a parallel view alongside the existing Population/Goods/Islands
// tabs so we can iterate without breaking the existing tool. Own storage
// key, own state shape, no shared code with PopulationView state.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Check, Circle, Target, MapPin } from 'lucide-react';
import {
  FACTORIES, PRODUCTS, TIERS, RESIDENCES, NEEDS,
  type RegionId, type TierId,
} from '../data/game';
import {
  ROMAN_TIER_ORDER, ROMANIZED_ALBION_TIER_ORDER,
  gateForUpgrade, evaluateGate, nativeTierForNeed,
} from '../lib/tierGates';
import { buildChain, wholeBuildings, type ChainNode } from '../lib/chain';
import { ChainEditorModal } from './ChainEditorModal';

/**
 * Snapshot describing the modal that's currently open. Stored at the
 * PlanView root so any panel (Where I am, Path) can request the modal
 * with the right need-context (so the modal can offer "Mark provided").
 */
interface ChainModalRequest {
  productGuid: number;
  demandPerMin: number;
  /** Optional: which tier+need this came from, for the provided-toggle. */
  tier?: TierId;
  needGuid?: number;
  kicker?: string;
}

const STORAGE_KEY = 'anno117-planner.plan.v1';

/**
 * Local persistence — the new view owns its own key so it can never
 * conflict with the existing PopulationView state. Inline rather than
 * shared because storage.ts is Islands-specific and we don't want to
 * couple the new experience to it yet.
 */
function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch { /* ignore parse / quota */ }
  return fallback;
}
function saveLocal<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore quota */ }
}

type GoalSpec =
  | { kind: 'next-tier' }
  | { kind: 'make-good'; productGuid: number; ratePerMin: number };

interface PlanState {
  region: RegionId;
  /**
   * Residence counts the user has placed. This is the primary input the user
   * actually controls in-game — population is a derived consequence.
   */
  residences: Partial<Record<TierId, number>>;
  /**
   * Per-tier list of needs the user is currently PROVIDING. Default empty:
   * fresh state = nothing built yet = nothing provided. User ticks each need
   * as they finish the corresponding chain in-game. This is the inverse of
   * the previous `disabled` shape (which defaulted-on and required opting
   * out — backward for a tool used while you build from scratch).
   */
  provided: Partial<Record<TierId, number[]>>;
  /** Per-factory built count, same shape as PopulationView. */
  built: Record<number, number>;
  goal: GoalSpec;
}

const DEFAULT_STATE: PlanState = {
  region: 'latium',
  residences: {},
  provided: {},
  built: {},
  goal: { kind: 'next-tier' },
};

const TIER_TEXT: Record<TierId, string> = {
  liberti: 'text-emerald-300', plebeians: 'text-sky-300',
  equites: 'text-violet-300', patricians: 'text-amber-300',
  waders: 'text-emerald-300', smiths: 'text-orange-300',
  aldermen: 'text-violet-300', mercators: 'text-sky-300', nobles: 'text-amber-300',
};
const TIER_DOT: Record<TierId, string> = {
  liberti: 'bg-emerald-400', plebeians: 'bg-sky-400',
  equites: 'bg-violet-400', patricians: 'bg-amber-400',
  waders: 'bg-emerald-400', smiths: 'bg-orange-400',
  aldermen: 'bg-violet-400', mercators: 'bg-sky-400', nobles: 'bg-amber-400',
};

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export function PlanView() {
  const [state, setState] = useState<PlanState>(() => loadLocal(STORAGE_KEY, DEFAULT_STATE));
  // Centralised modal state — every panel that wants to drill into a chain
  // calls openChain() with the same shape, so we have one modal definition
  // and consistent behaviour regardless of entry point.
  const [chainModal, setChainModal] = useState<ChainModalRequest | null>(null);

  const update = (patch: Partial<PlanState>) => {
    const next = { ...state, ...patch };
    setState(next);
    saveLocal(STORAGE_KEY, next);
  };

  const toggleProvided = (tier: TierId, needGuid: number) => {
    const cur = state.provided[tier] ?? [];
    const next = cur.includes(needGuid)
      ? cur.filter(g => g !== needGuid)
      : [...cur, needGuid];
    update({ provided: { ...state.provided, [tier]: next } });
  };

  const region = state.region;
  // Tier order for this region. Albion currently uses the Romanised path
  // (Waders → Mercators → Nobles); the alternative Celtic path can come
  // later once we've confirmed how the user tracks the branching choice.
  const tierOrder: TierId[] = region === 'latium'
    ? ROMAN_TIER_ORDER
    : ROMANIZED_ALBION_TIER_ORDER;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <RegionPicker
          region={region}
          onChange={(r) => update({ region: r, residences: {}, built: {}, provided: {} })}
        />
        <CurrentState
          state={state}
          tierOrder={tierOrder}
          onChangeResidences={(t, n) => update({
            residences: { ...state.residences, [t]: Math.max(0, n) },
          })}
          onToggleNeed={toggleProvided}
          onOpenChain={(req) => setChainModal(req)}
        />
        <GoalPicker
          state={state}
          tierOrder={tierOrder}
          onChange={(goal) => update({ goal })}
        />
        <Path
          state={state}
          tierOrder={tierOrder}
          onSetBuilt={(guid, n) => update({ built: { ...state.built, [guid]: Math.max(0, n) } })}
          onToggleNeed={toggleProvided}
        />
      </div>
      {chainModal && (
        <ChainEditorModal
          productGuid={chainModal.productGuid}
          region={region}
          demandPerMin={Math.max(chainModal.demandPerMin, 0.001)}
          builtCounts={state.built}
          onSetBuilt={(guid, n) => update({
            built: { ...state.built, [guid]: Math.max(0, n) },
          })}
          onClose={() => setChainModal(null)}
          kicker={chainModal.kicker}
          provided={
            chainModal.tier && chainModal.needGuid
              ? (state.provided[chainModal.tier] ?? []).includes(chainModal.needGuid)
              : undefined
          }
          onToggleProvided={
            chainModal.tier && chainModal.needGuid
              ? () => toggleProvided(chainModal.tier!, chainModal.needGuid!)
              : undefined
          }
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Region picker
// --------------------------------------------------------------------------

function RegionPicker({
  region, onChange,
}: { region: RegionId; onChange: (r: RegionId) => void }) {
  return (
    <div className="flex items-center gap-2">
      <p className="text-[11px] uppercase tracking-widest text-white/35 font-semibold">Region</p>
      {(['latium', 'albion'] as RegionId[]).map(r => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            region === r
              ? 'bg-white text-black border-white'
              : 'bg-white/[0.04] text-white/60 border-white/10 hover:border-white/30'
          }`}
        >
          {r === 'latium' ? 'Latium' : 'Albion'}
        </button>
      ))}
      <p className="text-[11px] text-white/25 ml-2">
        Switching regions resets state — keep one tab per island for now.
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------
// Panel 1 — Where I am
// --------------------------------------------------------------------------

function CurrentState({
  state, tierOrder, onChangeResidences, onToggleNeed, onOpenChain,
}: {
  state: PlanState;
  tierOrder: TierId[];
  onChangeResidences: (t: TierId, n: number) => void;
  onToggleNeed: (tier: TierId, needGuid: number) => void;
  onOpenChain: (req: ChainModalRequest) => void;
}) {
  // Filter to tiers the user has placed at least one residence on, plus the
  // first tier (so empty starts have something to type into).
  const visibleTiers = tierOrder.filter((t, i) =>
    i === 0 || (state.residences[t] ?? 0) > 0 ||
    // Keep the next-tier slot visible too, so the user can place houses for
    // it the moment they upgrade in-game.
    (i > 0 && (state.residences[tierOrder[i - 1]] ?? 0) > 0),
  );

  return (
    <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white/70">Where I am</h2>
        <p className="text-[11px] text-white/30">
          Count the residences you've actually placed in-game.
        </p>
      </header>
      <div className="space-y-3">
        {visibleTiers.map(t => (
          <TierRow
            key={t}
            tier={t}
            count={state.residences[t] ?? 0}
            providedNeeds={state.provided[t] ?? []}
            onChangeCount={(n) => onChangeResidences(t, n)}
            onToggleNeed={(g) => onToggleNeed(t, g)}
            onOpenChain={onOpenChain}
          />
        ))}
      </div>
    </section>
  );
}

function TierRow({
  tier, count, providedNeeds, onChangeCount, onToggleNeed, onOpenChain,
}: {
  tier: TierId;
  count: number;
  providedNeeds: number[];
  onChangeCount: (n: number) => void;
  onToggleNeed: (needGuid: number) => void;
  onOpenChain: (req: ChainModalRequest) => void;
}) {
  const [expanded, setExpanded] = useState(count > 0);
  const tierInfo = TIERS[tier];
  // Residence asset for this tier (the houses the user places).
  const residence = RESIDENCES.find(r => r.populationLevel === tierInfo.guid);
  // Population per house = sum of `population` on every PROVIDED need.
  // Mirrors the in-game calculation: each met need adds residents up to the
  // residence's cap. With nothing provided, each house holds the floor of 1.
  const metNeeds = (residence?.needs ?? []).filter(n => providedNeeds.includes(n.need));
  const popPerHouse = Math.max(1, metNeeds.reduce((s, n) => s + (NEEDS[n.need]?.population ?? 0), 0));
  const totalPop = count * popPerHouse;
  const workforce = Math.floor(totalPop * tierInfo.workforceFactor);

  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-xl overflow-hidden">
      <div className="p-3 flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full ${TIER_DOT[tier]}`} />
        <span className={`text-sm font-semibold ${TIER_TEXT[tier]} w-24`}>{tierInfo.name}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onChangeCount(Math.max(0, count - 1))}
            className="w-6 h-6 rounded text-white/40 hover:text-white hover:bg-white/10"
          >−</button>
          <input
            type="number"
            min={0}
            value={count}
            onChange={e => onChangeCount(Math.max(0, +e.target.value || 0))}
            className="w-14 text-center bg-white/5 border border-white/10 rounded text-sm font-bold text-white tabular-nums focus:outline-none focus:border-white/30 py-1"
          />
          <button
            onClick={() => onChangeCount(count + 1)}
            className="w-6 h-6 rounded text-white/40 hover:text-white hover:bg-white/10"
          >+</button>
          <span className="text-[11px] text-white/40 ml-1">houses</span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-white/50 tabular-nums">
          <span>{totalPop} residents</span>
          <span>·</span>
          <span>{workforce} workers</span>
          <button
            onClick={() => setExpanded(e => !e)}
            className="ml-1 text-white/30 hover:text-white"
            title="Show needs I'm providing for this tier"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>
      {expanded && residence && (
        <div className="px-3 pb-3 border-t border-white/8 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-white/30 mb-2">
            Tick each need you're currently providing in-game. {popPerHouse} residents per house at this loadout.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
            {residence.needs.map(n => {
              const need = NEEDS[n.need];
              if (!need) return null;
              const enabled = providedNeeds.includes(n.need);
              const cleanName = need.name
                .replace(/^Need (Roman|Celtic) /, '')
                .replace(/^Need /, '');
              // Per-tier demand for this need: the rate listed on the
              // residence × the number of houses placed. Used to size the
              // chain inside the modal so the suggested counts match real
              // load (not a 1 t/min stub).
              const ratePerMin = (n.rate ?? 0) * count;
              const isService = !need.product;
              return (
                <button
                  key={n.need}
                  // Goods needs open the focused chain editor; service
                  // needs (Market, Tavern, Sanctuary…) toggle directly
                  // because there's no chain to edit.
                  onClick={() => {
                    if (isService) {
                      onToggleNeed(n.need);
                    } else {
                      onOpenChain({
                        productGuid: need.product!,
                        demandPerMin: ratePerMin,
                        tier,
                        needGuid: n.need,
                        kicker: `${tierInfo.name} need · ${need.category ?? 'Other'}`,
                      });
                    }
                  }}
                  className={`flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded transition-colors ${
                    enabled
                      ? 'bg-emerald-400/10 border border-emerald-400/30 text-white'
                      : 'bg-white/[0.02] border border-white/10 text-white/40 hover:border-white/30'
                  }`}
                  title={isService ? 'Service need — click to toggle' : 'Click to open the production chain'}
                >
                  {enabled ? <Check size={12} className="text-emerald-300 shrink-0" /> : <Circle size={12} className="text-white/30 shrink-0" />}
                  <span className="flex-1 truncate">{cleanName}</span>
                  <span className="text-[10px] text-white/30">{need.category ?? '—'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Panel 2 — What I'm working on
// --------------------------------------------------------------------------

function GoalPicker({
  state, tierOrder, onChange,
}: {
  state: PlanState;
  tierOrder: TierId[];
  onChange: (g: GoalSpec) => void;
}) {
  // The "current" tier = highest tier the user has any residences on.
  // The "next" tier = the one above that, if it exists.
  const currentTier = [...tierOrder].reverse().find(t => (state.residences[t] ?? 0) > 0) ?? tierOrder[0];
  const currentIdx = tierOrder.indexOf(currentTier);
  const nextTier = currentIdx < tierOrder.length - 1 ? tierOrder[currentIdx + 1] : null;

  const isNextTier = state.goal.kind === 'next-tier';

  return (
    <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white/70 flex items-center gap-2">
          <Target size={14} /> What I'm working on
        </h2>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <button
          onClick={() => onChange({ kind: 'next-tier' })}
          className={`text-left p-3 rounded-xl border transition-colors ${
            isNextTier
              ? 'bg-white/[0.07] border-white/40'
              : 'bg-white/[0.02] border-white/10 hover:border-white/25'
          }`}
        >
          <p className="text-xs uppercase tracking-wider text-white/40 mb-1">Default goal</p>
          <p className="text-sm font-bold text-white">
            {nextTier
              ? <>Unlock <span className={TIER_TEXT[nextTier]}>{TIERS[nextTier].name}</span></>
              : <>Maintain {TIERS[currentTier].name}</>}
          </p>
          <p className="text-[11px] text-white/40 mt-1">
            {nextTier
              ? `Meet the upgrade gate from ${TIERS[currentTier].name}.`
              : 'You are at the top of this region.'}
          </p>
        </button>
        <button
          disabled
          className="text-left p-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] opacity-50 cursor-not-allowed"
          title="Goal type 'Make a specific good' is in v2"
        >
          <p className="text-xs uppercase tracking-wider text-white/40 mb-1">Other goals</p>
          <p className="text-sm font-bold text-white/60">Make a specific good (military, exports)</p>
          <p className="text-[11px] text-white/30 mt-1">Coming next.</p>
        </button>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// Panel 3 — Path
// --------------------------------------------------------------------------

interface PathStep {
  /** Stable React key. */
  id: string;
  /** Status drives the visual treatment. */
  status: 'done' | 'partial' | 'todo';
  /** Short imperative. */
  title: string;
  /** Optional sub-info (counts, why-it's-blocked, etc.). */
  detail?: string;
  /** Optional inline action. */
  action?: { kind: 'build'; factoryGuid: number; needed: number; built: number }
         | { kind: 'toggle-need'; tier: TierId; needGuid: number };
  /** Children for collapsible sub-paths (e.g. chain inputs). */
  children?: PathStep[];
}

function Path({
  state, tierOrder, onSetBuilt, onToggleNeed,
}: {
  state: PlanState;
  tierOrder: TierId[];
  onSetBuilt: (guid: number, n: number) => void;
  onToggleNeed: (tier: TierId, needGuid: number) => void;
}) {
  const steps = useMemo(
    () => computePath(state, tierOrder),
    [state, tierOrder],
  );

  return (
    <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white/70">Path</h2>
        <p className="text-[11px] text-white/30">
          {steps.length === 0 ? 'No steps yet — set your residences above.' : `${steps.filter(s => s.status !== 'done').length} open`}
        </p>
      </header>
      {steps.length === 0 ? (
        <p className="text-xs text-white/30 italic">
          Add at least one residence above and the path will populate.
        </p>
      ) : (
        <div className="space-y-1.5">
          {steps.map(s => (
            <PathStepRow
              key={s.id}
              step={s}
              onSetBuilt={onSetBuilt}
              onToggleNeed={onToggleNeed}
              built={state.built}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PathStepRow({
  step, onSetBuilt, onToggleNeed, built, depth = 0,
}: {
  step: PathStep;
  onSetBuilt: (guid: number, n: number) => void;
  onToggleNeed: (tier: TierId, needGuid: number) => void;
  built: Record<number, number>;
  depth?: number;
}) {
  const [open, setOpen] = useState(step.status !== 'done');
  const hasChildren = (step.children?.length ?? 0) > 0;
  const tone =
    step.status === 'done'
      ? 'bg-emerald-500/[0.06] border-emerald-400/20'
      : step.status === 'partial'
      ? 'bg-amber-500/[0.06] border-amber-400/25'
      : 'bg-white/[0.04] border-white/10';

  return (
    <div className={`rounded-lg border ${tone}`} style={{ marginLeft: depth * 16 }}>
      <div className="px-3 py-2 flex items-center gap-2">
        <StatusIcon status={step.status} />
        <span className={`text-sm flex-1 ${step.status === 'done' ? 'text-white/50 line-through' : 'text-white'}`}>
          {step.title}
        </span>
        {step.action?.kind === 'build' && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onSetBuilt(step.action!.kind === 'build' ? step.action!.factoryGuid : 0, Math.max(0, (built[step.action!.kind === 'build' ? step.action!.factoryGuid : 0] ?? 0) - 1))}
              className="w-6 h-6 rounded text-white/40 hover:text-white hover:bg-white/10"
            >−</button>
            <span className="text-xs text-white/70 tabular-nums w-12 text-center">
              {step.action.built}/{step.action.needed}
            </span>
            <button
              onClick={() => onSetBuilt(step.action!.kind === 'build' ? step.action!.factoryGuid : 0, (built[step.action!.kind === 'build' ? step.action!.factoryGuid : 0] ?? 0) + 1)}
              className="w-6 h-6 rounded text-white/40 hover:text-white hover:bg-white/10"
            >+</button>
          </div>
        )}
        {step.action?.kind === 'toggle-need' && (
          <button
            onClick={() => onToggleNeed(step.action!.kind === 'toggle-need' ? step.action!.tier : 'liberti', step.action!.kind === 'toggle-need' ? step.action!.needGuid : 0)}
            className="text-[11px] px-2 py-1 rounded-md border border-white/15 text-white/60 hover:text-white hover:border-white/40"
          >
            Mark provided
          </button>
        )}
        {hasChildren && (
          <button
            onClick={() => setOpen(o => !o)}
            className="text-white/30 hover:text-white"
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>
      {step.detail && (
        <p className="px-3 pb-2 -mt-1 text-[11px] text-white/45">{step.detail}</p>
      )}
      {hasChildren && open && (
        <div className="px-2 pb-2 space-y-1">
          {step.children!.map(c => (
            <PathStepRow
              key={c.id}
              step={c}
              onSetBuilt={onSetBuilt}
              onToggleNeed={onToggleNeed}
              built={built}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: PathStep['status'] }) {
  if (status === 'done') return <Check size={14} className="text-emerald-300 shrink-0" />;
  if (status === 'partial') return <MapPin size={14} className="text-amber-300 shrink-0" />;
  return <Circle size={14} className="text-white/30 shrink-0" />;
}

// --------------------------------------------------------------------------
// Path computation
// --------------------------------------------------------------------------

/**
 * Compute the path steps from the user's current state to the selected goal.
 *
 * For the "next-tier" goal (the only one wired in v1):
 *   1. Find the user's highest current tier and the next tier above it.
 *   2. Look up the upgrade gate (categories + points threshold).
 *   3. For each missing category, list the candidate needs the user could
 *      enable to satisfy it. For each need, walk its production chain and
 *      mark which producers are built / partially built / unbuilt.
 *
 * Each step is annotated with status (done/partial/todo) so the UI's tick
 * loop is the same whether the user is enabling a need or building a factory.
 */
function computePath(state: PlanState, tierOrder: TierId[]): PathStep[] {
  if (state.goal.kind !== 'next-tier') return []; // v1: only this goal works

  // Highest current tier with residences placed.
  const currentTier =
    [...tierOrder].reverse().find(t => (state.residences[t] ?? 0) > 0)
    ?? tierOrder[0];
  const currentIdx = tierOrder.indexOf(currentTier);
  const nextTier = currentIdx < tierOrder.length - 1 ? tierOrder[currentIdx + 1] : null;

  const steps: PathStep[] = [];

  // Step 0: do you have any residences at all?
  // If not, the user hasn't started — this is the only meaningful step.
  if ((state.residences[currentTier] ?? 0) === 0) {
    steps.push({
      id: 'place-first',
      status: 'todo',
      title: `Place your first ${TIERS[currentTier].name} residences`,
      detail: 'Use the counter above to track how many houses you build.',
    });
    return steps;
  }

  if (!nextTier) {
    steps.push({
      id: 'top-tier',
      status: 'done',
      title: `You're at the top of ${state.region}.`,
    });
    return steps;
  }

  const gate = gateForUpgrade(currentTier, nextTier);
  if (!gate) return steps;

  // What the user is currently providing at the FROM tier. Default empty
  // list = nothing provided yet (you ticked nothing because you've built
  // nothing). The user opts IN by ticking — opposite of the v0 model.
  const fromResidence = RESIDENCES.find(r => r.populationLevel === TIERS[currentTier].guid);
  const providedNeeds = state.provided[currentTier] ?? [];
  const status = evaluateGate(gate, providedNeeds);
  // Per-residence rates for needs at this tier — used to size production
  // chains by actual demand (residences × t/min/house) rather than the
  // 1 t/min stub used in v0.
  const ratesByNeed = new Map<number, number>();
  for (const n of fromResidence?.needs ?? []) {
    ratesByNeed.set(n.need, n.rate ?? 0);
  }
  const residenceCount = state.residences[currentTier] ?? 0;

  // Headline step: the gate as a whole. Children are the per-category
  // sub-steps. The user gets a single line that says "you need X more pts in
  // category Y" and can drill in.
  const gateChildren: PathStep[] = gate.requiredCategories.map(cat => {
    const have = status.pointsByCategory[cat] ?? 0;
    const need = gate.pointsPerCategory;
    const met = have >= need;
    // Candidate needs in this category not yet enabled. Each candidate is
    // a leaf step; if it has a product, we attach the production-chain as
    // grandchildren so the user can build the chain in one place.
    const candidates: PathStep[] = [];
    if (!met) {
      // Candidates = every need in this category that the user has NOT
      // yet ticked as provided. These are the ways forward.
      const candidateNeeds = (fromResidence?.needs ?? [])
        .map(n => NEEDS[n.need])
        .filter((n): n is NonNullable<typeof n> => !!n)
        .filter(n => n.category === cat)
        .filter(n => !providedNeeds.includes(n.guid));
      for (const n of candidateNeeds) {
        const points = nativeTierForNeed(n.guid) + 1;
        // Real demand rate: per-house consumption × houses on this tier.
        // Falls back to 1 t/min if rate data is missing (shouldn't happen
        // for goods needs, but guards against bad data).
        const ratePerMin = (ratesByNeed.get(n.guid) ?? 0) * residenceCount;
        const subSteps = n.product
          ? buildChainSteps(n.product, state, Math.max(ratePerMin, 0.001))
          : [];
        candidates.push({
          id: `cand-${cat}-${n.guid}`,
          status: 'todo',
          title: `Provide ${n.name.replace(/^Need (Roman|Celtic) /, '').replace(/^Need /, '')} (+${points} pt${points > 1 ? 's' : ''})`,
          detail: n.product
            ? `Demand: ${ratePerMin.toFixed(2)} t/min of ${PRODUCTS[n.product]?.name ?? '?'} for ${residenceCount} house${residenceCount === 1 ? '' : 's'}.`
            : 'Service need — build the relevant service building (Market, Tavern, etc.).',
          action: { kind: 'toggle-need', tier: currentTier, needGuid: n.guid },
          children: subSteps,
        });
      }
      if (candidates.length === 0) {
        candidates.push({
          id: `cand-${cat}-none`,
          status: 'todo',
          title: `No more ${cat} needs available at this tier.`,
          detail: 'You may need to expand to higher tiers or check unlocks.',
        });
      }
    }
    return {
      id: `gate-cat-${cat}`,
      status: met ? 'done' : (have > 0 ? 'partial' : 'todo'),
      title: `${cat}: ${have}/${need} pt${need > 1 ? 's' : ''}`,
      detail: met
        ? 'Threshold met.'
        : `Need ${need - have} more point${need - have > 1 ? 's' : ''}. Tier-1 needs = 1pt, Tier-2 = 2pt, Tier-3 = 3pt.`,
      children: candidates,
    };
  });

  steps.push({
    id: 'gate',
    status: status.met ? 'done' : 'partial',
    title: status.met
      ? `${TIERS[nextTier].name} upgrade gate is met — upgrade your houses!`
      : `Meet ${TIERS[nextTier].name} upgrade gate (${gate.requiredCategories.length} categories × ${gate.pointsPerCategory} pt${gate.pointsPerCategory > 1 ? 's' : ''})`,
    detail: status.met
      ? 'Press U on a block of houses in-game to upgrade.'
      : `Missing in: ${status.missing.join(', ')}.`,
    children: gateChildren,
  });

  return steps;
}

/**
 * Build a flat-ish list of "build N× factory" steps for the given target
 * production rate (t/min). The rate comes from the residence count × the
 * need's per-house rate so the build counts match what the game actually
 * demands at the user's current scale.
 */
function buildChainSteps(productGuid: number, state: PlanState, ratePerMin: number): PathStep[] {
  const tree = buildChain(productGuid, state.region, ratePerMin);
  if (!tree) {
    return [{
      id: `chain-${productGuid}-noprod`,
      status: 'todo',
      title: `Import ${PRODUCTS[productGuid]?.name ?? '?'} from the other province`,
      detail: 'No producer in this region — set up a trade route.',
    }];
  }
  const out: PathStep[] = [];
  walkChainTree(tree, state, out, new Set());
  return out;
}

function walkChainTree(
  node: ChainNode,
  state: PlanState,
  acc: PathStep[],
  seen: Set<number>,
) {
  // Deepest dependencies first — when reading the list top-down, the user
  // sees raw producers (Hemp Farm) before processors (Spinner). That matches
  // the build order in-game.
  for (const c of node.children) walkChainTree(c, state, acc, seen);
  if (seen.has(node.factory.guid)) return;
  seen.add(node.factory.guid);
  const needed = wholeBuildings(node.count);
  const built = state.built[node.factory.guid] ?? 0;
  const status: PathStep['status'] =
    built >= needed ? 'done' : built > 0 ? 'partial' : 'todo';
  acc.push({
    id: `factory-${node.factory.guid}`,
    status,
    title: FACTORIES[node.factory.guid].name,
    action: { kind: 'build', factoryGuid: node.factory.guid, needed, built },
  });
}
