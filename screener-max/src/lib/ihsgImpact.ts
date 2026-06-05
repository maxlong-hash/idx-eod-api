import { IHSG_FLOAT_INPUTS, IHSG_FLOAT_SOURCE_META, getIhsgFloatInput } from './ihsgFloatData';
import type { IhsgFloatConfidence, IhsgFloatInput } from './ihsgFloatData';
import type { CleanEodRecord, ScanResult } from './types';

const DEFAULT_CAP_PCT = 9;

const GROUP_DEFINITIONS = [
  { id: 'big-banks', label: 'Big Banks', tickers: ['BBCA', 'BBRI', 'BMRI', 'BBNI', 'BRIS', 'BBTN', 'ARTO'] },
  { id: 'pp-barito', label: 'PP / Barito', tickers: ['BRPT', 'BREN', 'TPIA', 'CUAN', 'PTRO', 'CDIA'] },
  { id: 'telco-tech', label: 'Telco / Tech', tickers: ['TLKM', 'ISAT', 'EXCL', 'GOTO', 'BELI', 'MTEL', 'TOWR'] },
  { id: 'commodities', label: 'Commodities', tickers: ['ADRO', 'AADI', 'AMMN', 'ANTM', 'INCO', 'MDKA', 'MBMA', 'PTBA', 'ITMG', 'PGAS', 'MEDC', 'HRUM'] },
  { id: 'consumer', label: 'Consumer', tickers: ['AMRT', 'ICBP', 'INDF', 'CPIN', 'MYOR', 'UNVR', 'KLBF', 'SIDO'] },
  { id: 'auto-heavy', label: 'Auto / Heavy', tickers: ['ASII', 'UNTR', 'AUTO', 'DRMA'] },
  { id: 'property-infra', label: 'Property / Infra', tickers: ['PANI', 'BSDE', 'CTRA', 'SMRA', 'PWON', 'JSMR', 'SSIA'] },
] as const;

export type IhsgImpactSource = 'KSEI_RESIDUAL' | 'IDX_BENCHMARK';

export type IhsgImpactRow = {
  ticker: string;
  issuer: string;
  latestDate: string;
  price: number;
  previousPrice: number | null;
  changePct: number;
  volume: number;
  turnoverValue: number;
  floatPct: number;
  idxFreeFloatPct: number | null;
  driftPct: number | null;
  confidence: IhsgFloatConfidence;
  source: IhsgImpactSource;
  holderCount: number;
  estimatedShares: number | null;
  marketCap: number;
  freeFloatMarketCap: number;
  rawWeightPct: number;
  cappedWeightPct: number;
  impactPct: number;
  impactPoints: number | null;
  signal: ScanResult['signal'] | null;
  tradeFrequency: number | null;
  nbsa: number | null;
  groupLabel: string;
};

export type IhsgMoverGroup = {
  id: string;
  label: string;
  memberCount: number;
  weightPct: number;
  impactPct: number;
  impactPoints: number | null;
  avgChangePct: number;
  leaders: IhsgImpactRow[];
};

export type IhsgIndexSnapshot = {
  date: string;
  close: number;
  previousClose: number | null;
  changePct: number;
};

type WeightBaseRow = {
  ticker: string;
  input: IhsgFloatInput;
  floatPct: number;
  marketCap: number;
  freeFloatMarketCap: number;
};

type ImpactInputRow = {
  ticker: string;
  latestDate: string;
  price: number;
  previousPrice: number | null;
  changePct: number;
  volume: number;
  turnoverValue: number;
  tradeFrequency: number | null;
  nbsa: number | null;
  signal: ScanResult['signal'] | null;
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function usableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function floatPctFromInput(input: IhsgFloatInput): { value: number | null; source: IhsgImpactSource } {
  const residual = usableNumber(input.residualFloatPct);
  if (residual != null) return { value: residual, source: 'KSEI_RESIDUAL' };
  const benchmark = usableNumber(input.idxFreeFloatPct);
  if (benchmark != null) return { value: benchmark, source: 'IDX_BENCHMARK' };
  return { value: null, source: 'IDX_BENCHMARK' };
}

function estimatePreviousPrice(price: number, changePct: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(changePct) || changePct <= -99.9) return null;
  return price / (1 + changePct / 100);
}

