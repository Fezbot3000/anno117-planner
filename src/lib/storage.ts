import type { RegionId } from '../data/game';

export interface IslandTarget {
  productGuid: number;
  ratePerMin: number;
}

export interface Island {
  id: string;
  name: string;
  region: RegionId;
  fertilities: number[]; // available fertility/deposit GUIDs
  targets: IslandTarget[];
  notes?: string;
}

const KEY = 'anno117-planner.islands.v1';

export function loadIslands(): Island[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveIslands(islands: Island[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(islands));
  } catch {
    // ignore quota errors
  }
}

export function newIsland(region: RegionId): Island {
  return {
    id: crypto.randomUUID(),
    name: region === 'latium' ? 'New Latium island' : 'New Albion island',
    region,
    fertilities: [],
    targets: [],
  };
}
