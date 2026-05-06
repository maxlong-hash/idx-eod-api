import { atr, clamp, crossover, dmi, ema, highest, highestPrevious, lowest, lowestPrevious, pivotHighAt, pivotLowAt, rsi, safeDiv, sma } from './indicators';
import type { CleanEodRecord, MaxSettings, PlanLevels, Quadrant, RisenRegime, ScanResult, SignalFlags, SignalName, SniperLocation, StrategyName } from './types';

const MIN_ANALYSIS_BARS = 60;

export const DEFAULT_WATCHLIST = [
  'BBCA',
  'BBRI',
  'BMRI',
  'BBNI',
  'TLKM',
  'ASII',
  'GOTO',
  'UNTR',
  'ADRO',
  'MDKA',
  'AMMN',
  'BRIS',
  'PGAS',
  'PTBA',
  'INKP',
  'TPIA',
  'CPIN',
  'KLBF',
  'ICBP',
  'INDF',
].join(', ');

export const STRATEGY_OPTIONS: StrategyName[] = [
  'Full Grid (1-2-3-4)',
  'Extreme Dip (3-4)',
  'Sweet Spot (2-3)',
  'Mid-Reversal (2-4)',
  'Deep Value (1-3-4)',
  'The Gap (1-2-4)',
  'Sniper (1-3)',
  'Aggressive (1-2)',
];

export const DEFAULT_SETTINGS: MaxSettings = {
  useFvgFilter: false,
  gammaAggressive: false,
  lookbackLen: 150,
  vVolFactor: 1.3,
  useCrashFilter: true,
  adxLimit: 30,
  pivotLeft: 10,
  pivotRight: 1,
  useQuadFilter: false,
  showRisen: true,
  risenThresholdPct: 2,
  risenLookback: 3,
  risenVolumeMultiplier: 2,
  risenUseScored: true,
  strategy: 'Full Grid (1-2-3-4)',
  portfolioCapital: 100_000_000,
  startDate: '2024-01-01',
};

type RisenPoint = {
  regime: RisenRegime;
  score: number;
  insideRolling: boolean;
  recentUpBreak: boolean;
  volSurge: boolean;
  explosiveBull: boolean;
  refLow: number | null;
};

const EMPTY_FLAGS: SignalFlags = {
  sniper: false,
  beta: false,
  gamma: false,
  vshape: false,
  early: false,
};

function tickIdx(price: number): number {
  const step = tickSizeIdx(price);
  return Math.round(price / step) * step;
}

function tickSizeIdx(price: number): number {
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}

function getStrategyWeights(strategy: StrategyName): [number, number, number, number] {
  if (strategy === 'Extreme Dip (3-4)') return [0, 0, 0.4, 0.6];
  if (strategy === 'Sweet Spot (2-3)') return [0, 0.4, 0.6, 0];
  if (strategy === 'Mid-Reversal (2-4)') return [0, 0.35, 0, 0.65];
  if (strategy === 'Deep Value (1-3-4)') return [0.15, 0, 0.35, 0.5];
  if (strategy === 'The Gap (1-2-4)') return [0.15, 0.25, 0, 0.6];
  if (strategy === 'Sniper (1-3)') return [0.3, 0, 0.7, 0];
  if (strategy === 'Aggressive (1-2)') return [0.4, 0.6, 0, 0];
  return [0.1, 0.2, 0.3, 0.4];
}

