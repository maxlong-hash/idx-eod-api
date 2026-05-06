import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

const ACTIVE_SIGNALS = new Set([
  'SMART SNIPER',
  'SNIPER COMBO',
  'BETA BREAKOUT',
  'SMART GAMMA',
  'GAMMA PUMP',
  'G ACC',
  'V-SHAPE',
  'EARLY SWEEP'
]);

const STRING_FIELDS = new Set([
  'ticker',
  'date',
  'signal',
  'activeSignals',
  'sniperLocation',
  'lastActiveSignals',
  'lastActiveDate',
  'lastSniperLocation',
  'regime',
  'quadrant',
  'strategy',
  'historyQuality'
]);

const HEADER_MAP = new Map([
  ['Ticker', 'ticker'],
  ['Date', 'date'],
  ['HistoryBars', 'historyBars'],
  ['HistoryQuality', 'historyQuality'],
  ['Price', 'price'],
  ['ChangePct', 'changePct'],
  ['Signal', 'signal'],
  ['ActiveSignals', 'activeSignals'],
  ['SniperLocation', 'sniperLocation'],
  ['LastActiveSignals', 'lastActiveSignals'],
  ['LastActiveDate', 'lastActiveDate'],
  ['LastSniperLocation', 'lastSniperLocation'],
  ['Regime', 'regime'],
  ['Quadrant', 'quadrant'],
  ['RVol', 'rvol'],
  ['AgeDays', 'ageDays'],
  ['Score', 'score'],
  ['Strategy', 'strategy'],
  ['PortfolioCapital', 'portfolioCapital'],
  ['Buy1', 'buy1'],
  ['Buy2', 'buy2'],
  ['Buy3', 'buy3'],
  ['Buy4', 'buy4'],
  ['Weight1', 'weight1'],
  ['Weight2', 'weight2'],
  ['Weight3', 'weight3'],
  ['Weight4', 'weight4'],
  ['Lot1', 'lot1'],
  ['Lot2', 'lot2'],
  ['Lot3', 'lot3'],
  ['Lot4', 'lot4'],
  ['TotalLots', 'totalLots'],
  ['TotalDeployed', 'totalDeployed'],
  ['CashLeft', 'cashLeft'],
  ['AvgEntry', 'avgEntry'],
  ['TheoreticalAvgEntry', 'theoreticalAvgEntry'],
  ['RiskPct', 'riskPct'],
  ['RiskBuy1Pct', 'riskBuy1Pct'],
  ['RiskAvgPct', 'riskAvgPct'],
  ['RewardRisk', 'rewardRisk'],
  ['RewardRiskBuy1', 'rewardRiskBuy1'],
  ['RewardRiskAvg', 'rewardRiskAvg']
]);

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (inQuotes) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}

function normalizeHeader(header) {
  const trimmed = header.trim();
  if (HEADER_MAP.has(trimmed)) {
    return HEADER_MAP.get(trimmed);
  }

  return trimmed
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower : `${lower[0]?.toUpperCase() ?? ''}${lower.slice(1)}`;
    })
    .join('');
}