function estimateMarketCap(input: IhsgFloatInput, price?: number | null): number | null {
  if (price && input.estimatedShares && Number.isFinite(price) && price > 0) {
    return price * input.estimatedShares;
  }
  return usableNumber(input.idxMarketCap);
}

function applyCappedWeights(rows: WeightBaseRow[], capPct: number): Map<string, number> {
  const cappedWeights = new Map<string, number>();
  let remaining = rows.filter((row) => row.freeFloatMarketCap > 0);
  let remainingPct = 100;

  while (remaining.length > 0 && remainingPct > 0) {
    const total = remaining.reduce((sum, row) => sum + row.freeFloatMarketCap, 0);
    if (total <= 0) break;

    const overCap = remaining.filter((row) => (row.freeFloatMarketCap / total) * remainingPct > capPct);
    if (!overCap.length) {
      remaining.forEach((row) => {
        cappedWeights.set(row.ticker, (row.freeFloatMarketCap / total) * remainingPct);
      });
      break;
    }

    overCap.forEach((row) => cappedWeights.set(row.ticker, capPct));
    remainingPct -= overCap.length * capPct;
    const overCapTickers = new Set(overCap.map((row) => row.ticker));
    remaining = remaining.filter((row) => !overCapTickers.has(row.ticker));
  }

  return cappedWeights;
}

function groupForTicker(ticker: string): string {
  return GROUP_DEFINITIONS.find((group) => (group.tickers as readonly string[]).includes(ticker))?.label ?? 'Other IHSG';
}

export function getIhsgFloatMeta() {
  return IHSG_FLOAT_SOURCE_META;
}

export function getIhsgIndexSnapshot(records: CleanEodRecord[]): IhsgIndexSnapshot | null {
  const latest = records.at(-1);
  if (!latest) return null;
  const previousFromHistory = records.length >= 2 ? records[records.length - 2].close : null;
  const previousFromChange =
    Number.isFinite(latest.changePercent) && latest.changePercent > -99.9
      ? latest.close / (1 + latest.changePercent / 100)
      : null;
  return {
    date: latest.date,
    close: latest.close,
    previousClose: previousFromHistory ?? previousFromChange,
    changePct: latest.changePercent,
  };
}

function buildImpactRowsFromInputs(
  inputRows: ImpactInputRow[],
  options: { ihsgPreviousClose?: number | null; capPct?: number } = {},
): IhsgImpactRow[] {
  const capPct = options.capPct ?? DEFAULT_CAP_PCT;
  const rowsByTicker = new Map(inputRows.map((row) => [row.ticker, row]));

  const weightBaseRows: WeightBaseRow[] = IHSG_FLOAT_INPUTS.map((input) => {
    const { value: floatPct } = floatPctFromInput(input);
    const marketCap = estimateMarketCap(input, rowsByTicker.get(input.ticker)?.price);
    if (floatPct == null || marketCap == null) return null;
    return {
      ticker: input.ticker,
      input,
      floatPct,
      marketCap,
      freeFloatMarketCap: marketCap * (floatPct / 100),
    };
  }).filter((row): row is WeightBaseRow => row != null && row.freeFloatMarketCap > 0);

  const totalFreeFloatMarketCap = weightBaseRows.reduce((sum, row) => sum + row.freeFloatMarketCap, 0);
  const rawWeightByTicker = new Map(
    weightBaseRows.map((row) => [row.ticker, totalFreeFloatMarketCap > 0 ? (row.freeFloatMarketCap / totalFreeFloatMarketCap) * 100 : 0]),
  );
  const cappedWeightByTicker = applyCappedWeights(weightBaseRows, capPct);

  return inputRows
    .map((row) => {
      const input = getIhsgFloatInput(row.ticker);
      if (!input) return null;
      const { value: floatPct, source } = floatPctFromInput(input);
      const marketCap = estimateMarketCap(input, row.price);
      if (floatPct == null || marketCap == null) return null;

      const cappedWeightPct = cappedWeightByTicker.get(row.ticker) ?? 0;
      const impactPct = (cappedWeightPct * row.changePct) / 100;
      const impactPoints = options.ihsgPreviousClose ? options.ihsgPreviousClose * (impactPct / 100) : null;

      return {
        ticker: row.ticker,
        issuer: input.issuer,
        latestDate: row.latestDate,
        price: row.price,
        previousPrice: row.previousPrice,
        changePct: row.changePct,
        volume: row.volume,
        turnoverValue: row.turnoverValue,
        floatPct,
        idxFreeFloatPct: input.idxFreeFloatPct,
        driftPct: input.driftPct,
        confidence: input.confidence,
        source,
        holderCount: input.holderCount,
        estimatedShares: input.estimatedShares,
        marketCap,
        freeFloatMarketCap: marketCap * (floatPct / 100),
        rawWeightPct: rawWeightByTicker.get(row.ticker) ?? 0,
        cappedWeightPct,
        impactPct,
        impactPoints,
        signal: row.signal,
        tradeFrequency: row.tradeFrequency,
        nbsa: row.nbsa,
        groupLabel: groupForTicker(row.ticker),
      };
    })
    .filter((row): row is IhsgImpactRow => row != null)
    .sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct));
}

