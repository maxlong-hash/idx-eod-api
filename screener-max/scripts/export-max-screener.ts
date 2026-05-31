import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { EodDataStore } from '../../src/eod-store.js';
import { buildMaxScreenerCsv, getMaxScreenerExportDate } from '../src/lib/csvExport';
import { IDX_UNIVERSE } from '../src/lib/idxUniverse';
import { analyzeTicker, DEFAULT_SETTINGS, STRATEGY_OPTIONS } from '../src/lib/maxEngine';
import type { CleanEodRecord, MaxSettings, ScanResult, StrategyName } from '../src/lib/types';

type CliOptions = {
  eodFile: string;
  outputDir: string;
  output: string | null;
  tickers: string[] | null;
  tickersFile: string | null;
  startDate: string;
  filter: string;
  minScore: number | null;
  strategy: StrategyName;
  portfolioCapital: number;
  quiet: boolean;
};

type EodRecordLike = {
  ticker: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  changePercent?: number | null;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

function resolveArgValue(args: string[], flagName: string) {
  const direct = args.find((arg) => arg.startsWith(`${flagName}=`));
  if (direct) return direct.slice(flagName.length + 1);

  const index = args.findIndex((arg) => arg === flagName);
  if (index >= 0) return args[index + 1] ?? null;

  return null;
}

function hasFlag(args: string[], flagName: string) {
  return args.includes(flagName);
}

function parseTickers(value: string | null) {
  if (!value) return null;
  const seen = new Set<string>();
  const tickers = value
    .split(/[\s,;]+/)
    .map((item) => item.trim().toUpperCase().replace(/^IDX:/, ''))
    .filter(Boolean)
    .filter((ticker) => {
      if (seen.has(ticker)) return false;
      seen.add(ticker);
      return true;
    });
  return tickers.length ? tickers : null;
}

function parseNumber(value: string | null, fallback: number) {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStrategy(value: string | null) {
  if (!value) return DEFAULT_SETTINGS.strategy;
  const match = STRATEGY_OPTIONS.find((strategy) => strategy.toLowerCase() === value.toLowerCase());
  if (!match) {
    throw new Error(`Invalid --strategy: ${value}. Options: ${STRATEGY_OPTIONS.join(', ')}`);
  }
  return match;
}

function parseOptions(): CliOptions {
  const args = process.argv.slice(2);
  const eodFile = path.resolve(
    resolveArgValue(args, '--eod-file') ??
      process.env.EOD_FILE_PATH ??
      path.join(repoRoot, 'EOD 2023-2026.txt'),
  );
  const outputDir = path.resolve(
    resolveArgValue(args, '--output-dir') ??
      process.env.SCREENER_MAX_RESULTS_DIR ??
      path.join(repoRoot, 'screener-max'),
  );
  const outputArg = resolveArgValue(args, '--output');

  return {
    eodFile,
    outputDir,
    output: outputArg ? path.resolve(outputArg) : null,
    tickers: parseTickers(resolveArgValue(args, '--tickers')),
    tickersFile: resolveArgValue(args, '--tickers-file'),
    startDate: resolveArgValue(args, '--start-date') ?? DEFAULT_SETTINGS.startDate,
    filter: (resolveArgValue(args, '--filter') ?? 'all').toLowerCase(),
    minScore: resolveArgValue(args, '--min-score') === null ? null : parseNumber(resolveArgValue(args, '--min-score'), 0),
    strategy: parseStrategy(resolveArgValue(args, '--strategy')),
    portfolioCapital: parseNumber(resolveArgValue(args, '--portfolio-capital'), DEFAULT_SETTINGS.portfolioCapital),
    quiet: hasFlag(args, '--quiet'),
  };
}

function cleanRecords(records: EodRecordLike[]): CleanEodRecord[] {
  return records
    .filter((row) => row.open != null && row.high != null && row.low != null && row.close != null && row.volume != null)
    .map((row) => ({
      ticker: row.ticker,
      date: row.date,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      changePercent: Number(row.changePercent ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function matchesFilter(result: ScanResult, filter: string) {
  if (filter === 'all') return true;
  if (filter === 'signals') return result.activeSignal;
  if (['reversal', 'momentum', 'breakout', 'passive', 'risk'].includes(filter)) {
    return result.signalGroup === filter;
  }
  throw new Error(`Invalid --filter: ${filter}. Use all, signals, reversal, momentum, breakout, passive, or risk.`);
}

async function readTickers(options: CliOptions) {
  if (options.tickers) return options.tickers;
  if (!options.tickersFile) return IDX_UNIVERSE;

  const text = await fs.readFile(path.resolve(options.tickersFile), 'utf8');
  return parseTickers(text) ?? [];
}

function log(options: CliOptions, message: string) {
  if (!options.quiet) {
    console.error(message);
  }
}

async function main() {
  const options = parseOptions();
  const tickers = await readTickers(options);
  const store = new EodDataStore({ filePath: options.eodFile });
  await store.ensureLoaded();

  const settings: MaxSettings = {
    ...DEFAULT_SETTINGS,
    startDate: options.startDate,
    strategy: options.strategy,
    portfolioCapital: options.portfolioCapital,
  };
  const benchmark = cleanRecords(store.getHistory({ ticker: 'IHSG', startDate: settings.startDate, order: 'asc' }));
  const results: ScanResult[] = [];
  const errors: Array<{ ticker: string; message: string }> = [];

  log(options, `[max-screener] loaded EOD ${store.latestDate} from ${options.eodFile}`);
  log(options, `[max-screener] scanning ${tickers.length} tickers from ${settings.startDate}`);

  for (let index = 0; index < tickers.length; index += 1) {
    const ticker = tickers[index];
    try {
      const history = cleanRecords(store.getHistory({ ticker, startDate: settings.startDate, order: 'asc' }));
      const analysis = analyzeTicker(ticker, history, settings, benchmark);
      results.push({
        ...analysis,
        latestAvailableDate: store.getLatestAvailableDate(ticker),
      });
    } catch (error) {
      errors.push({
        ticker,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if ((index + 1) % 50 === 0 || index + 1 === tickers.length) {
      log(options, `[max-screener] ${index + 1}/${tickers.length} done, ${results.length} ok, ${errors.length} skipped`);
    }
  }

  const filteredResults = results
    .filter((result) => matchesFilter(result, options.filter))
    .filter((result) => options.minScore === null || result.score >= options.minScore)
    .sort((a, b) => b.score - a.score);

  if (filteredResults.length === 0) {
    throw new Error('No screener results produced after filtering.');
  }

  const exportDate = getMaxScreenerExportDate(filteredResults);
  const outputPath = options.output ?? path.join(options.outputDir, `max-screener-${exportDate}.csv`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${buildMaxScreenerCsv(filteredResults)}\n`, 'utf8');

  const summary = {
    outputPath,
    exportDate,
    latestEodDate: store.latestDate,
    scanned: tickers.length,
    written: filteredResults.length,
    skipped: errors.length,
    errors: errors.slice(0, 20),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