function rounded(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function lotFromAllocation(capital: number, weight: number, price: number): number {
  if (!Number.isFinite(capital) || capital <= 0 || weight <= 0 || price <= 0) return 0;
  return Math.floor((capital * weight) / (price * 100));
}

function signalGroup(signal: SignalName): ScanResult['signalGroup'] {
  if (signal.includes('SNIPER') || signal === 'V-SHAPE' || signal === 'EARLY SWEEP') return 'reversal';
  if (signal.includes('GAMMA') || signal === 'G ACC') return 'momentum';
  if (signal === 'BETA BREAKOUT') return 'breakout';
  if (signal === 'UNSAFE DIP') return 'risk';
  return 'passive';
}

function activeSignalName(signal: SignalName): boolean {
  return ['SMART SNIPER', 'SNIPER COMBO', 'BETA BREAKOUT', 'SMART GAMMA', 'GAMMA PUMP', 'G ACC', 'V-SHAPE', 'EARLY SWEEP'].includes(signal);
}

function signalBonus(signal: SignalName): number {
  if (signal === 'SMART SNIPER') return 650;
  if (signal === 'SMART GAMMA') return 600;
  if (signal === 'G ACC') return 550;
  if (signal === 'V-SHAPE') return 450;
  if (signal === 'BETA BREAKOUT') return 400;
  return 0;
}

function collectActiveSignals(signal: SignalName, flags: SignalFlags): SignalName[] {
  const signals: SignalName[] = [];
  if (flags.sniper) signals.push(signal === 'SMART SNIPER' ? 'SMART SNIPER' : 'SNIPER COMBO');
  if (flags.beta) signals.push('BETA BREAKOUT');
  if (flags.gamma) signals.push(signal === 'G ACC' || signal === 'SMART GAMMA' ? signal : 'GAMMA PUMP');
  if (flags.vshape) signals.push('V-SHAPE');
  if (flags.early) signals.push('EARLY SWEEP');
  return signals;
}

function getSniperLocation(sniper: boolean, inStruct: boolean, inDiscount: boolean): SniperLocation {
  if (!sniper) return null;
  if (inStruct && inDiscount) return 'Structure + Discount';
  if (inStruct) return 'Demand Structure';
  if (inDiscount) return 'Discount Only';
  return null;
}

function getSupertrend(high: number[], low: number[], close: number[]) {
  const atr10 = atr(high, low, close, 10);
  const trendUp: number[] = Array(close.length).fill(0);
  const trendDn: number[] = Array(close.length).fill(0);
  const dir: number[] = Array(close.length).fill(1);
  const stop: number[] = Array(close.length).fill(0);

  for (let i = 0; i < close.length; i += 1) {
    const hl2 = (high[i] + low[i]) / 2;
    const range = atr10[i] ?? 0;
    const up = hl2 - 2 * range;
    const dn = hl2 + 2 * range;
    if (i === 0) {
      trendUp[i] = up;
      trendDn[i] = dn;
      stop[i] = up;
      continue;
    }
    trendUp[i] = close[i - 1] > trendUp[i - 1] ? Math.max(up, trendUp[i - 1]) : up;
    trendDn[i] = close[i - 1] < trendDn[i - 1] ? Math.min(dn, trendDn[i - 1]) : dn;
    dir[i] = close[i] > trendDn[i - 1] ? 1 : close[i] < trendUp[i - 1] ? -1 : dir[i - 1];
    stop[i] = dir[i] === 1 ? trendUp[i] : trendDn[i];
  }

  return { dir, stop };
}

function calculateRisen(records: CleanEodRecord[], settings: MaxSettings): RisenPoint[] {
  const high = records.map((row) => row.high);
  const low = records.map((row) => row.low);
  const close = records.map((row) => row.close);
  const volume = records.map((row) => row.volume);
  const atr14 = atr(high, low, close, 14).map((value) => value ?? 0);
  const atrBase = sma(atr14, 50);
  const volSma15 = sma(volume, 15);
  const volFast = sma(volume, 5);
  const volSlow = sma(volume, 20);

  const output: RisenPoint[] = [];
  let anchorStart: number | null = null;
  let refHigh: number | null = null;
  let refLow: number | null = null;
  let shockBar: number | null = null;
  let consCount = 0;

  for (let i = 0; i < records.length; i += 1) {
    const rollHigh = highestPrevious(high, 15, i);
    const rollLow = lowestPrevious(low, 15, i);
    const okRoll = rollHigh != null && rollLow != null && rollHigh > rollLow;

    if (okRoll && anchorStart == null) {
      anchorStart = i;
      refHigh = rollHigh;
      refLow = rollLow;
    }

    const okRef = refHigh != null && refLow != null && refHigh > refLow;
    const hiClose = highest(close, settings.risenLookback, i);
    const loClose = lowest(close, settings.risenLookback, i);
    const surge = okRef && volSma15[i] != null ? volume[i] > volSma15[i]! * settings.risenVolumeMultiplier : false;
    const recentUpBreak = okRef && hiClose != null ? hiClose > refHigh! : false;
    const recentDnBreak = okRef && loClose != null ? loClose < refLow! : false;
    const upThresh = okRef ? refHigh! * (1 + settings.risenThresholdPct / 100) : null;
    const dnThresh = okRef ? refLow! * (1 - settings.risenThresholdPct / 100) : null;
    const explosiveBull = okRef && upThresh != null && close[i] > upThresh && surge && recentUpBreak;
    const crashSelloff = okRef && dnThresh != null && close[i] < dnThresh && surge && recentDnBreak;

    if (explosiveBull || crashSelloff) shockBar = i;
    const postShock = shockBar != null && i - shockBar <= 40;

    const insideRolling = okRoll ? close[i] <= rollHigh! && close[i] >= rollLow! : false;
    const atrRatio = atrBase[i] && atrBase[i] !== 0 ? atr14[i] / atrBase[i]! : 0;
    const atrScore = clamp(((1 - atrRatio) / (1 - 0.75)) * 100, 0, 100);
    const rangeDen = atr14[i] * 3;
    const rangeRatio = okRoll && rangeDen !== 0 ? (rollHigh! - rollLow!) / rangeDen : 0;
    const rangeScore = clamp(((1.5 - rangeRatio) / 0.5) * 100, 0, 100);
    const volRatio = volSma15[i] && volSma15[i] !== 0 ? volume[i] / volSma15[i]! : 0;
    const volQuietScore = clamp(((2 - volRatio) / (2 - 1.1)) * 100, 0, 100);
    const volSlopeRatio = volSlow[i] && volSlow[i] !== 0 && volFast[i] != null ? volFast[i]! / volSlow[i]! : 0;
    const volCoolScore = clamp(((1.2 - volSlopeRatio) / (1.2 - 1)) * 100, 0, 100);
    const volScore = 0.7 * volQuietScore + 0.3 * volCoolScore;
    const score = insideRolling ? (0.4 * atrScore + 0.35 * rangeScore + 0.25 * volScore) : 0;
    const scoreThreshold = postShock ? 60 : 70;
    const consCond = insideRolling && (!settings.risenUseScored || score >= scoreThreshold);
    consCount = consCond ? consCount + 1 : 0;
    const needBars = postShock ? 5 : 15;
    const consolidationFormed = okRoll && consCount >= needBars;

    if (consolidationFormed && !(output[i - 1]?.insideRolling && consCount - 1 >= needBars)) {
      anchorStart = i;
      refHigh = rollHigh;
      refLow = rollLow;
      shockBar = null;
      consCount = 0;
    }

    const normalUp = okRef && close[i] > refHigh! && !explosiveBull;
    const normalDown = okRef && close[i] < refLow! && !crashSelloff;
    const sideways = okRef && close[i] >= refLow! && close[i] <= refHigh! && !explosiveBull && !crashSelloff;
    const regime: RisenRegime = explosiveBull
      ? 'EXPLOSIVE BULL'
      : crashSelloff
        ? 'CRASH / SELL-OFF'
        : normalUp
          ? 'NORMAL UPTREND'
          : normalDown
            ? 'NORMAL DOWNTREND'
            : sideways
              ? 'SIDEWAYS'
              : 'N/A';

    output.push({
      regime,
      score,
      insideRolling,
      recentUpBreak,
      volSurge: surge,
      explosiveBull,
      refLow,
    });
  }

  return output;
}

function alignBenchmark(records: CleanEodRecord[], benchmark: CleanEodRecord[]) {
  const byDate = new Map(benchmark.map((row) => [row.date, row.close]));
  const sortedBench = [...benchmark].sort((a, b) => a.date.localeCompare(b.date));
  let pointer = 0;
  let last = sortedBench[0]?.close ?? 1;

  return records.map((row) => {
    while (pointer < sortedBench.length && sortedBench[pointer].date <= row.date) {
      last = sortedBench[pointer].close;
      pointer += 1;
    }
    return byDate.get(row.date) ?? last;
  });
}

function calculateQuadrants(records: CleanEodRecord[], benchmark: CleanEodRecord[]): Quadrant[] {
  if (!benchmark.length) return records.map(() => 'N/A');
  const close = records.map((row) => row.close);
  const benchClose = alignBenchmark(records, benchmark);
  const rs = close.map((value, i) => value / (benchClose[i] || 1));
  const rsEma20 = ema(rs, 20);
  const rsr = rs.map((value, i) => 100 * safeDiv(value, rsEma20[i] ?? 1, 1));
  const rsrS = ema(rsr, 2);
  const rsmBase = ema(rsrS.map((value) => value ?? 100), 10);
  const thr = 0.5;

  return records.map((_, i) => {
    const trend = rsrS[i] ?? 100;
    const momentum = 100 * safeDiv(trend, rsmBase[i] ?? 100, 1);
    if (trend > 100 + thr && momentum > 100 + thr) return 'LEADING';
    if (trend <= 100 - thr && momentum > 100 + thr) return 'IMPROVING';
    if (trend > 100 + thr && momentum <= 100 - thr) return 'WEAKENING';
    return 'LAGGING';
  });
}

function smartResistance(
  close: number,
  highs: number[],
  pivotHighs: number[],
  index: number,
): { r1: number | null; r2: number | null; r1Tests: number; r2Tests: number } {
  const candidates = pivotHighs.filter((value) => value > close * 1.005).sort((a, b) => a - b);
  const countTouches = (level: number | null) => {
    if (level == null) return 0;
    const tolerance = level * 0.005;
    let count = 0;
    for (let i = Math.max(0, index - 100); i < index; i += 1) {
      if (highs[i] >= level - tolerance && highs[i] <= level + tolerance) count += 1;
    }
    return count;
  };
  const r1 = candidates[0] ?? null;
  const r2 = candidates[1] ?? null;
  return { r1, r2, r1Tests: countTouches(r1), r2Tests: countTouches(r2) };
}

function buildPlan(
  index: number,
  records: CleanEodRecord[],
  atr14: (number | null)[],
  pivotHighs: number[],
  lastStructLow: number | null,
  strategy: StrategyName,
  portfolioCapital: number,
): PlanLevels | null {
  const row = records[index];
  const highs = records.map((item) => item.high);
  const anchorLow = Math.min(row.low, lastStructLow ?? row.low);
  const structRef = row.close;
  const structRange = structRef - anchorLow;
  if (structRange <= 0) return null;

  const buy1 = tickIdx(structRef);
  const buy2 = tickIdx(anchorLow + structRange * 0.5);
  const buy3 = tickIdx(anchorLow + structRange * 0.382);
  const buy4 = tickIdx(anchorLow + structRange * 0.214);
  const [weight1, weight2, weight3, weight4] = getStrategyWeights(strategy);
  const weightedShare =
    (weight1 > 0 ? weight1 / buy1 : 0) +
    (weight2 > 0 ? weight2 / buy2 : 0) +
    (weight3 > 0 ? weight3 / buy3 : 0) +
    (weight4 > 0 ? weight4 / buy4 : 0);
  const totalWeight = weight1 + weight2 + weight3 + weight4;
  const theoreticalAvgEntry = weightedShare > 0 ? totalWeight / weightedShare : buy1;
  const capital = Math.max(portfolioCapital || 0, 0);
  const allocation1 = capital * weight1;
  const allocation2 = capital * weight2;
  const allocation3 = capital * weight3;
  const allocation4 = capital * weight4;
  const lot1 = lotFromAllocation(capital, weight1, buy1);
  const lot2 = lotFromAllocation(capital, weight2, buy2);
  const lot3 = lotFromAllocation(capital, weight3, buy3);
  const lot4 = lotFromAllocation(capital, weight4, buy4);
  const totalLots = lot1 + lot2 + lot3 + lot4;
  const deployed1 = lot1 * buy1 * 100;
  const deployed2 = lot2 * buy2 * 100;
  const deployed3 = lot3 * buy3 * 100;
  const deployed4 = lot4 * buy4 * 100;
  const totalDeployed = deployed1 + deployed2 + deployed3 + deployed4;
  const avgEntry = totalLots > 0 ? totalDeployed / (totalLots * 100) : theoreticalAvgEntry;
  const cashLeft = Math.max(capital - totalDeployed, 0);
  const stopLoss = tickIdx(anchorLow - (atr14[index] ?? 0) * 0.2);
  const risk = Math.max(buy1 - stopLoss, 1);
  const resistance = smartResistance(row.close, highs, pivotHighs, index);
  const minTp1 = buy1 + risk * 1.5;
  const tp1 = tickIdx(resistance.r1 != null && resistance.r1 >= minTp1 ? resistance.r1 : minTp1);
  const minTp2 = buy1 + risk * 3;
  let tp2Raw = Math.max(minTp2, tp1 * 1.1);
  if (resistance.r2 != null && resistance.r2 >= minTp2) tp2Raw = resistance.r2;
  else if (resistance.r2 != null && resistance.r2 > tp1) tp2Raw = resistance.r2;
  const tp2 = tickIdx(tp2Raw);
  const tp2Fib = tickIdx(Math.max(anchorLow + structRange * 1.618, tp2));
  const riskPct = ((buy1 - stopLoss) / buy1) * 100;
  const avgRiskPct = ((avgEntry - stopLoss) / avgEntry) * 100;
  const upsidePct = ((tp2 - buy1) / buy1) * 100;
  const avgUpsidePct = ((tp2 - avgEntry) / avgEntry) * 100;

  return {
    strategy,
    buy1,
    buy2,
    buy3,
    buy4,
    weight1,
    weight2,
    weight3,
    weight4,
    allocation1: rounded(allocation1, 0),
    allocation2: rounded(allocation2, 0),
    allocation3: rounded(allocation3, 0),
    allocation4: rounded(allocation4, 0),
    lot1,
    lot2,
    lot3,
    lot4,
    totalLots,
    totalDeployed: rounded(totalDeployed, 0),
    cashLeft: rounded(cashLeft, 0),
    portfolioCapital: rounded(capital, 0),
    theoreticalAvgEntry: rounded(theoreticalAvgEntry, 2),
    avgEntry: rounded(avgEntry, 2),
    stopLoss,
    tp1,
    tp2,
    tp2Fib,
    riskPct: rounded(riskPct),
    avgRiskPct: rounded(avgRiskPct),
    upsidePct: rounded(upsidePct),
    avgUpsidePct: rounded(avgUpsidePct),
    rewardRisk: rounded(upsidePct / Math.max(riskPct, 0.01)),
    avgRewardRisk: rounded(avgUpsidePct / Math.max(avgRiskPct, 0.01)),
  };
}

export function analyzeTicker(
  ticker: string,
  records: CleanEodRecord[],
  settings: MaxSettings,
  benchmark: CleanEodRecord[] = [],
): ScanResult {
  const clean = records.filter((row) => Number.isFinite(row.close) && Number.isFinite(row.volume));
  const fullHistoryBars = Math.max(settings.lookbackLen, 220);
  const historyQuality = clean.length >= fullHistoryBars ? 'FULL' : 'IPO / SHORT';
  if (clean.length < MIN_ANALYSIS_BARS) {
    throw new Error(`Data ${ticker} hanya ${clean.length} bar; minimal sekitar ${MIN_ANALYSIS_BARS} bar untuk mode IPO.`);
  }

  const open = clean.map((row) => row.open);
  const high = clean.map((row) => row.high);
  const low = clean.map((row) => row.low);
  const close = clean.map((row) => row.close);
  const volume = clean.map((row) => row.volume);
  const ema21 = ema(close, 21);
  const ema50 = ema(close, 50);
  const ema200 = ema(close, 200);
  const volSma20 = sma(volume, 20);
  const atr14 = atr(high, low, close, 14);
  const rsi14 = rsi(close, 14);
  const dmi14 = dmi(high, low, close, 14, 14);
  const supertrend = getSupertrend(high, low, close);
  const risen = calculateRisen(clean, settings);
  const quadrants = calculateQuadrants(clean, benchmark);
  const pivotHighs: number[] = [];

  let demTop: number | null = null;
  let demBot: number | null = null;
  let lastSwingLow: number | null = null;
  let lastSwingRsi: number | null = null;
  let lastStructLow: number | null = null;
  let gRefPrice: number | null = null;
  let latestPlan: PlanLevels | null = null;
  let latestSignal: SignalName = 'WAIT';
  let latestFlags: SignalFlags = { ...EMPTY_FLAGS };
  let latestActiveSignals: SignalName[] = [];
  let latestSniperLocation: SniperLocation = null;
  let latestReason: string[] = [];
  let lastBuyTime: number | null = null;
  let lastActiveSignal: SignalName | null = null;
  let lastActiveSignals: SignalName[] = [];
  let lastSniperLocation: SniperLocation = null;
  let lastActiveDate: string | null = null;

  for (let i = 0; i < clean.length; i += 1) {
    const pivotHigh = pivotHighAt(high, i, settings.pivotLeft, settings.pivotRight);
    if (pivotHigh != null) {
      pivotHighs.push(pivotHigh);
      if (pivotHighs.length > 30) pivotHighs.shift();
    }

    const pivotLow = pivotLowAt(low, i, settings.pivotLeft, settings.pivotRight);
    if (pivotLow != null) {
      const pivotIndex = i - settings.pivotRight;
      demBot = pivotLow;
      demTop = high[pivotIndex];
      lastSwingLow = pivotLow;
      lastSwingRsi = rsi14[pivotIndex];
      lastStructLow = pivotLow;
    }

    const hh = highest(high, settings.lookbackLen, i);
    const ll = lowest(low, settings.lookbackLen, i);
    if (hh == null || ll == null || volSma20[i] == null || rsi14[i] == null) continue;

    const midRange = (hh + ll) / 2;
    const belowEquilibrium = close[i] < midRange;
    const premiumZone = close[i] >= midRange;
    const tolerance = high[i] - low[i];
    const structTickTolerance = tickSizeIdx(close[i]);
    let inStruct = demTop != null && demBot != null ? close[i] <= demTop + tolerance + structTickTolerance && close[i] >= demBot : false;
    if (demBot != null && close[i] < demBot) inStruct = false;
    const midFib = ll + (hh - ll) * 0.382;
    const inDiscount = close[i] < midFib;
    const plusDi = dmi14.plusDi[i] ?? 0;
    const minusDi = dmi14.minusDi[i] ?? 0;
    const adxValue = dmi14.adx[i] ?? 0;
    const crashing = adxValue > settings.adxLimit && minusDi > plusDi;
    const safeFromCrash = settings.useCrashFilter ? !crashing : true;
    const hasFvg = i >= 2 ? low[i] > high[i - 2] : false;
    const fvgValid = settings.useFvgFilter ? hasFvg : true;
    const prevRed = i > 0 && close[i - 1] < open[i - 1];
    const currGreen = close[i] > open[i];
    const midPrev = i > 0 ? (open[i - 1] + close[i - 1]) / 2 : 0;
    const body = Math.abs(close[i] - open[i]);
    const range = high[i] - low[i];
    const upperWick = high[i] - close[i];
    const lowerWick = open[i] - low[i];
    const decentBody = range > 0 && body > range * 0.4;
    const smallUpper = upperWick < body;
    const candleOk = currGreen && decentBody && smallUpper;
    const trendFlip = i > 0 && supertrend.dir[i] === 1 && supertrend.dir[i - 1] === -1;
    const trendCont = supertrend.dir[i] === 1;
    const rsiOk = rsi14[i]! > 50;
    const rsiCross = crossover(rsi14, 50, i);
    const volumeOk = volume[i] > volSma20[i]! * 1.2;
    const validLocSniper = (inStruct || inDiscount) && belowEquilibrium;
    const triggerSniper = (trendFlip && rsiOk) || (trendCont && rsiCross);
    let sigSniper = triggerSniper && validLocSniper && volumeOk && safeFromCrash && candleOk && fvgValid;
    let sigBeta = trendFlip && rsiOk && premiumZone && volumeOk && safeFromCrash && candleOk;

    const solidBodyV = range > 0 && body > range * 0.4;
    const smallWickV = upperWick < body * 0.8;
    const piercingV = i > 0 && close[i] > (open[i - 1] + close[i - 1]) / 2;
    const volSpikeV = volume[i] > volSma20[i]! * settings.vVolFactor;
    const classicLow = i > 0 && low[i - 1] <= (lowest(low, 10, i - 1) ?? low[i - 1]);
    const delayedLow = i > 1 && low[i - 2] <= (lowest(low, 10, i - 2) ?? low[i - 2]) && close[i - 1] < open[i - 1];
    const validBottomLoc = classicLow || delayedLow;
    const nearestRes = Math.min(ema21[i] ?? close[i], supertrend.stop[i]);
    const gapToRes = ((nearestRes - close[i]) / close[i]) * 100;
    const gapOk = supertrend.dir[i] === -1 ? gapToRes > 2 : true;
    const wickSafe = ema21[i] != null ? high[i] < ema21[i]! * 1.005 : true;
    const condStd = gapOk && wickSafe;
    const engulfing = i > 0 && close[i] >= open[i - 1];
    const condPower = validBottomLoc && prevRed && engulfing && volSpikeV;
    let sigVshape = prevRed && currGreen && piercingV && volSpikeV && (condStd || condPower) && safeFromCrash;

    const gammaRsiCap = settings.gammaAggressive ? 99 : 90;
    const gammaWickTol = settings.gammaAggressive ? 1 : 0.4;
    const condSafe = close[i] > (ema200[i] ?? Infinity) && close[i] > (ema50[i] ?? Infinity);
    const strongCandle = range > 0 && body > range * 0.5 && upperWick < body * gammaWickTol;
    const rsiValid = rsi14[i]! > 50 && rsi14[i]! < gammaRsiCap;
    const baseAlpha = condSafe && volumeOk && supertrend.dir[i] === 1 && strongCandle;
    let sigGamma = baseAlpha && rsiValid && !sigVshape && !sigSniper && !sigBeta;

    const sweepLiq = lastSwingLow != null && low[i] < lastSwingLow;
    const rsiDiv = lastSwingRsi != null && rsi14[i]! > lastSwingRsi;
    const powerCandle = range > 0 && body > range * 0.3 && upperWick < body;
    const hammer = lowerWick > body * 2;
    const validCandle = close[i] > open[i] && (powerCandle || hammer);
    let sigEarly = sweepLiq && rsiDiv && validCandle && validLocSniper && safeFromCrash && !sigSniper && !sigVshape;

    let signal: SignalName = sigSniper
      ? 'SNIPER COMBO'
      : sigBeta
        ? 'BETA BREAKOUT'
        : sigEarly
          ? 'EARLY SWEEP'
          : sigVshape
            ? 'V-SHAPE'
            : sigGamma
              ? 'GAMMA PUMP'
              : supertrend.dir[i] === 1
                ? 'HOLD'
                : 'AVOID';

    const currentRisen = risen[i];
    if (settings.showRisen) {
      const smartGamma = sigGamma && (currentRisen.explosiveBull || (currentRisen.recentUpBreak && currentRisen.volSurge) || (currentRisen.insideRolling && currentRisen.score >= 70));
      if (sigGamma && smartGamma) {
        signal = 'SMART GAMMA';
      } else if (sigGamma) {
        sigGamma = false;
        signal = supertrend.dir[i] === 1 ? 'HOLD' : 'AVOID';
      }

      if (sigSniper) {
        const structSafe = currentRisen.refLow != null ? close[i] >= currentRisen.refLow * 0.98 : true;
        const regimeSafe = currentRisen.regime !== 'CRASH / SELL-OFF' && currentRisen.regime !== 'NORMAL DOWNTREND';
        if (structSafe && regimeSafe) {
          signal = 'SMART SNIPER';
        } else {
          sigSniper = false;
          signal = 'UNSAFE DIP';
        }
      }
    }

    if (settings.useQuadFilter && quadrants[i] === 'LAGGING') {
      if (sigBeta) {
        sigBeta = false;
        signal = 'WAIT';
      }
      if (sigGamma) {
        sigGamma = false;
        signal = 'WAIT';
      }
    }

    if (supertrend.dir[i] === -1) gRefPrice = null;
    if (sigGamma) {
      if (gRefPrice != null && close[i] > gRefPrice) signal = 'G ACC';
      gRefPrice = close[i];
    }

    const planTrigger = sigSniper || sigVshape || sigGamma || sigBeta;
    if (planTrigger) {
      latestPlan = buildPlan(i, clean, atr14, pivotHighs, lastStructLow, settings.strategy, settings.portfolioCapital);
    }

    const currentFlags = { sniper: sigSniper, beta: sigBeta, gamma: sigGamma, vshape: sigVshape, early: sigEarly };
    const currentActiveSignals = collectActiveSignals(signal, currentFlags);
    const currentSniperLocation = getSniperLocation(sigSniper, inStruct, inDiscount);

    if (currentActiveSignals.length > 0) {
      lastBuyTime = new Date(clean[i].date).getTime();
      lastActiveSignal = currentActiveSignals[0];
      lastActiveSignals = currentActiveSignals;
      lastSniperLocation = currentSniperLocation;
      lastActiveDate = clean[i].date;
    }

    latestSignal = signal;
    latestFlags = currentFlags;
    latestActiveSignals = currentActiveSignals;
    latestSniperLocation = currentSniperLocation;
    latestReason = [
      supertrend.dir[i] === 1 ? 'Supertrend bullish' : 'Supertrend bearish',
      rsi14[i]! > 50 ? `RSI ${rounded(rsi14[i]!).toFixed(1)} > 50` : `RSI ${rounded(rsi14[i]!).toFixed(1)} lemah`,
      volumeOk ? `Volume valid ${rounded(volume[i] / volSma20[i]!, 2)}x` : `Volume ${rounded(volume[i] / volSma20[i]!, 2)}x`,
      safeFromCrash ? 'Lolos anti-crash ADX' : 'Crash filter aktif',
      settings.showRisen ? `RISEN ${currentRisen.regime}` : 'RISEN off',
    ];
  }

  const last = clean[clean.length - 1];
  const lastIndex = clean.length - 1;
  const currentRvol = volSma20[lastIndex] ? last.volume / volSma20[lastIndex]! : 0;
  const active = latestActiveSignals.length > 0 || activeSignalName(latestSignal);
  const ageDays = lastBuyTime == null ? 999 : Math.round((new Date(last.date).getTime() - lastBuyTime) / 86_400_000);
  const currentSignalBonus = latestActiveSignals.reduce((best, item) => Math.max(best, signalBonus(item)), signalBonus(latestSignal));
  const score =
    (active ? 3000 : 0) +
    (ageDays < 999 ? 1000 - ageDays * 2 : 0) +
    (risen[lastIndex].regime === 'EXPLOSIVE BULL' ? 500 : risen[lastIndex].regime === 'CRASH / SELL-OFF' ? 400 : 0) +
    (quadrants[lastIndex] === 'LEADING' ? 100 : quadrants[lastIndex] === 'IMPROVING' ? 50 : 0) +
    (currentRvol > 2 ? 20 : 0) +
    currentSignalBonus;

  return {
    ticker,
    latestDate: last.date,
    historyBars: clean.length,
    historyQuality,
    price: last.close,
    changePct: last.changePercent,
    signal: latestSignal,
    activeSignals: latestActiveSignals,
    lastActiveSignal,
    lastActiveSignals,
    lastActiveDate,
    signalGroup: signalGroup(latestSignal),
    activeSignal: active,
    flags: latestFlags,
    sniperLocation: latestSniperLocation,
    lastSniperLocation,
    status: supertrend.dir[lastIndex] === 1 ? 'UPTREND' : 'DOWNTREND',
    regime: risen[lastIndex].regime,
    quadrant: quadrants[lastIndex],
    rvol: rounded(currentRvol, 2),
    adx: rounded(dmi14.adx[lastIndex] ?? 0, 2),
    rsi: rounded(rsi14[lastIndex] ?? 0, 2),
    score: Math.round(score),
    ageDays,
    reason: latestReason,
    plan: latestPlan,
    records: clean,
    sparkline: clean.slice(-60).map((row) => row.close),
  };
}