export function buildIhsgImpactRows(
  results: ScanResult[],
  options: { ihsgPreviousClose?: number | null; capPct?: number } = {},
): IhsgImpactRow[] {
  return buildImpactRowsFromInputs(
    results.map((result) => {
      const latestRecord = result.records[result.records.length - 1];
      const volume = latestRecord?.volume ?? 0;
      return {
        ticker: result.ticker,
        latestDate: result.latestDate,
        price: result.price,
        previousPrice: estimatePreviousPrice(result.price, result.changePct),
        changePct: result.changePct,
        volume,
        turnoverValue: latestRecord?.tradeValue ?? volume * result.price,
        tradeFrequency: latestRecord?.tradeFrequency ?? null,
        nbsa: latestRecord?.nbsa ?? null,
        signal: result.signal,
      };
    }),
    options,
  );
}

export function buildIhsgImpactRowsFromMarket(
  records: CleanEodRecord[],
  options: { ihsgPreviousClose?: number | null; capPct?: number } = {},
): IhsgImpactRow[] {
  return buildImpactRowsFromInputs(
    records.map((record) => ({
      ticker: record.ticker,
      latestDate: record.date,
      price: record.close,
      previousPrice: record.previousClose ?? estimatePreviousPrice(record.close, record.changePercent),
      changePct: record.changePercent,
      volume: record.volume,
      turnoverValue: record.tradeValue ?? record.volume * record.close,
      tradeFrequency: record.tradeFrequency ?? null,
      nbsa: record.nbsa ?? null,
      signal: null,
    })),
    options,
  );
}

export function buildIhsgMoverGroups(rows: IhsgImpactRow[]): IhsgMoverGroup[] {
  const groups: IhsgMoverGroup[] = [];

  GROUP_DEFINITIONS.forEach((group) => {
    const members = rows.filter((row) => (group.tickers as readonly string[]).includes(row.ticker));
    if (!members.length) return;
    const weightPct = members.reduce((sum, row) => sum + row.cappedWeightPct, 0);
    const impactPct = members.reduce((sum, row) => sum + row.impactPct, 0);
    const impactPointValues = members.map((row) => row.impactPoints).filter((value): value is number => value != null);
    const impactPoints = impactPointValues.length ? impactPointValues.reduce((sum, value) => sum + value, 0) : null;
    const avgChangePct = weightPct > 0 ? members.reduce((sum, row) => sum + row.changePct * row.cappedWeightPct, 0) / weightPct : 0;
    const leaders = [...members].sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct)).slice(0, 3);
    groups.push({
      id: group.id,
      label: group.label,
      memberCount: members.length,
      weightPct: round(weightPct, 4),
      impactPct: round(impactPct, 4),
      impactPoints: impactPoints == null ? null : round(impactPoints, 4),
      avgChangePct: round(avgChangePct, 4),
      leaders,
    });
  });

  return groups.sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct));
}