function coerceValue(field, value) {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  if (STRING_FIELDS.has(field)) {
    return trimmed;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  return trimmed;
}

function signalGroup(signal) {
  const value = String(signal ?? '').toUpperCase();
  if (value.includes('SNIPER') || value === 'V-SHAPE' || value === 'EARLY SWEEP') return 'reversal';
  if (value.includes('GAMMA') || value === 'G ACC') return 'momentum';
  if (value === 'BETA BREAKOUT') return 'breakout';
  if (value === 'UNSAFE DIP') return 'risk';
  return 'passive';
}

function isActiveSignal(signal) {
  return ACTIVE_SIGNALS.has(String(signal ?? '').toUpperCase());
}

function parseLimit(value) {
  const limit = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function parseTickerSet(value) {
  if (!value) {
    return null;
  }

  const tickers = String(value)
    .split(/[\s,;]+/)
    .map((ticker) => ticker.trim().toUpperCase().replace(/^IDX:/, ''))
    .filter(Boolean);

  return tickers.length > 0 ? new Set(tickers) : null;
}

function compareText(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function compareNumber(left, right) {
  const a = Number(left);
  const b = Number(right);
  const safeA = Number.isFinite(a) ? a : Number.NEGATIVE_INFINITY;
  const safeB = Number.isFinite(b) ? b : Number.NEGATIVE_INFINITY;
  return safeA - safeB;
}

export class ScreenerMaxStore {
  constructor({ resultsDir }) {
    this.resultsDir = resultsDir;
    this.cache = null;
  }

  async ensureLoaded() {
    await this.loadLatest();
  }

  getStats() {
    if (!this.cache) {
      return {
        resultsDir: this.resultsDir,
        loaded: false,
        records: 0,
        sourceFile: null,
        snapshotDate: null
      };
    }

    return {
      resultsDir: this.resultsDir,
      loaded: true,
      records: this.cache.records.length,
      sourceFile: this.cache.sourceFile,
      snapshotDate: this.cache.snapshotDate,
      generatedAt: this.cache.generatedAt
    };
  }

  async findLatestFile() {
    const entries = await fs.readdir(this.resultsDir, { withFileTypes: true });
    const csvFiles = [];

    for (const entry of entries) {
      if (!entry.isFile() || !/^max-screener-.+\.csv$/i.test(entry.name)) {
        continue;
      }

      const filePath = path.join(this.resultsDir, entry.name);
      const stats = await fs.stat(filePath);
      csvFiles.push({ filePath, name: entry.name, mtimeMs: stats.mtimeMs, generatedAt: stats.mtime.toISOString() });
    }

    csvFiles.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
    return csvFiles[0] ?? null;
  }

  async loadLatest() {
    const latestFile = await this.findLatestFile();
    if (!latestFile) {
      throw new Error(`No max-screener-*.csv file found in ${this.resultsDir}`);
    }

    if (this.cache?.filePath === latestFile.filePath && this.cache?.mtimeMs === latestFile.mtimeMs) {
      return this.cache;
    }

    const text = await fs.readFile(latestFile.filePath, 'utf8');
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length < 2) {
      throw new Error(`Screener file ${latestFile.name} has no records`);
    }

    const rawHeaders = parseCsvLine(lines[0]);
    const fields = rawHeaders.map(normalizeHeader);
    const records = lines.slice(1).map((line) => {
      const values = parseCsvLine(line);
      const record = {};

      fields.forEach((field, index) => {
        record[field] = coerceValue(field, values[index] ?? '');
      });

      if (record.ticker) {
        record.ticker = String(record.ticker).toUpperCase();
      }

      record.signalGroup = signalGroup(record.signal);
      record.activeSignal = isActiveSignal(record.signal);
      return record;
    });

    const snapshotDate = records.reduce(
      (current, record) => (!record.date ? current : current === null || record.date > current ? record.date : current),
      null
    );

    this.cache = {
      filePath: latestFile.filePath,
      sourceFile: latestFile.name,
      mtimeMs: latestFile.mtimeMs,
      generatedAt: latestFile.generatedAt,
      rawHeaders,
      fields,
      records,
      snapshotDate
    };

    return this.cache;
  }

  async query(options = {}) {
    const cache = await this.loadLatest();
    const tickerSet = parseTickerSet(options.ticker ?? options.tickers);
    const filter = String(options.filter ?? 'all').toLowerCase();
    const signal = options.signal ? String(options.signal).toUpperCase() : null;
    const regime = options.regime ? String(options.regime).toUpperCase() : null;
    const quadrant = options.quadrant ? String(options.quadrant).toUpperCase() : null;
    const minScore = options.minScore !== undefined && options.minScore !== null && options.minScore !== ''
      ? Number(options.minScore)
      : null;
    const limit = parseLimit(options.limit);
    const sort = String(options.sort ?? 'score_desc').toLowerCase();

    let records = cache.records.filter((record) => {
      if (tickerSet && !tickerSet.has(String(record.ticker ?? '').toUpperCase())) return false;
      if (signal && String(record.signal ?? '').toUpperCase() !== signal) return false;
      if (regime && String(record.regime ?? '').toUpperCase() !== regime) return false;
      if (quadrant && String(record.quadrant ?? '').toUpperCase() !== quadrant) return false;
      if (minScore !== null && Number(record.score ?? Number.NEGATIVE_INFINITY) < minScore) return false;
      if (filter === 'signals' && !record.activeSignal) return false;
      if (['reversal', 'momentum', 'breakout', 'passive', 'risk'].includes(filter) && record.signalGroup !== filter) return false;
      return true;
    });

    records = [...records].sort((left, right) => {
      if (sort === 'score_asc') return compareNumber(left.score, right.score);
      if (sort === 'change_desc') return compareNumber(right.changePct, left.changePct);
      if (sort === 'change_asc') return compareNumber(left.changePct, right.changePct);
      if (sort === 'ticker_asc') return compareText(left.ticker, right.ticker);
      return compareNumber(right.score, left.score);
    });

    const totalMatches = records.length;
    records = records.slice(0, limit);

    return {
      name: 'screner MAX',
      sourceFile: cache.sourceFile,
      snapshotDate: cache.snapshotDate,
      generatedAt: cache.generatedAt,
      totalRecords: cache.records.length,
      totalMatches,
      returned: records.length,
      query: {
        ticker: options.ticker ?? null,
        tickers: options.tickers ?? null,
        filter,
        signal,
        regime,
        quadrant,
        minScore,
        limit,
        sort
      },
      records
    };
  }

  serializeToCsv(records) {
    const cache = this.cache;
    const rawHeaders = cache?.rawHeaders?.length ? cache.rawHeaders : ['Ticker', 'Date', 'Price', 'ChangePct', 'Signal', 'Regime', 'Quadrant', 'RVol', 'AgeDays', 'Score', 'RiskPct', 'RewardRisk'];
    const fields = cache?.fields?.length ? cache.fields : rawHeaders.map(normalizeHeader);
    const lines = [rawHeaders.map(csvEscape).join(',')];

    for (const record of records) {
      lines.push(fields.map((field) => csvEscape(record[field])).join(','));
    }

    return lines.join('\n');
  }
}
