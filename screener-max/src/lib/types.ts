export type EodRecord = {
  id?: string;
  ticker: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  tradeFrequency?: number | null;
  tradeValue?: number | null;
  nbsa?: number | null;
  previousClose?: number | null;
  change?: number | null;
  changePercent?: number | null;
};

export type CleanEodRecord = {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePercent: number;
};

export type EodHistoryResponse = {
  ticker: string;
  startDate: string | null;
  endDate: string | null;
  latestAvailableDate: string | null;
  returned: number;
  records: EodRecord[];
};

export type SignalName =
  | 'SMART SNIPER'
  | 'SNIPER COMBO'
  | 'BETA BREAKOUT'
  | 'SMART GAMMA'
  | 'GAMMA PUMP'
  | 'G ACC'
  | 'V-SHAPE'
  | 'EARLY SWEEP'
  | 'UNSAFE DIP'
  | 'WAIT'
  | 'HOLD'
  | 'AVOID';

export type RisenRegime = 'EXPLOSIVE BULL' | 'CRASH / SELL-OFF' | 'NORMAL UPTREND' | 'NORMAL DOWNTREND' | 'SIDEWAYS' | 'N/A';

export type Quadrant = 'LEADING' | 'IMPROVING' | 'WEAKENING' | 'LAGGING' | 'N/A';

export type MaxSettings = {
  useFvgFilter: boolean;
  gammaAggressive: boolean;
  lookbackLen: number;
  vVolFactor: number;
  useCrashFilter: boolean;
  adxLimit: number;
  pivotLeft: number;
  pivotRight: number;
  useQuadFilter: boolean;
  showRisen: boolean;
  risenThresholdPct: number;
  risenLookback: number;
  risenVolumeMultiplier: number;
  risenUseScored: boolean;
  strategy: StrategyName;
  portfolioCapital: number;
  startDate: string;
};

export type StrategyName =
  | 'Full Grid (1-2-3-4)'
  | 'Extreme Dip (3-4)'
  | 'Sweet Spot (2-3)'
  | 'Mid-Reversal (2-4)'
  | 'Deep Value (1-3-4)'
  | 'The Gap (1-2-4)'
  | 'Sniper (1-3)'
  | 'Aggressive (1-2)';

export type PlanLevels = {
  strategy: StrategyName;
  buy1: number;
  buy2: number;
  buy3: number;
  buy4: number;
  weight1: number;
  weight2: number;
  weight3: number;
  weight4: number;
  allocation1: number;
  allocation2: number;
  allocation3: number;
  allocation4: number;
  lot1: number;
  lot2: number;
  lot3: number;
  lot4: number;
  totalLots: number;
  totalDeployed: number;
  cashLeft: number;
  portfolioCapital: number;
  theoreticalAvgEntry: number;
  avgEntry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp2Fib: number;
  rewardRisk: number;
  avgRewardRisk: number;
  riskPct: number;
  avgRiskPct: number;
  upsidePct: number;
  avgUpsidePct: number;
};

export type SignalFlags = {
  sniper: boolean;
  beta: boolean;
  gamma: boolean;
  vshape: boolean;
  early: boolean;
};

export type SniperLocation = 'Demand Structure' | 'Discount Only' | 'Structure + Discount' | null;

export type HistoryQuality = 'FULL' | 'IPO / SHORT';

export type ScanResult = {
  ticker: string;
  latestDate: string;
  latestAvailableDate?: string | null;
  historyBars: number;
  historyQuality: HistoryQuality;
  price: number;
  changePct: number;
  signal: SignalName;
  activeSignals: SignalName[];
  lastActiveSignal: SignalName | null;
  lastActiveSignals: SignalName[];
  lastActiveDate: string | null;
  signalGroup: 'reversal' | 'momentum' | 'breakout' | 'passive' | 'risk';
  activeSignal: boolean;
  flags: SignalFlags;
  sniperLocation: SniperLocation;
  lastSniperLocation: SniperLocation;
  status: 'UPTREND' | 'DOWNTREND';
  regime: RisenRegime;
  quadrant: Quadrant;
  rvol: number;
  adx: number;
  rsi: number;
  score: number;
  ageDays: number;
  reason: string[];
  plan: PlanLevels | null;
  records: CleanEodRecord[];
  sparkline: number[];
  error?: string;
};
