import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..');
const whaleRoot = path.join(repoRoot, 'whale_tracker');

const kseiFile = path.join(whaleRoot, 'data_29_mei_2026.js');
const freeFloatFile = path.join(whaleRoot, 'free_float_data.js');
const outputFile = path.join(appRoot, 'src', 'lib', 'ihsgFloatData.ts');

function readJsonArrayFromConst(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`Cannot find array payload in ${filePath}`);
  return JSON.parse(source.slice(start, end + 1));
}

function readAssignedJson(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const start = source.indexOf('=');
  if (start < 0) throw new Error(`Cannot find assigned payload in ${filePath}`);
  return JSON.parse(source.slice(start + 1).trim().replace(/;$/, ''));
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toIsoDate(value) {
  const match = String(value || '').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return String(value || '');
  const monthMap = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };
  return `${match[3]}-${monthMap[match[2]] ?? '01'}-${match[1].padStart(2, '0')}`;
}

function confidenceFor(residualFloatPct, idxFreeFloatPct) {
  if (residualFloatPct == null) return 'BENCHMARK_ONLY';
  if (idxFreeFloatPct == null) return 'KSEI_ONLY';
  const drift = Math.abs(residualFloatPct - idxFreeFloatPct);
  if (drift <= 5) return 'HIGH';
  if (drift <= 12) return 'MEDIUM';
  return 'LOW';
}

function asciiJson(value) {
  return JSON.stringify(value, null, 2).replace(/[^\x00-\x7F]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

const kseiRows = readJsonArrayFromConst(kseiFile);
const freeFloatDb = readAssignedJson(freeFloatFile);
const freeFloatRows = Array.isArray(freeFloatDb.rows) ? freeFloatDb.rows : [];

const kseiByTicker = new Map();
for (const row of kseiRows) {
  const ticker = String(row.share_code || '').trim().toUpperCase();
  if (!ticker) continue;
  const current = kseiByTicker.get(ticker) ?? {
    ticker,
    issuer: row.issuer_name || '',
    kseiDate: toIsoDate(row.date),
    holderCount: 0,
    aboveOnePctSumPct: 0,
    aboveOneShares: 0,
  };
  current.holderCount += 1;
  current.aboveOnePctSumPct += Number(row.percentage) || 0;
  current.aboveOneShares += Number(row.total_holding_shares) || 0;
  if (!current.issuer && row.issuer_name) current.issuer = row.issuer_name;
  kseiByTicker.set(ticker, current);
}

const idxByTicker = new Map();
for (const row of freeFloatRows) {
  const ticker = String(row.ticker || '').trim().toUpperCase();
  if (!ticker) continue;
  idxByTicker.set(ticker, row);
}

const tickers = Array.from(new Set([...kseiByTicker.keys(), ...idxByTicker.keys()])).sort();
const rows = tickers.map((ticker) => {
  const ksei = kseiByTicker.get(ticker);
  const idx = idxByTicker.get(ticker);
  const aboveOnePctSumPct = ksei ? round(ksei.aboveOnePctSumPct, 4) : null;
  const residualFloatPct = ksei ? round(Math.max(0, 100 - ksei.aboveOnePctSumPct), 4) : null;
  const estimatedShares = ksei && ksei.aboveOnePctSumPct > 0 ? Math.round(ksei.aboveOneShares / (ksei.aboveOnePctSumPct / 100)) : null;
  const idxFreeFloatPct = Number.isFinite(Number(idx?.freeFloatPct)) ? round(Number(idx.freeFloatPct), 4) : null;
  const driftPct = residualFloatPct != null && idxFreeFloatPct != null ? round(residualFloatPct - idxFreeFloatPct, 4) : null;

  return {
    ticker,
    issuer: ksei?.issuer || idx?.issuer || '',
    kseiDate: ksei?.kseiDate ?? null,
    holderCount: ksei?.holderCount ?? 0,
    aboveOnePctSumPct,
    residualFloatPct,
    estimatedShares,
    idxFreeFloatPct,
    idxMarketCap: Number.isFinite(Number(idx?.marketCap)) ? Number(idx.marketCap) : null,
    idxShareholders: Number.isFinite(Number(idx?.shareholders)) ? Number(idx.shareholders) : null,
    idxBoard: idx?.board ?? null,
    driftPct,
    confidence: confidenceFor(residualFloatPct, idxFreeFloatPct),
  };
});

const meta = {
  generatedAt: new Date().toISOString(),
  kseiSourceFile: path.relative(repoRoot, kseiFile).replace(/\\/g, '/'),
  kseiSnapshotDate: rows.find((row) => row.kseiDate)?.kseiDate ?? null,
  benchmarkSourceFile: path.relative(repoRoot, freeFloatFile).replace(/\\/g, '/'),
  benchmarkReportPeriod: freeFloatDb.meta?.reportPeriod ?? null,
  benchmarkMonitoringDate: freeFloatDb.meta?.monitoringDate ?? null,
  methodology: 'Primary float is 100 minus summed KSEI holders above 1 percent. IDX free-float announcement is retained as benchmark.',
  rowCount: rows.length,
};

const output = `// Generated by scripts/generate-ihsg-float-data.mjs. Do not edit manually.

export type IhsgFloatConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'KSEI_ONLY' | 'BENCHMARK_ONLY';

export type IhsgFloatInput = {
  ticker: string;
  issuer: string;
  kseiDate: string | null;
  holderCount: number;
  aboveOnePctSumPct: number | null;
  residualFloatPct: number | null;
  estimatedShares: number | null;
  idxFreeFloatPct: number | null;
  idxMarketCap: number | null;
  idxShareholders: number | null;
  idxBoard: string | null;
  driftPct: number | null;
  confidence: IhsgFloatConfidence;
};

export const IHSG_FLOAT_SOURCE_META = ${asciiJson(meta)} as const;

export const IHSG_FLOAT_INPUTS: IhsgFloatInput[] = ${asciiJson(rows)};

export const IHSG_FLOAT_BY_TICKER: ReadonlyMap<string, IhsgFloatInput> = new Map(
  IHSG_FLOAT_INPUTS.map((row) => [row.ticker, row]),
);

export function getIhsgFloatInput(ticker: string) {
  return IHSG_FLOAT_BY_TICKER.get(ticker.trim().toUpperCase()) ?? null;
}
`;

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, output, 'utf8');
console.log(`Generated ${path.relative(repoRoot, outputFile)} with ${rows.length} rows.`);
