import fs from 'node:fs';
import path from 'node:path';

const MONTH_NAME_TO_NUMBER = new Map([
  ['jan', 1],
  ['january', 1],
  ['feb', 2],
  ['februari', 2],
  ['february', 2],
  ['mar', 3],
  ['maret', 3],
  ['march', 3],
  ['apr', 4],
  ['april', 4],
  ['may', 5],
  ['mei', 5],
  ['jun', 6],
  ['june', 6],
  ['jul', 7],
  ['july', 7],
  ['aug', 8],
  ['agustus', 8],
  ['august', 8],
  ['sep', 9],
  ['sept', 9],
  ['september', 9],
  ['oct', 10],
  ['october', 10],
  ['okt', 10],
  ['oktober', 10],
  ['nov', 11],
  ['november', 11],
  ['dec', 12],
  ['december', 12],
  ['des', 12],
  ['desember', 12]
]);

const DEFAULT_COMPARE_METRIC = 'local_total';
const STATUS_PRIORITY = new Map([
  ['new', 0],
  ['removed', 1],
  ['increased', 2],
  ['decreased', 3],
  ['scripless_shift', 4],
  ['script_shift', 5],
  ['rebalanced', 6],
  ['unchanged', 7]
]);
const LEGAL_ENTITY_TOKENS = new Set(['PT', 'TBK', 'PERSERO', 'PERSEROAN', 'PERUSAHAAN']);
const MANUAL_CANONICAL_OVERRIDES = new Map([
  ['PERUSAHAAN PERSEROAN PERSERO PT DANANTARA ASSET MANAGEMENT', 'PERUSAHAAN PERSEROAN (PERSERO) PT DANANTARA ASSET MANAGEMENT'],
  ['PT DANANTARA ASSET MANAGEMENT PERSERO', 'PERUSAHAAN PERSEROAN (PERSERO) PT DANANTARA ASSET MANAGEMENT'],
  ['PERUSAHAAN PENGELOLA ASET PERSERO', 'PERUSAHAAN PERSEROAN (PERSERO) PT DANANTARA ASSET MANAGEMENT'],
  ['PT BEYOND MEDIA', 'PT. Beyond Media'],
  ['PT KAIROS EKSPRES INTERNASIONAL', 'KAIROS EKSPRES INTERNASIONAL PT'],
  ['DRS LO KHENG HONG', 'LO KHENG HONG. DRS'],
  ['SALIM LIM', 'SALIM, LIM'],
  ['PURINUSA EKAPERSADA PT', 'APP PURINUSA EKAPERSADA'],
  ['PT PURINUSA EKAPERSADA', 'APP PURINUSA EKAPERSADA'],
  ['SINTAWATY KUSTADY', 'SINTAWATI KUSTADY'],
  ['CS AG SG BR S A PT RAJAWALI CAPITAL INTERNATIONAL 2023334066', 'RAJAWALI CAPITAL INTERNATIONAL, PT.'],
  ['UOB KAY HIAN PTE LTD A C UNITED OVERSEAS BANK A C PT SARANA AGRO INVESTAMA', 'SARANA AGRO INVESTAMA, PT']
]);

function pad2(value) {
  return String(value).padStart(2, '0');
}

function isValidDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeDateInput(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return null;
  }

  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return isValidDateParts(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
  }

  match = raw.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = MONTH_NAME_TO_NUMBER.get(match[2].toLowerCase());
    const year = Number(match[3]);
    return month && isValidDateParts(year, month, day)
      ? `${year}-${pad2(month)}-${pad2(day)}`
      : null;
  }

  return null;
}

function normalizePeriodInput(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return null;
  }

  const periodMatch = raw.match(/^(\d{4})-(\d{2})$/);
  if (periodMatch) {
    const month = Number(periodMatch[2]);
    return month >= 1 && month <= 12 ? raw : null;
  }

  const date = normalizeDateInput(raw);
  return date ? date.slice(0, 7) : null;
}

