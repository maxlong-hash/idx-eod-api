import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const MONTH_NAME_TO_NUMBER = new Map([
  ['jan', 1],
  ['january', 1],
  ['januari', 1],
  ['feb', 2],
  ['february', 2],
  ['februari', 2],
  ['mar', 3],
  ['march', 3],
  ['maret', 3],
  ['apr', 4],
  ['april', 4],
  ['mei', 5],
  ['may', 5],
  ['jun', 6],
  ['june', 6],
  ['juni', 6],
  ['jul', 7],
  ['july', 7],
  ['juli', 7],
  ['aug', 8],
  ['august', 8],
  ['agustus', 8],
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

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

export function normalizeDateInput(input) {
  if (!input) {
    return null;
  }

  const raw = String(input).trim();
  if (!raw) {
    return null;
  }

  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (isValidDateParts(year, month, day)) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
    return null;
  }

  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);

    let month = first;
    let day = second;

    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else if (second > 12 && first <= 12) {
      month = first;
      day = second;
    }

    if (isValidDateParts(year, month, day)) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }

    return null;
  }

  match = raw.match(/^(\d{1,2})[-\s]([A-Za-z]+)[-\s](\d{4})$/i);
  if (match) {
    const day = Number(match[1]);
    const month = MONTH_NAME_TO_NUMBER.get(match[2].toLowerCase());
    const year = Number(match[3]);

    if (month && isValidDateParts(year, month, day)) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }

    return null;
  }

  return null;
}

function extractDateFromText(input) {
  const raw = String(input ?? '');
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,
    /\b\d{1,2}[\s-][A-Za-z]+[\s-]\d{4}\b/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) {
      continue;
    }

    const normalized = normalizeDateInput(match[0]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function parseDatasetDate(rawDate) {
  const match = String(rawDate).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);

  if (!isValidDateParts(year, month, day)) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function formatNumber(value, maximumFractionDigits = 2) {
  if (value === null || value === undefined) {
    return 'n/a';
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits
  }).format(value);
}

function formatPercent(value) {
  if (value === null || value === undefined) {
    return 'n/a';
  }

  return `${formatNumber(value, 2)}%`;
}

function sumBy(records, key) {
  return records.reduce((accumulator, record) => accumulator + (record[key] ?? 0), 0);
}

function recordId(ticker, date) {
  return `record:${ticker}:${date}`;
}

function tickerId(ticker) {
  return `ticker:${ticker}`;
}

function dateId(date) {
  return `date:${date}`;
}

function datasetId() {
  return 'dataset:metadata';
}

export class EodDataStore {
  constructor(options = {}) {
    this.filePath = path.resolve(options.filePath);
    this.publicBaseUrl = options.publicBaseUrl
      ? String(options.publicBaseUrl).replace(/\/+$/, '')
      : null;
    this.loaded = false;
    this.loadingPromise = null;
    this.loadedAt = null;
    this.totalRecords = 0;
    this.latestDate = null;
    this.earliestDate = null;
    this.recordsByTicker = new Map();
    this.recordsByTickerDate = new Map();
    this.recordsByDate = new Map();
    this.tickers = [];
    this.tickerSet = new Set();
    this.availableDates = [];
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
    if (!fs.existsSync(this.filePath)) {
      throw new Error(`EOD dataset file not found: ${this.filePath}`);
    }

    const stream = fs.createReadStream(this.filePath, { encoding: 'utf8' });
    const reader = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    let lineNumber = 0;

    for await (const line of reader) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (lineNumber === 1 && trimmed.startsWith('<date>')) {
        continue;
      }

      const parts = trimmed.split(',');
      if (parts.length < 10) {
        continue;
      }

      const date = parseDatasetDate(parts[0]);
      const ticker = String(parts[1] ?? '').trim().toUpperCase();

      if (!date || !ticker) {
        continue;
      }

      const record = {
        date,
        ticker,
        open: toNumber(parts[2]),
        high: toNumber(parts[3]),
        low: toNumber(parts[4]),
        close: toNumber(parts[5]),
        volume: toNumber(parts[6]),
        tradeFrequency: toNumber(parts[7]),
        tradeValue: toNumber(parts[8]),
        nbsa: toNumber(parts[9]),
        previousClose: null,
        change: null,
        changePercent: null
      };

      if (!this.recordsByTicker.has(ticker)) {
        this.recordsByTicker.set(ticker, []);
        this.recordsByTickerDate.set(ticker, new Map());
      }

      if (!this.recordsByDate.has(date)) {
        this.recordsByDate.set(date, []);
      }

      this.recordsByTicker.get(ticker).push(record);
      this.recordsByTickerDate.get(ticker).set(date, record);
      this.recordsByDate.get(date).push(record);
      this.tickerSet.add(ticker);
      this.totalRecords += 1;
    }

