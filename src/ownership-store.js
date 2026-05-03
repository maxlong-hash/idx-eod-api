import fs from 'node:fs';
import path from 'node:path';

const MONTH_NAME_TO_NUMBER = new Map([
  ['jan', 1],
  ['january', 1],
  ['feb', 2],
  ['february', 2],
  ['mar', 3],
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
  ['august', 8],
  ['sep', 9],
  ['sept', 9],
  ['september', 9],
  ['oct', 10],
  ['october', 10],
  ['okt', 10],
  ['nov', 11],
  ['november', 11],
  ['dec', 12],
  ['december', 12],
  ['des', 12]
]);

const DEFAULT_COMPARE_METRIC = 'local_total';

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

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  if (normalized === 'FOREIGN') {
    return 'F';
  }
  return normalized;
}

function safePercentChange(before, after) {
  if (before === null || before === undefined || before === 0) {
    return null;
  }
  return ((after - before) / before) * 100;
}

export class OwnershipDataStore {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir);
    this.loaded = false;
    this.loadingPromise = null;
    this.loadedAt = null;
    this.historyByTicker = new Map();
    this.holdersByPeriodTicker = new Map();
    this.holderSnapshots = [];
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
      .filter((fileName) => /^data_.*\.js$/i.test(fileName));

    for (const fileName of holderFiles) {
      const filePath = path.join(this.dataDir, fileName);
      const rows = loadJsArray(filePath);
      const firstDate = normalizeDateInput(rows[0]?.date);
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
        if (!ticker) {
          continue;
        }

        const key = `${period}|${ticker}`;
        if (!this.holdersByPeriodTicker.has(key)) {
          this.holdersByPeriodTicker.set(key, []);
        }

        this.holdersByPeriodTicker.get(key).push({
          date: firstDate,
          period,
          ticker,
          issuer_name: row.issuer_name ?? '',
          investor_name: row.investor_name ?? '',
          investor_type: row.investor_type ?? '',
          local_foreign: row.local_foreign ?? '',
          nationality: row.nationality ?? '',
          domicile: row.domicile ?? '',
          holdings_scripless: toNumber(row.holdings_scripless),
          holdings_scrip: toNumber(row.holdings_scrip),
          total_holding_shares: toNumber(row.total_holding_shares),
          percentage: toNumber(row.percentage)
        });
      }
    }

    for (const holders of this.holdersByPeriodTicker.values()) {
      holders.sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0));
    }

    this.holderSnapshots.sort((left, right) => left.date.localeCompare(right.date));
    this.loadedAt = new Date().toISOString();
    this.loaded = true;
  }

  getStats() {
    const historyRecordCount = Array.from(this.historyByTicker.values())
      .reduce((sum, records) => sum + records.length, 0);
    const latestHolderSnapshot = this.holderSnapshots[this.holderSnapshots.length - 1] ?? null;
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