function inferSnapshotDateFromFileName(fileName) {
  const normalizedFileName = String(fileName ?? '').trim().toLowerCase();
  if (normalizedFileName === 'data.js') {
    return '2026-02-27';
  }

  const match = normalizedFileName.match(/(\d{1,2})[_-]([a-z]+)[_-](\d{4})/i);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = MONTH_NAME_TO_NUMBER.get(match[2].toLowerCase());
  const year = Number(match[3]);
  return month && isValidDateParts(year, month, day)
    ? `${year}-${pad2(month)}-${pad2(day)}`
    : null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanDisplayName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function buildExactMatchKey(value) {
  return cleanDisplayName(value)
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function buildCollapsedMatchKey(value) {
  return buildExactMatchKey(value)
    .split(' ')
    .filter((token) => token && !LEGAL_ENTITY_TOKENS.has(token))
    .join('');
}

function normalizeHolderDisplayName(value) {
  const cleaned = cleanDisplayName(value);
  return MANUAL_CANONICAL_OVERRIDES.get(buildExactMatchKey(cleaned)) ?? cleaned;
}

function normalizeHolderKey(value) {
  return buildExactMatchKey(normalizeHolderDisplayName(value));
}

function loadJsArray(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  const start = text.indexOf('[');
  const endWithSemicolon = text.lastIndexOf('];');
  const end = endWithSemicolon >= 0 ? endWithSemicolon + 1 : text.lastIndexOf(']') + 1;

  if (start < 0 || end <= start) {
    throw new Error(`Unable to find JSON array in ${filePath}`);
  }

  return JSON.parse(text.slice(start, end));
}

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

function rowsToCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return lines.join('\n');
}

function normalizeLocalForeign(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'LOCAL' || normalized === 'DOMESTIC') {
    return 'L';
  }
  if (normalized === 'A' || normalized === 'FOREIGN') {
    return 'F';
  }
  return normalized;
}

function normalizeOrigin(value) {
  const localForeign = normalizeLocalForeign(value);
  if (localForeign === 'L') {
    return 'Domestic';
  }
  if (localForeign === 'F') {
    return 'Foreign';
  }
  return '';
}

function safePercentChange(before, after) {
  if (before === null || before === undefined || before === 0) {
    return null;
  }
  return ((after - before) / before) * 100;
}

function compareHolderStatus(previousRecord, currentRecord) {
  if (!previousRecord && currentRecord) {
    return 'new';
  }
  if (previousRecord && !currentRecord) {
    return 'removed';
  }

  const volumeDelta = safeNumber(currentRecord?.total_holding_shares) - safeNumber(previousRecord?.total_holding_shares);
  const scriplessDelta = safeNumber(currentRecord?.holdings_scripless) - safeNumber(previousRecord?.holdings_scripless);
  const scriptDelta = safeNumber(currentRecord?.holdings_scrip) - safeNumber(previousRecord?.holdings_scrip);

  if (volumeDelta > 0) {
    return 'increased';
  }
  if (volumeDelta < 0) {
    return 'decreased';
  }
  if (scriplessDelta > 0 && scriptDelta < 0) {
    return 'scripless_shift';
  }
  if (scriptDelta > 0 && scriplessDelta < 0) {
    return 'script_shift';
  }
  if (scriplessDelta !== 0 || scriptDelta !== 0) {
    return 'rebalanced';
  }
  return 'unchanged';
}

function buildHolderComparison(previousRecord, currentRecord) {
  const previousVolume = safeNumber(previousRecord?.total_holding_shares);
  const currentVolume = safeNumber(currentRecord?.total_holding_shares);
  const previousPct = safeNumber(previousRecord?.percentage);
  const currentPct = safeNumber(currentRecord?.percentage);
  const previousScripless = safeNumber(previousRecord?.holdings_scripless);
  const currentScripless = safeNumber(currentRecord?.holdings_scripless);
  const previousScript = safeNumber(previousRecord?.holdings_scrip);
  const currentScript = safeNumber(currentRecord?.holdings_scrip);

  return {
    status: compareHolderStatus(previousRecord, currentRecord),
    previous_volume: previousVolume,
    current_volume: currentVolume,
    volume_delta: currentVolume - previousVolume,
    volume_change_percent: safePercentChange(previousVolume, currentVolume),
    previous_pct: previousPct,
    current_pct: currentPct,
    pct_delta: currentPct - previousPct,
    previous_scripless: previousScripless,
    current_scripless: currentScripless,
    scripless_delta: currentScripless - previousScripless,
    previous_script: previousScript,
    current_script: currentScript,
    script_delta: currentScript - previousScript
  };
}

