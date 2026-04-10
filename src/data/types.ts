export type Region = 'latium' | 'albion' | 'both';
export type Tier =
  | 'infrastructure'
  | 'liberti'
  | 'plebeians'
  | 'equites'
  | 'patricians'
  | 'waders'
  | 'smiths'
  | 'aldermen'
  | 'mercators'
  | 'nobles';

export interface Building {
  id: string;
  name: string;
  region: Region;
  tier: Tier;
  productionTimeSec: number;
  output: string;
  inputs: { resource: string; amount: number }[];
  constructionCost: { planks?: number; tiles?: number; stone?: number; iron?: number };
  maintenanceCost: { denarii: number; workforce: number };
  terrainRequirement?: string;
  placementTips: string[];
  sharedWith?: string[];
}

export interface ChainStep {
  buildingId: string;
  count: number;
}

export interface ProductionChain {
  id: string;
  name: string;
  region: Region;
  tier: Tier;
  outputGood: string;
  steps: ChainStep[];
  optimalRatio: string;
  totalBuildingCount: number;
  sharedBuildings?: string[];
  placementSummary: string;
}