    this.tickers = Array.from(this.tickerSet).sort();
    this.availableDates = Array.from(this.recordsByDate.keys()).sort();
    this.earliestDate = this.availableDates[0] ?? null;
    this.latestDate = this.availableDates[this.availableDates.length - 1] ?? null;

    for (const records of this.recordsByTicker.values()) {
      records.sort((left, right) => left.date.localeCompare(right.date));

      for (let index = 0; index < records.length; index += 1) {
        const current = records[index];
        const previous = records[index - 1] ?? null;
        current.previousClose = previous?.close ?? null;

        if (current.close !== null && previous?.close) {
          current.change = current.close - previous.close;
          current.changePercent = previous.close === 0
            ? null
            : (current.change / previous.close) * 100;
        }
      }
    }

    this.loadedAt = new Date().toISOString();
    this.loaded = true;
  }

  getStats() {
    return {
      filePath: this.filePath,
      totalRecords: this.totalRecords,
      totalTickers: this.tickers.length,
      earliestDate: this.earliestDate,
      latestDate: this.latestDate,
      loadedAt: this.loadedAt
    };
  }

  getLatestAvailableDate(ticker) {
    if (!ticker) {
      return this.latestDate;
    }

    const records = this.recordsByTicker.get(String(ticker).toUpperCase());
    return records?.[records.length - 1]?.date ?? null;
  }

  getRecord(ticker, date) {
    const normalizedTicker = String(ticker).trim().toUpperCase();
    const records = this.recordsByTicker.get(normalizedTicker);
    if (!records || records.length === 0) {
      return null;
    }

    if (!date) {
      return records[records.length - 1];
    }

    const normalizedDate = normalizeDateInput(date);
    if (!normalizedDate) {
      throw new Error(`Invalid date format: ${date}. Use YYYY-MM-DD whenever possible.`);
    }

    return this.recordsByTickerDate.get(normalizedTicker)?.get(normalizedDate) ?? null;
  }

  getHistory({ ticker, startDate, endDate, limit = null, order = 'asc' }) {
    const normalizedTicker = String(ticker).trim().toUpperCase();
    const records = this.recordsByTicker.get(normalizedTicker);
    if (!records || records.length === 0) {
      return [];
    }

    const normalizedStart = startDate ? normalizeDateInput(startDate) : null;
    const normalizedEnd = endDate ? normalizeDateInput(endDate) : null;

    if (startDate && !normalizedStart) {
      throw new Error(`Invalid startDate: ${startDate}`);
    }

    if (endDate && !normalizedEnd) {
      throw new Error(`Invalid endDate: ${endDate}`);
    }

    let filtered = records.filter((record) => {
      if (normalizedStart && record.date < normalizedStart) {
        return false;
      }
      if (normalizedEnd && record.date > normalizedEnd) {
        return false;
      }
      return true;
    });

    if (order === 'desc') {
      filtered = filtered.slice().reverse();
    }

    if (limit === null || limit === undefined) {
      return filtered;
    }

    return filtered.slice(0, limit);
  }

  listTickers({ prefix = '', limit = 50 } = {}) {
    const normalizedPrefix = String(prefix).trim().toUpperCase();
    const matches = normalizedPrefix
      ? this.tickers.filter((ticker) => ticker.startsWith(normalizedPrefix))
      : this.tickers;

    return matches.slice(0, limit).map((ticker) => {
      const latestRecord = this.getRecord(ticker);
      return {
        ticker,
        latestDate: latestRecord?.date ?? null,
        latestClose: latestRecord?.close ?? null
      };
    });
  }

  getMarketDaySummary(dateInput, topN = 10) {
    const date = dateInput ? normalizeDateInput(dateInput) : this.latestDate;
    if (!date) {
      return null;
    }

    const records = this.recordsByDate.get(date);
    if (!records || records.length === 0) {
      return null;
    }

    const sortedByTradeValue = records
      .slice()
      .sort((left, right) => (right.tradeValue ?? 0) - (left.tradeValue ?? 0));
    const sortedByVolume = records
      .slice()
      .sort((left, right) => (right.volume ?? 0) - (left.volume ?? 0));
    const sortedByChangePercent = records
      .filter((record) => record.changePercent !== null)
      .slice()
      .sort((left, right) => (right.changePercent ?? -Infinity) - (left.changePercent ?? -Infinity));

    const gainers = records.filter((record) => (record.change ?? 0) > 0).length;
    const losers = records.filter((record) => (record.change ?? 0) < 0).length;
    const unchanged = records.length - gainers - losers;

    return {
      date,
      totalTickers: records.length,
      totalVolume: sumBy(records, 'volume'),
      totalTradeValue: sumBy(records, 'tradeValue'),
      gainers,
      losers,
      unchanged,
      topByTradeValue: sortedByTradeValue.slice(0, topN).map((record) => this.serializeRecord(record)),
      topByVolume: sortedByVolume.slice(0, topN).map((record) => this.serializeRecord(record)),
      topGainers: sortedByChangePercent.slice(0, topN).map((record) => this.serializeRecord(record)),
      topLosers: sortedByChangePercent.slice(-topN).reverse().map((record) => this.serializeRecord(record))
    };
  }

  serializeRecord(record) {
    if (!record) {
      return null;
    }

    return {
      id: recordId(record.ticker, record.date),
      ticker: record.ticker,
      date: record.date,
      open: record.open,
      high: record.high,
      low: record.low,
      close: record.close,
      volume: record.volume,
      tradeFrequency: record.tradeFrequency,
      tradeValue: record.tradeValue,
      nbsa: record.nbsa,
      previousClose: record.previousClose,
      change: record.change,
      changePercent: record.changePercent,
      documentUrl: this.getDocumentUrl(recordId(record.ticker, record.date))
    };
  }

  getDocumentUrl(id) {
    if (!this.publicBaseUrl) {
      return this.getLocalDocumentUrl(id);
    }

    if (id === datasetId()) {
      return `${this.publicBaseUrl}/documents/dataset/metadata`;
    }

    if (id.startsWith('ticker:')) {
      const [, ticker] = id.split(':');
      return `${this.publicBaseUrl}/documents/ticker/${ticker}`;
    }

    if (id.startsWith('date:')) {
      const [, date] = id.split(':');
      return `${this.publicBaseUrl}/documents/date/${date}`;
    }

    if (id.startsWith('record:')) {
      const [, ticker, date] = id.split(':');
      return `${this.publicBaseUrl}/documents/record/${ticker}/${date}`;
    }

    return `${this.publicBaseUrl}/documents/unknown`;
  }

  getLocalDocumentUrl(id) {
    if (id === datasetId()) {
      return 'eod://dataset/metadata';
    }

    if (id.startsWith('ticker:')) {
      return `eod://ticker/${id.split(':')[1]}`;
    }

    if (id.startsWith('date:')) {
      return `eod://date/${id.split(':')[1]}`;
    }

    if (id.startsWith('record:')) {
      const [, ticker, date] = id.split(':');
      return `eod://record/${ticker}/${date}`;
    }

    return 'eod://unknown';
  }

  extractTickersFromQuery(query) {
    const matches = String(query)
      .toUpperCase()
      .match(/[A-Z]{2,6}/g) ?? [];

    return Array.from(new Set(matches.filter((candidate) => this.tickerSet.has(candidate))));
  }

  search(query, limit = 10) {
    const trimmedQuery = String(query ?? '').trim();
    if (!trimmedQuery) {
      return { results: [] };
    }

    const normalizedQuery = trimmedQuery.toLowerCase();
    const tickers = this.extractTickersFromQuery(trimmedQuery);
    const date = extractDateFromText(trimmedQuery);
    const results = [];
    const seen = new Set();

    const pushResult = (result) => {
      if (!result || seen.has(result.id) || results.length >= limit) {
        return;
      }
      results.push(result);
      seen.add(result.id);
    };

    if (
      normalizedQuery.includes('dataset') ||
      normalizedQuery.includes('metadata') ||
      normalizedQuery.includes('schema') ||
      normalizedQuery === 'eod'
    ) {
      pushResult(this.buildSearchResult(this.getDatasetMetadataDocument()));
    }

    if (date) {
      pushResult(this.buildSearchResult(this.getDateDocument(date)));
    }

    for (const ticker of tickers) {
      if (date) {
        pushResult(this.buildSearchResult(this.getRecordDocument(ticker, date)));
      }

      pushResult(this.buildSearchResult(this.getTickerDocument(ticker)));
    }

    if (results.length === 0) {
      const compact = normalizedQuery.replace(/\s+/g, '');
      const tickerMatches = this.tickers.filter((ticker) => {
        const lower = ticker.toLowerCase();
        return lower === compact || lower.startsWith(compact) || compact.includes(lower);
      });

      for (const ticker of tickerMatches.slice(0, limit)) {
        pushResult(this.buildSearchResult(this.getTickerDocument(ticker)));
      }
    }

    if (results.length === 0) {
      pushResult(this.buildSearchResult(this.getDatasetMetadataDocument()));
    }

    return { results };
  }

  buildSearchResult(document) {
    if (!document) {
      return null;
    }

    return {
      id: document.id,
      title: document.title,
      text: document.text.slice(0, 240),
      url: document.url
    };
  }

  getDatasetMetadataDocument() {
    const stats = this.getStats();
    return {
      id: datasetId(),
      title: 'IDX EOD dataset metadata',
      text: [
        'IDX end-of-day dataset metadata.',
        `File: ${stats.filePath}`,
        `Total records: ${stats.totalRecords}`,
        `Total tickers: ${stats.totalTickers}`,
        `Date range: ${stats.earliestDate} to ${stats.latestDate}`,
        `Loaded at: ${stats.loadedAt}`
      ].join('\n'),
      url: this.getDocumentUrl(datasetId()),
      metadata: stats
    };
  }

  getTickerDocument(tickerInput) {
    const ticker = String(tickerInput).trim().toUpperCase();
    const records = this.recordsByTicker.get(ticker);
    if (!records || records.length === 0) {
      return null;
    }

    const latest = records[records.length - 1];
    const recent = records.slice(-10).reverse();
    const textLines = [
      `Ticker: ${ticker}`,
      `Latest available date: ${latest.date}`,
      `Latest close: ${formatNumber(latest.close)}`,
      `Previous close: ${formatNumber(latest.previousClose)}`,
      `Daily change: ${formatNumber(latest.change)} (${formatPercent(latest.changePercent)})`,
      `Latest volume: ${formatNumber(latest.volume, 0)}`,
      `Latest trade value: ${formatNumber(latest.tradeValue, 0)}`,
      `Latest NBSA: ${formatNumber(latest.nbsa, 0)}`,
      '',
      'Recent 10 records:',
      ...recent.map((record) =>
        `${record.date} | O:${formatNumber(record.open)} H:${formatNumber(record.high)} L:${formatNumber(record.low)} C:${formatNumber(record.close)} V:${formatNumber(record.volume, 0)} Value:${formatNumber(record.tradeValue, 0)} Change:${formatPercent(record.changePercent)}`
      )
    ];

    return {
      id: tickerId(ticker),
      title: `${ticker} EOD summary`,
      text: textLines.join('\n'),
      url: this.getDocumentUrl(tickerId(ticker)),
      metadata: {
        ticker,
        totalRecords: records.length,
        firstDate: records[0].date,
        latestDate: latest.date
      }
    };
  }

  getDateDocument(dateInput) {
    const summary = this.getMarketDaySummary(dateInput, 10);
    if (!summary) {
      return null;
    }

    const textLines = [
      `Date: ${summary.date}`,
      `Total tickers: ${summary.totalTickers}`,
      `Total volume: ${formatNumber(summary.totalVolume, 0)}`,
      `Total trade value: ${formatNumber(summary.totalTradeValue, 0)}`,
      `Gainers: ${summary.gainers}`,
      `Losers: ${summary.losers}`,
      `Unchanged: ${summary.unchanged}`,
      '',
      'Top 10 by trade value:',
      ...summary.topByTradeValue.map((record) =>
        `${record.ticker} | Close:${formatNumber(record.close)} | TradeValue:${formatNumber(record.tradeValue, 0)} | Volume:${formatNumber(record.volume, 0)} | Change:${formatPercent(record.changePercent)}`
      )
    ];

    return {
      id: dateId(summary.date),
      title: `IDX market summary for ${summary.date}`,
      text: textLines.join('\n'),
      url: this.getDocumentUrl(dateId(summary.date)),
      metadata: summary
    };
  }

  getRecordDocument(tickerInput, dateInput) {
    const record = this.getRecord(tickerInput, dateInput);
    if (!record) {
      return null;
    }

    return {
      id: recordId(record.ticker, record.date),
      title: `${record.ticker} EOD record for ${record.date}`,
      text: [
        `Ticker: ${record.ticker}`,
        `Date: ${record.date}`,
        `Open: ${formatNumber(record.open)}`,
        `High: ${formatNumber(record.high)}`,
        `Low: ${formatNumber(record.low)}`,
        `Close: ${formatNumber(record.close)}`,
        `Volume: ${formatNumber(record.volume, 0)}`,
        `Trade frequency: ${formatNumber(record.tradeFrequency, 0)}`,
        `Trade value: ${formatNumber(record.tradeValue, 0)}`,
        `NBSA: ${formatNumber(record.nbsa, 0)}`,
        `Previous close: ${formatNumber(record.previousClose)}`,
        `Change: ${formatNumber(record.change)} (${formatPercent(record.changePercent)})`
      ].join('\n'),
      url: this.getDocumentUrl(recordId(record.ticker, record.date)),
      metadata: this.serializeRecord(record)
    };
  }

  fetchDocument(id) {
    const normalizedId = String(id ?? '').trim();
    if (!normalizedId) {
      return null;
    }

    if (normalizedId === datasetId()) {
      return this.getDatasetMetadataDocument();
    }

    if (normalizedId.startsWith('ticker:')) {
      return this.getTickerDocument(normalizedId.split(':')[1]);
    }

    if (normalizedId.startsWith('date:')) {
      return this.getDateDocument(normalizedId.split(':')[1]);
    }

    if (normalizedId.startsWith('record:')) {
      const [, ticker, date] = normalizedId.split(':');
      return this.getRecordDocument(ticker, date);
    }

    return null;
  }
}