export class OwnershipDataStore {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir);
    this.loaded = false;
    this.loadingPromise = null;
    this.loadedAt = null;
    this.historyByTicker = new Map();
    this.holdersByPeriodTicker = new Map();
    this.holdersByPeriodInvestor = new Map();
    this.holderSnapshots = [];
    this.allHolderRecords = [];
  }

  async ensureLoaded() {
    if (this.loaded) {
      return;
    }

    if (!this.loadingPromise) {
      this.loadingPromise = this.load();
    }

    await this.loadingPromise;
  }

  async load() {
    if (!fs.existsSync(this.dataDir)) {
      this.loaded = true;
      this.loadedAt = new Date().toISOString();
      return;
    }

    const historyPath = path.join(this.dataDir, 'db_balance_history.js');
    if (fs.existsSync(historyPath)) {
      const historyRows = loadJsArray(historyPath);
      for (const item of historyRows) {
        const ticker = String(item.ticker ?? '').trim().toUpperCase();
        if (!ticker || !Array.isArray(item.history)) {
          continue;
        }

        const records = item.history
          .map((record) => ({
            ticker,
            date: normalizeDateInput(record.date),
            price: toNumber(record.price),
            local_is: toNumber(record.local_is),
            local_cp: toNumber(record.local_cp),
            local_pf: toNumber(record.local_pf),
            local_ib: toNumber(record.local_ib),
            local_id: toNumber(record.local_id),
            local_mf: toNumber(record.local_mf),
            local_sc: toNumber(record.local_sc),
            local_fd: toNumber(record.local_fd),
            local_ot: toNumber(record.local_ot),
            local_total: toNumber(record.local_total),
            foreign_is: toNumber(record.foreign_is),
            foreign_cp: toNumber(record.foreign_cp),
            foreign_pf: toNumber(record.foreign_pf),
            foreign_ib: toNumber(record.foreign_ib),
            foreign_id: toNumber(record.foreign_id),
            foreign_mf: toNumber(record.foreign_mf),
            foreign_sc: toNumber(record.foreign_sc),
            foreign_fd: toNumber(record.foreign_fd),
            foreign_ot: toNumber(record.foreign_ot),
            foreign_total: toNumber(record.foreign_total)
          }))
          .filter((record) => record.date)
          .sort((left, right) => left.date.localeCompare(right.date));

        this.historyByTicker.set(ticker, records);
      }
    }

    const holderFiles = fs
      .readdirSync(this.dataDir)
      .filter((fileName) => /^data(?:_.*)?\.js$/i.test(fileName))
      .sort((left, right) => {
        const leftDate = inferSnapshotDateFromFileName(left) ?? '';
        const rightDate = inferSnapshotDateFromFileName(right) ?? '';
        return leftDate.localeCompare(rightDate) || left.localeCompare(right);
      });

    for (const fileName of holderFiles) {
      const filePath = path.join(this.dataDir, fileName);
      const rows = loadJsArray(filePath);
      const firstRowWithDate = rows.find((row) => normalizeDateInput(row?.date));
      const firstDate = normalizeDateInput(firstRowWithDate?.date) ?? inferSnapshotDateFromFileName(fileName);
      const period = firstDate?.slice(0, 7);
      if (!period) {
        continue;
      }

      this.holderSnapshots.push({
        filePath,
        fileName,
        date: firstDate,
        period,
        records: rows.length
      });

      for (const row of rows) {
        const ticker = String(row.share_code ?? '').trim().toUpperCase();
        const investorName = normalizeHolderDisplayName(row.investor_name);
        const investorKey = normalizeHolderKey(investorName);
        if (!ticker || !investorName || !investorKey) {
          continue;
        }

        const holdingsScripless = toNumber(row.holdings_scripless);
        const holdingsScrip = toNumber(row.holdings_scrip);
        const totalHoldingShares = toNumber(row.total_holding_shares)
          ?? (safeNumber(holdingsScripless) + safeNumber(holdingsScrip));
        const percentage = toNumber(row.percentage);
        const localForeign = normalizeLocalForeign(row.local_foreign);
        const record = {
          date: firstDate,
          period,
          ticker,
          issuer_name: row.issuer_name ?? '',
          investor_name: investorName,
          holder_name: investorName,
          investor_key: investorKey,
          investor_type: row.investor_type ?? '',
          type_code: row.investor_type ?? '',
          local_foreign: localForeign ?? '',
          origin: normalizeOrigin(row.local_foreign),
          nationality: row.nationality ?? '',
          country: row.nationality ?? '',
          domicile: row.domicile ?? '',
          jurisdiction: row.nationality || row.domicile || '',
          holdings_scripless: holdingsScripless,
          holdings_scrip: holdingsScrip,
          total_holding_shares: totalHoldingShares,
          percentage,
          scripless_volume: holdingsScripless,
          script_volume: holdingsScrip,
          volume: totalHoldingShares,
          ownership_pct: percentage
        };

        const tickerKey = `${period}|${ticker}`;
        if (!this.holdersByPeriodTicker.has(tickerKey)) {
          this.holdersByPeriodTicker.set(tickerKey, []);
        }
        this.holdersByPeriodTicker.get(tickerKey).push(record);

        const investorMapKey = `${period}|${investorKey}`;
        if (!this.holdersByPeriodInvestor.has(investorMapKey)) {
          this.holdersByPeriodInvestor.set(investorMapKey, []);
        }
        this.holdersByPeriodInvestor.get(investorMapKey).push(record);
        this.allHolderRecords.push(record);
      }
    }

    for (const holders of this.holdersByPeriodTicker.values()) {
      holders.sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0));
    }
    for (const holdings of this.holdersByPeriodInvestor.values()) {
      holdings.sort(
        (left, right) =>
          (right.percentage ?? 0) - (left.percentage ?? 0) ||
          left.ticker.localeCompare(right.ticker)
      );
    }

    this.holderSnapshots.sort((left, right) => left.date.localeCompare(right.date));
    this.loadedAt = new Date().toISOString();
    this.loaded = true;
  }

  getStats() {
    const historyRecordCount = Array.from(this.historyByTicker.values())
      .reduce((sum, records) => sum + records.length, 0);
    const latestHolderSnapshot = this.holderSnapshots[this.holderSnapshots.length - 1] ?? null;
    const holderPeriods = Array.from(new Set(this.holderSnapshots.map((snapshot) => snapshot.period))).sort();
    const latestHistoryDate = Array.from(this.historyByTicker.values())
      .flatMap((records) => records.length > 0 ? [records[records.length - 1].date] : [])
      .sort()
      .at(-1) ?? null;

    return {
      dataDir: this.dataDir,
      loadedAt: this.loadedAt,
      historyTickers: this.historyByTicker.size,
      historyRecords: historyRecordCount,
      latestHistoryDate,
      holderPeriods,
      holderPeriodCount: holderPeriods.length,
      holderRecords: this.allHolderRecords.length,
      holderInvestors: this.holdersByPeriodInvestor.size,
      holderSnapshots: this.holderSnapshots.map(({ fileName, date, period, records }) => ({
        fileName,
        date,
        period,
        records
      })),
      latestHolderDate: latestHolderSnapshot?.date ?? null,
      latestHolderPeriod: latestHolderSnapshot?.period ?? null
    };
  }

  resolveHolderPeriod(input) {
    const requestedPeriod = normalizePeriodInput(input);
    if (requestedPeriod) {
      return requestedPeriod;
    }

    return this.holderSnapshots[this.holderSnapshots.length - 1]?.period ?? null;
  }

  getHolderPeriods() {
    return Array.from(new Set(this.holderSnapshots.map((snapshot) => snapshot.period))).sort();
  }

  resolveComparePeriods({ from, to }) {
    const periods = this.getHolderPeriods();
    const toPeriod = this.resolveHolderPeriod(to);
    const requestedFromPeriod = normalizePeriodInput(from);
    const toIndex = periods.indexOf(toPeriod);
    const fallbackFromPeriod = toIndex > 0 ? periods[toIndex - 1] : periods[0] ?? null;

    return {
      fromPeriod: requestedFromPeriod ?? fallbackFromPeriod,
      toPeriod
    };
  }

  findInvestorRecords(period, holder) {
    const resolvedPeriod = this.resolveHolderPeriod(period);
    const queryKey = normalizeHolderKey(holder);
    if (!resolvedPeriod || !queryKey) {
      return [];
    }

    const collapsedQueryKey = buildCollapsedMatchKey(holder);
    const records = [];
    for (const [mapKey, investorRecords] of this.holdersByPeriodInvestor.entries()) {
      const separatorIndex = mapKey.indexOf('|');
      const recordPeriod = mapKey.slice(0, separatorIndex);
      const holderKey = mapKey.slice(separatorIndex + 1);
      const collapsedHolderKey = buildCollapsedMatchKey(holderKey);

      if (recordPeriod !== resolvedPeriod) {
        continue;
      }
      if (
        holderKey === queryKey ||
        holderKey.includes(queryKey) ||
        queryKey.includes(holderKey) ||
        (collapsedQueryKey && collapsedHolderKey.includes(collapsedQueryKey))
      ) {
        records.push(...investorRecords);
      }
    }

    return records;
  }

  summarizeHolderMatches(records, limit = 20) {
    const seen = new Set();
    const matches = [];
    for (const record of records) {
      if (seen.has(record.investor_key)) {
        continue;
      }
      seen.add(record.investor_key);
      matches.push({
        investor_name: record.investor_name,
        investor_key: record.investor_key,
        investor_type: record.investor_type,
        origin: record.origin,
        country: record.country,
        domicile: record.domicile
      });
      if (matches.length >= limit) {
        break;
      }
    }
    return matches;
  }

  findHolderRecord({ period, ticker, holder }) {
    const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
    const records = this.findInvestorRecords(period, holder)
      .filter((record) => record.ticker === normalizedTicker)
      .sort((left, right) => (right.total_holding_shares ?? 0) - (left.total_holding_shares ?? 0));

    return records[0] ?? null;
  }

  getHolders({
    ticker,
    period,
    investorType,
    localForeign,
    minPercentage = null,
    limit = 50,
    sort = 'percentage_desc'
  }) {
    const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
    if (!normalizedTicker) {
      throw new Error('ticker is required');
    }

    const resolvedPeriod = this.resolveHolderPeriod(period);
    if (!resolvedPeriod) {
      return {
        ticker: normalizedTicker,
        period: null,
        date: null,
        returned: 0,
        records: []
      };
    }

    const normalizedInvestorType = String(investorType ?? '').trim().toUpperCase();
    const normalizedLocalForeign = normalizeLocalForeign(localForeign);
    const minimumPercentage = minPercentage === null || minPercentage === undefined || minPercentage === ''
      ? null
      : Number(minPercentage);
    const maxRows = Math.max(1, Math.min(Number(limit) || 50, 1000));

    let records = (this.holdersByPeriodTicker.get(`${resolvedPeriod}|${normalizedTicker}`) ?? [])
      .filter((record) => {
        if (normalizedInvestorType && String(record.investor_type).toUpperCase() !== normalizedInvestorType) {
          return false;
        }
        if (normalizedLocalForeign && normalizeLocalForeign(record.local_foreign) !== normalizedLocalForeign) {
          return false;
        }
        if (minimumPercentage !== null && (record.percentage ?? 0) < minimumPercentage) {
          return false;
        }
        return true;
      });

    if (sort === 'shares_desc') {
      records = records.slice().sort(
        (left, right) => (right.total_holding_shares ?? 0) - (left.total_holding_shares ?? 0)
      );
    } else if (sort === 'name_asc') {
      records = records.slice().sort((left, right) => left.investor_name.localeCompare(right.investor_name));
    } else {
      records = records.slice().sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0));
    }

    const limitedRecords = records.slice(0, maxRows);
    return {
      ticker: normalizedTicker,
      period: resolvedPeriod,
      date: limitedRecords[0]?.date ?? `${resolvedPeriod}-01`,
      returned: limitedRecords.length,
      records: limitedRecords
    };
  }

  getInvestorHoldings({
    holder,
    period,
    ticker,
    minPercentage = null,
    limit = 100,
    sort = 'percentage_desc'
  }) {
    const resolvedPeriod = this.resolveHolderPeriod(period);
    if (!resolvedPeriod) {
      return {
        holderQuery: String(holder ?? '').trim(),
        period: null,
        date: null,
        returned: 0,
        holderMatches: [],
        records: []
      };
    }

    const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
    const minimumPercentage = minPercentage === null || minPercentage === undefined || minPercentage === ''
      ? null
      : Number(minPercentage);
    const maxRows = Math.max(1, Math.min(Number(limit) || 100, 2000));

    let records = this.findInvestorRecords(resolvedPeriod, holder)
      .filter((record) => {
        if (normalizedTicker && record.ticker !== normalizedTicker) {
          return false;
        }
        if (minimumPercentage !== null && (record.percentage ?? 0) < minimumPercentage) {
          return false;
        }
        return true;
      });

    if (sort === 'shares_desc') {
      records = records.slice().sort(
        (left, right) => (right.total_holding_shares ?? 0) - (left.total_holding_shares ?? 0)
      );
    } else if (sort === 'ticker_asc') {
      records = records.slice().sort((left, right) => left.ticker.localeCompare(right.ticker));
    } else {
      records = records.slice().sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0));
    }

    const limitedRecords = records.slice(0, maxRows);
    return {
      holderQuery: String(holder ?? '').trim(),
      period: resolvedPeriod,
      date: limitedRecords[0]?.date ?? `${resolvedPeriod}-01`,
      returned: limitedRecords.length,
      holderMatches: this.summarizeHolderMatches(records),
      records: limitedRecords
    };
  }

  compareHolder({ ticker, holder, from, to }) {
    const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
    if (!normalizedTicker) {
      throw new Error('ticker is required');
    }
    if (!String(holder ?? '').trim()) {
      throw new Error('holder is required');
    }

    const { fromPeriod, toPeriod } = this.resolveComparePeriods({ from, to });
    if (!fromPeriod || !toPeriod) {
      throw new Error('Not enough ownership holder snapshots to compare');
    }

    const previousRecord = this.findHolderRecord({ period: fromPeriod, ticker: normalizedTicker, holder });
    const currentRecord = this.findHolderRecord({ period: toPeriod, ticker: normalizedTicker, holder });
    if (!previousRecord && !currentRecord) {
      throw new Error(`No holder match found for ${holder} in ${normalizedTicker}`);
    }

    const comparison = buildHolderComparison(previousRecord, currentRecord);
    return {
      ticker: normalizedTicker,
      holderQuery: String(holder ?? '').trim(),
      holder: currentRecord?.investor_name ?? previousRecord?.investor_name ?? String(holder ?? '').trim(),
      from: fromPeriod,
      to: toPeriod,
      ...comparison,
      previousRecord,
      currentRecord
    };
  }

  compareInvestor({
    holder,
    from,
    to,
    ticker,
    status,
    limit = 100
  }) {
    if (!String(holder ?? '').trim()) {
      throw new Error('holder is required');
    }

    const { fromPeriod, toPeriod } = this.resolveComparePeriods({ from, to });
    if (!fromPeriod || !toPeriod) {
      throw new Error('Not enough ownership holder snapshots to compare');
    }

    const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
    const normalizedStatus = String(status ?? '').trim().toLowerCase();
    const maxRows = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const byTicker = new Map();

    const putRecord = (record, field) => {
      if (normalizedTicker && record.ticker !== normalizedTicker) {
        return;
      }

      const current = byTicker.get(record.ticker) ?? {
        ticker: record.ticker,
        issuer_name: record.issuer_name,
        previousRecord: null,
        currentRecord: null
      };
      if (!current[field] || safeNumber(record.total_holding_shares) > safeNumber(current[field].total_holding_shares)) {
        current[field] = record;
        current.issuer_name = record.issuer_name || current.issuer_name;
      }
      byTicker.set(record.ticker, current);
    };

    const previousMatches = this.findInvestorRecords(fromPeriod, holder);
    const currentMatches = this.findInvestorRecords(toPeriod, holder);
    for (const record of previousMatches) {
      putRecord(record, 'previousRecord');
    }
    for (const record of currentMatches) {
      putRecord(record, 'currentRecord');
    }

    let records = Array.from(byTicker.values()).map((item) => ({
      ticker: item.ticker,
      issuer_name: item.currentRecord?.issuer_name ?? item.previousRecord?.issuer_name ?? item.issuer_name,
      holder: item.currentRecord?.investor_name ?? item.previousRecord?.investor_name ?? String(holder ?? '').trim(),
      ...buildHolderComparison(item.previousRecord, item.currentRecord),
      previousRecord: item.previousRecord,
      currentRecord: item.currentRecord
    }));

    if (normalizedStatus) {
      records = records.filter((record) => record.status === normalizedStatus);
    }

    records.sort((left, right) => {
      const priorityDiff = (STATUS_PRIORITY.get(left.status) ?? 99) - (STATUS_PRIORITY.get(right.status) ?? 99);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return Math.abs(right.volume_delta) - Math.abs(left.volume_delta);
    });

    const limitedRecords = records.slice(0, maxRows);
    return {
      holderQuery: String(holder ?? '').trim(),
      from: fromPeriod,
      to: toPeriod,
      returned: limitedRecords.length,
      totalMatches: records.length,
      holderMatches: this.summarizeHolderMatches([...previousMatches, ...currentMatches]),
      records: limitedRecords
    };
  }

  getNetwork({ period, ticker, holder, limit = 10, neighborLimit = 5 }) {
    const resolvedPeriod = this.resolveHolderPeriod(period);
    if (!resolvedPeriod) {
      return {
        period: null,
        mode: null,
        nodes: [],
        links: []
      };
    }

    const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
    const holderQuery = String(holder ?? '').trim();
    if (!normalizedTicker && !holderQuery) {
      throw new Error('ticker or holder is required');
    }

    const maxPrimary = Math.max(1, Math.min(Number(limit) || 10, 50));
    const maxNeighbors = Math.max(0, Math.min(Number(neighborLimit) || 5, 25));
    return normalizedTicker
      ? this.buildStockNetwork({ period: resolvedPeriod, ticker: normalizedTicker, limit: maxPrimary, neighborLimit: maxNeighbors })
      : this.buildInvestorNetwork({ period: resolvedPeriod, holder: holderQuery, limit: maxPrimary, neighborLimit: maxNeighbors });
  }

  buildStockNetwork({ period, ticker, limit, neighborLimit }) {
    const nodes = [];
    const links = [];
    const nodeIds = new Set();
    const addNode = (node) => {
      if (!nodeIds.has(node.id)) {
        nodeIds.add(node.id);
        nodes.push(node);
      }
    };
    const addStockNode = (record, isRoot = false) => {
      addNode({
        id: `stock:${record.ticker}`,
        type: 'stock',
        label: record.ticker,
        ticker: record.ticker,
        issuer_name: record.issuer_name,
        root: isRoot
      });
    };
    const addHolderNode = (record) => {
      addNode({
        id: `holder:${record.investor_key}`,
        type: 'holder',
        label: record.investor_name,
        investor_name: record.investor_name,
        investor_type: record.investor_type,
        origin: record.origin,
        country: record.country,
        domicile: record.domicile
      });
    };

    const holders = (this.holdersByPeriodTicker.get(`${period}|${ticker}`) ?? [])
      .slice()
      .sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0))
      .slice(0, limit);
    const rootRecord = holders[0] ?? { ticker, issuer_name: ticker };
    addStockNode(rootRecord, true);

    for (const holderRecord of holders) {
      addHolderNode(holderRecord);
      links.push({
        source: `stock:${ticker}`,
        target: `holder:${holderRecord.investor_key}`,
        relation: 'owned_by',
        volume: holderRecord.total_holding_shares,
        percentage: holderRecord.percentage
      });

      const otherHoldings = (this.holdersByPeriodInvestor.get(`${period}|${holderRecord.investor_key}`) ?? [])
        .filter((record) => record.ticker !== ticker)
        .sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0))
        .slice(0, neighborLimit);

      for (const otherRecord of otherHoldings) {
        addStockNode(otherRecord);
        links.push({
          source: `holder:${holderRecord.investor_key}`,
          target: `stock:${otherRecord.ticker}`,
          relation: 'also_owns',
          volume: otherRecord.total_holding_shares,
          percentage: otherRecord.percentage
        });
      }
    }

    return {
      mode: 'stock',
      period,
      ticker,
      returnedHolders: holders.length,
      nodes,
      links
    };
  }

  buildInvestorNetwork({ period, holder, limit, neighborLimit }) {
    const nodes = [];
    const links = [];
    const nodeIds = new Set();
    const holdingsResult = this.getInvestorHoldings({
      holder,
      period,
      limit,
      sort: 'percentage_desc'
    });
    const holdings = holdingsResult.records;
    const matchedHolderKeys = new Set(holdingsResult.holderMatches.map((match) => match.investor_key));
    const isSingleHolderMatch = matchedHolderKeys.size === 1;
    const rootKey = isSingleHolderMatch
      ? holdingsResult.holderMatches[0].investor_key
      : `QUERY:${normalizeHolderKey(holder)}`;
    const rootName = isSingleHolderMatch
      ? holdingsResult.holderMatches[0].investor_name
      : holder;
    const addNode = (node) => {
      if (!nodeIds.has(node.id)) {
        nodeIds.add(node.id);
        nodes.push(node);
      }
    };
    const addHolderNode = (record, isRoot = false) => {
      addNode({
        id: `holder:${record.investor_key}`,
        type: 'holder',
        label: record.investor_name,
        investor_name: record.investor_name,
        investor_type: record.investor_type,
        origin: record.origin,
        country: record.country,
        domicile: record.domicile,
        root: isRoot
      });
    };
    const addStockNode = (record) => {
      addNode({
        id: `stock:${record.ticker}`,
        type: 'stock',
        label: record.ticker,
        ticker: record.ticker,
        issuer_name: record.issuer_name
      });
    };

    addNode({
      id: `holder:${rootKey}`,
      type: isSingleHolderMatch ? 'holder' : 'holder_query',
      label: rootName,
      investor_name: rootName,
      holderMatches: holdingsResult.holderMatches,
      root: true
    });

    for (const holding of holdings) {
      addStockNode(holding);
      links.push({
        source: `holder:${rootKey}`,
        target: `stock:${holding.ticker}`,
        relation: 'owns',
        volume: holding.total_holding_shares,
        percentage: holding.percentage
      });

      const coHolders = (this.holdersByPeriodTicker.get(`${period}|${holding.ticker}`) ?? [])
        .filter((record) => !matchedHolderKeys.has(record.investor_key))
        .sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0))
        .slice(0, neighborLimit);

      for (const coHolder of coHolders) {
        addHolderNode(coHolder);
        links.push({
          source: `stock:${holding.ticker}`,
          target: `holder:${coHolder.investor_key}`,
          relation: 'co_holder',
          volume: coHolder.total_holding_shares,
          percentage: coHolder.percentage
        });
      }
    }

    return {
      mode: 'holder',
      period,
      holderQuery: holder,
      holder: rootName,
      holderMatches: holdingsResult.holderMatches,
      returnedHoldings: holdings.length,
      nodes,
      links
    };
  }

  getHistory({ ticker, startDate, endDate, order = 'asc' }) {
    const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
    if (!normalizedTicker) {
      throw new Error('ticker is required');
    }

    const records = this.historyByTicker.get(normalizedTicker) ?? [];
    const normalizedStart = startDate ? normalizeDateInput(startDate) ?? normalizePeriodInput(startDate) : null;
    const normalizedEnd = endDate ? normalizeDateInput(endDate) ?? normalizePeriodInput(endDate) : null;

    let filtered = records.filter((record) => {
      if (normalizedStart && record.date < normalizedStart) {
        return false;
      }
      if (normalizedEnd) {
        const endBoundary = normalizedEnd.length === 7 ? `${normalizedEnd}-99` : normalizedEnd;
        if (record.date > endBoundary) {
          return false;
        }
      }
      return true;
    });

    if (order === 'desc') {
      filtered = filtered.slice().reverse();
    }

    return {
      ticker: normalizedTicker,
      startDate: filtered[0]?.date ?? null,
      endDate: filtered[filtered.length - 1]?.date ?? null,
      returned: filtered.length,
      records: filtered
    };
  }

  findHistoryRecord(ticker, dateOrPeriod) {
    const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
    const records = this.historyByTicker.get(normalizedTicker) ?? [];
    const date = normalizeDateInput(dateOrPeriod);
    if (date) {
      return records.find((record) => record.date === date) ?? null;
    }

    const period = normalizePeriodInput(dateOrPeriod);
    if (!period) {
      return null;
    }

    return records.filter((record) => record.date.startsWith(period)).at(-1) ?? null;
  }

  compare({ ticker, from, to, metric = DEFAULT_COMPARE_METRIC }) {
    const normalizedTicker = String(ticker ?? '').trim().toUpperCase();
    const normalizedMetric = String(metric ?? DEFAULT_COMPARE_METRIC).trim();
    const fromRecord = this.findHistoryRecord(normalizedTicker, from);
    const toRecord = this.findHistoryRecord(normalizedTicker, to);

    if (!fromRecord || !toRecord) {
      throw new Error(`Ownership history not found for ${normalizedTicker} in requested periods`);
    }

    if (!(normalizedMetric in fromRecord) || !(normalizedMetric in toRecord)) {
      throw new Error(`Unknown metric: ${normalizedMetric}`);
    }

    const before = fromRecord[normalizedMetric];
    const after = toRecord[normalizedMetric];
    const diff = after - before;

    return {
      ticker: normalizedTicker,
      metric: normalizedMetric,
      from: fromRecord.date,
      to: toRecord.date,
      before,
      after,
      diff,
      changePercent: safePercentChange(before, after),
      fromRecord,
      toRecord
    };
  }

  serializeHoldersToCsv(records) {
    return rowsToCsv(
      [
        'date',
        'period',
        'ticker',
        'issuer_name',
        'investor_name',
        'investor_type',
        'local_foreign',
        'nationality',
        'domicile',
        'holdings_scripless',
        'holdings_scrip',
        'total_holding_shares',
        'percentage'
      ],
      records
    );
  }

  serializeHistoryToCsv(records) {
    return rowsToCsv(
      [
        'date',
        'ticker',
        'price',
        'local_is',
        'local_cp',
        'local_pf',
        'local_ib',
        'local_id',
        'local_mf',
        'local_sc',
        'local_fd',
        'local_ot',
        'local_total',
        'foreign_is',
        'foreign_cp',
        'foreign_pf',
        'foreign_ib',
        'foreign_id',
        'foreign_mf',
        'foreign_sc',
        'foreign_fd',
        'foreign_ot',
        'foreign_total'
      ],
      records
    );
  }
}
