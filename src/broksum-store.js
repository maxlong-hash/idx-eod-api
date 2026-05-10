import fs from 'node:fs/promises';
import path from 'node:path';

const DATE_DIR_PATTERN = /^brokerdata_(\d{4}-\d{2}-\d{2})$/;
const BROKER_FILE_PATTERN = /^([A-Z0-9-]+)_brokerdata\.json$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const LOT_SIZE = 100;

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

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return isValidDateParts(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
}

function normalizeTicker(input) {
  return String(input ?? '').trim().toUpperCase();
}

function normalizeBroker(input) {
  return String(input ?? '').trim().toUpperCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLimit(limit, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) {
    return defaultLimit;
  }

  return Math.max(1, Math.min(maxLimit, Math.floor(parsed)));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(value, denominator) {
  if (!denominator) {
    return 0;
  }

  return (value / denominator) * 100;
}

function createTradeBucket(extra = {}) {
  return {
    ...extra,
    buyVolume: 0,
    buyValue: 0,
    buyFrequency: 0,
    sellVolume: 0,
    sellValue: 0,
    sellFrequency: 0,
    records: 0
  };
}

function applyTrade(bucket, record) {
  bucket.records += 1;

  if (record.transactionType === 'BUY') {
    bucket.buyVolume += record.volume;
    bucket.buyValue += record.value;
    bucket.buyFrequency += record.frequency;
    return;
  }

  if (record.transactionType === 'SELL') {
    bucket.sellVolume += record.volume;
    bucket.sellValue += record.value;
    bucket.sellFrequency += record.frequency;
  }
}

function derivedAveragePrice(value, volume) {
  if (!volume) {
    return null;
  }

  return value / (volume * LOT_SIZE);
}

function finalizeBucket(bucket) {
  const totalVolume = bucket.buyVolume + bucket.sellVolume;
  const totalValue = bucket.buyValue + bucket.sellValue;
  const totalFrequency = bucket.buyFrequency + bucket.sellFrequency;
  const netVolume = bucket.buyVolume - bucket.sellVolume;
  const netValue = bucket.buyValue - bucket.sellValue;
  const netFrequency = bucket.buyFrequency - bucket.sellFrequency;

  return {
    ...bucket,
    totalVolume,
    totalValue,
    totalFrequency,
    netVolume,
    netValue,
    netFrequency,
    netValueAbs: Math.abs(netValue),
    netVolumeAbs: Math.abs(netVolume),
    buyAvgPrice: round(derivedAveragePrice(bucket.buyValue, bucket.buyVolume), 2),
    sellAvgPrice: round(derivedAveragePrice(bucket.sellValue, bucket.sellVolume), 2),
    netSide: netValue > 0 ? 'BUY' : netValue < 0 ? 'SELL' : 'FLAT'
  };
}

function sortRows(rows, sort) {
  const copied = rows.slice();
  switch (sort) {
    case 'net_value_asc':
      return copied.sort((left, right) => left.netValue - right.netValue);
    case 'buy_value_desc':
      return copied.sort((left, right) => right.buyValue - left.buyValue);
    case 'sell_value_desc':
      return copied.sort((left, right) => right.sellValue - left.sellValue);
    case 'ticker_asc':
      return copied.sort((left, right) => String(left.ticker).localeCompare(String(right.ticker)));
    case 'date_desc':
      return copied.sort((left, right) => String(right.date).localeCompare(String(left.date)));
    case 'date_asc':
      return copied.sort((left, right) => String(left.date).localeCompare(String(right.date)));
    case 'net_value_desc':
    default:
      return copied.sort((left, right) => right.netValue - left.netValue);
  }
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function createRangeBrokerBucket(row) {
  return {
    code: row.code,
    name: row.name,
    investorGroups: new Set(row.investorGroups ?? []),
    dates: new Set(),
    buyDays: 0,
    sellDays: 0,
    netBuyDays: 0,
    netSellDays: 0,
    buyVolume: 0,
    buyValue: 0,
    buyFrequency: 0,
    sellVolume: 0,
    sellValue: 0,
    sellFrequency: 0,
    records: 0,
    daily: []
  };
}

function applyDailyBroker(bucket, row) {
  bucket.dates.add(row.date);
  bucket.records += row.records;
  bucket.buyVolume += row.buyVolume;
  bucket.buyValue += row.buyValue;
  bucket.buyFrequency += row.buyFrequency;
  bucket.sellVolume += row.sellVolume;
  bucket.sellValue += row.sellValue;
  bucket.sellFrequency += row.sellFrequency;
  bucket.daily.push(row);

  for (const group of row.investorGroups ?? []) {
    bucket.investorGroups.add(group);
  }

  if (row.buyValue > 0) {
    bucket.buyDays += 1;
  }
  if (row.sellValue > 0) {
    bucket.sellDays += 1;
  }
  if (row.netValue > 0) {
    bucket.netBuyDays += 1;
  }
  if (row.netValue < 0) {
    bucket.netSellDays += 1;
  }
}

function finalizeRangeBrokerBucket(bucket, totalTickerValue, includeDaily = false) {
  const finalized = finalizeBucket(bucket);
  const activeDays = bucket.dates.size;
  const dominantDays = Math.max(bucket.netBuyDays, bucket.netSellDays);
  const netValuePctOfTicker = pct(Math.abs(finalized.netValue), totalTickerValue);
  const consistencyScore = activeDays ? (dominantDays / activeDays) * 100 : 0;
  const status = classifyBrokerStatus(finalized.netValue, netValuePctOfTicker, consistencyScore);

  const result = {
    code: bucket.code,
    name: bucket.name,
    investorGroups: Array.from(bucket.investorGroups).sort(),
    activeDays,
    buyDays: bucket.buyDays,
    sellDays: bucket.sellDays,
    netBuyDays: bucket.netBuyDays,
    netSellDays: bucket.netSellDays,
    records: finalized.records,
    buyVolume: finalized.buyVolume,
    sellVolume: finalized.sellVolume,
    netVolume: finalized.netVolume,
    buyValue: finalized.buyValue,
    sellValue: finalized.sellValue,
    netValue: finalized.netValue,
    netValueAbs: finalized.netValueAbs,
    buyFrequency: finalized.buyFrequency,
    sellFrequency: finalized.sellFrequency,
    netFrequency: finalized.netFrequency,
    buyAvgPrice: finalized.buyAvgPrice,
    sellAvgPrice: finalized.sellAvgPrice,
    netSide: finalized.netSide,
    consistencyScore: round(consistencyScore, 2),
    netValuePctOfTicker: round(netValuePctOfTicker, 2),
    status
  };

  if (includeDaily) {
    result.daily = bucket.daily.sort((left, right) => left.date.localeCompare(right.date));
  }

  return result;
}

function classifyBrokerStatus(netValue, netValuePct, consistencyScore) {
  if (netValuePct < 2) {
    return 'NEUTRAL';
  }

  if (netValue > 0 && consistencyScore >= 50) {
    return 'ACCUMULATION';
  }

  if (netValue < 0 && consistencyScore >= 50) {
    return 'DISTRIBUTION';
  }

  return 'MIXED';
}

function classifyTickerSignal(score) {
  if (score >= 35) {
    return 'STRONG_ACCUMULATION';
  }
  if (score >= 15) {
    return 'ACCUMULATION';
  }
  if (score <= -35) {
    return 'STRONG_DISTRIBUTION';
  }
  if (score <= -15) {
    return 'DISTRIBUTION';
  }
  return 'MIXED_NEUTRAL';
}

function buildDailyBandarSignal(summary) {
  const foreignBias = pct(summary.foreignNetValue, summary.totalValue || 1);
  const concentrationBias = summary.topNetBuyer
    ? pct(summary.topNetBuyer.netValueAbs, summary.totalValue || 1)
    : 0;
  const sellerBias = summary.topNetSeller
    ? pct(summary.topNetSeller.netValueAbs, summary.totalValue || 1)
    : 0;
  const score = Math.max(-100, Math.min(100, foreignBias + concentrationBias - sellerBias));

  return {
    label: classifyTickerSignal(score),
    score: round(score, 2),
    foreignBiasPct: round(foreignBias, 2),
    topBuyerConcentrationPct: round(concentrationBias, 2),
    topSellerConcentrationPct: round(sellerBias, 2)
  };
}

function summarizePeriod(rows, brokerRows, eodRows) {
  const totals = createTradeBucket();
  let foreignNetValue = 0;
  let localNetValue = 0;
  let governmentNetValue = 0;

  for (const row of rows) {
    totals.buyVolume += row.buyVolume;
    totals.buyValue += row.buyValue;
    totals.buyFrequency += row.buyFrequency;
    totals.sellVolume += row.sellVolume;
    totals.sellValue += row.sellValue;
    totals.sellFrequency += row.sellFrequency;
    totals.records += row.rawRecords;
    foreignNetValue += row.foreignNetValue;
    localNetValue += row.localNetValue;
    governmentNetValue += row.governmentNetValue;
  }

  const finalized = finalizeBucket(totals);
  const topAccumulators = brokerRows
    .filter((row) => row.netValue > 0)
    .sort((left, right) => right.netValue - left.netValue)
    .slice(0, 5);
  const topDistributors = brokerRows
    .filter((row) => row.netValue < 0)
    .sort((left, right) => left.netValue - right.netValue)
    .slice(0, 5);

  const firstEod = eodRows.find(Boolean) ?? null;
  const latestEod = eodRows.filter(Boolean).at(-1) ?? null;
  const priceChangePct = firstEod?.close && latestEod?.close
    ? ((latestEod.close - firstEod.close) / firstEod.close) * 100
    : null;

  return {
    tradingDays: rows.length,
    rawRecords: finalized.records,
    buyVolume: finalized.buyVolume,
    sellVolume: finalized.sellVolume,
    buyValue: finalized.buyValue,
    sellValue: finalized.sellValue,
    totalValue: finalized.totalValue,
    foreignNetValue,
    localNetValue,
    governmentNetValue,
    foreignNetValuePct: round(pct(foreignNetValue, finalized.totalValue), 2),
    topAccumulators,
    topDistributors,
    firstClose: firstEod?.close ?? null,
    latestClose: latestEod?.close ?? null,
    priceChangePct: round(priceChangePct, 2)
  };
}

export class BroksumDataStore {
  constructor({ dataDir, eodStore = null }) {
    this.dataDir = path.resolve(dataDir);
    this.eodStore = eodStore;
    this.loaded = false;
    this.loadingPromise = null;
    this.loadedAt = null;
    this.dateInfos = [];
    this.dateSet = new Set();
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
    try {
      const entries = await fs.readdir(this.dataDir, { withFileTypes: true });
      const dateDirs = entries
        .filter((entry) => entry.isDirectory() && DATE_DIR_PATTERN.test(entry.name))
        .map((entry) => {
          const [, date] = entry.name.match(DATE_DIR_PATTERN);
          return {
            date,
            folder: entry.name,
            path: path.join(this.dataDir, entry.name)
          };
        })
        .sort((left, right) => left.date.localeCompare(right.date));

      this.dateInfos = [];
      for (const info of dateDirs) {
        let files = 0;
        try {
          const fileEntries = await fs.readdir(info.path, { withFileTypes: true });
          files = fileEntries.filter((entry) => entry.isFile() && BROKER_FILE_PATTERN.test(entry.name)).length;
        } catch {
          files = 0;
        }

        this.dateInfos.push({
          date: info.date,
          folder: info.folder,
          files
        });
      }

      this.dateSet = new Set(this.dateInfos.map((info) => info.date));
    } catch {
      this.dateInfos = [];
      this.dateSet = new Set();
    }

    this.loaded = true;
    this.loadedAt = new Date().toISOString();
  }

  getStats() {
    const earliest = this.dateInfos[0] ?? null;
    const latest = this.dateInfos[this.dateInfos.length - 1] ?? null;
    return {
      dataDir: this.dataDir,
      loaded: this.loaded,
      loadedAt: this.loadedAt,
      totalDates: this.dateInfos.length,
      earliestDate: earliest?.date ?? null,
      latestDate: latest?.date ?? null,
      latestTickerFiles: latest?.files ?? 0
    };
  }

  getLatestDate() {
    return this.dateInfos[this.dateInfos.length - 1]?.date ?? null;
  }

  resolveDates({ startDate, endDate, date, maxDays = null, defaultLatest = true } = {}) {
    if (date) {
      const normalized = normalizeDateInput(date);
      if (!normalized) {
        throw new Error(`Invalid date: ${date}`);
      }
      return this.dateSet.has(normalized) ? [normalized] : [];
    }

    const normalizedStart = startDate ? normalizeDateInput(startDate) : null;
    const normalizedEnd = endDate ? normalizeDateInput(endDate) : null;

    if (startDate && !normalizedStart) {
      throw new Error(`Invalid startDate: ${startDate}`);
    }
    if (endDate && !normalizedEnd) {
      throw new Error(`Invalid endDate: ${endDate}`);
    }

    let dates = this.dateInfos.map((info) => info.date);
    if (normalizedStart) {
      dates = dates.filter((item) => item >= normalizedStart);
    }
    if (normalizedEnd) {
      dates = dates.filter((item) => item <= normalizedEnd);
    }

    if (defaultLatest && !normalizedStart && !normalizedEnd && dates.length > 0) {
      dates = [dates[dates.length - 1]];
    }

    if (maxDays && dates.length > maxDays) {
      throw new Error(`Requested range has ${dates.length} trading days, maximum is ${maxDays}`);
    }

    return dates;
  }

  async getAvailability({ ticker, startDate, endDate } = {}) {
    await this.ensureLoaded();
    const dates = this.resolveDates({ startDate, endDate, defaultLatest: false });
    const normalizedTicker = ticker ? normalizeTicker(ticker) : null;

    if (!normalizedTicker) {
      const filtered = this.dateInfos.filter((info) => dates.includes(info.date));
      return {
        dataDir: this.dataDir,
        totalDates: filtered.length,
        earliestDate: filtered[0]?.date ?? null,
        latestDate: filtered[filtered.length - 1]?.date ?? null,
        dates: filtered
      };
    }

    const tickerDates = [];
    for (const itemDate of dates) {
      if (await this.hasTickerDate(normalizedTicker, itemDate)) {
        tickerDates.push(itemDate);
      }
    }

    return {
      dataDir: this.dataDir,
      ticker: normalizedTicker,
      totalDates: tickerDates.length,
      earliestDate: tickerDates[0] ?? null,
      latestDate: tickerDates[tickerDates.length - 1] ?? null,
      dates: tickerDates
    };
  }

  getTickerPath(ticker, date) {
    return path.join(this.dataDir, `brokerdata_${date}`, `${normalizeTicker(ticker)}_brokerdata.json`);
  }

  async hasTickerDate(ticker, date) {
    try {
      await fs.access(this.getTickerPath(ticker, date));
      return true;
    } catch {
      return false;
    }
  }

  async readTickerDate(ticker, date, { missingAsNull = false } = {}) {
    const normalizedTicker = normalizeTicker(ticker);
    const normalizedDate = normalizeDateInput(date);
    if (!normalizedTicker) {
      throw new Error('ticker is required');
    }
    if (!normalizedDate) {
      throw new Error(`Invalid date: ${date}`);
    }

    const filePath = this.getTickerPath(normalizedTicker, normalizedDate);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed.records) ? parsed.records : [];
      return {
        metadata: parsed.metadata ?? {},
        records: records.map((record) => this.normalizeRawRecord(record)).filter(Boolean),
        filePath
      };
    } catch (error) {
      if (missingAsNull && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  normalizeRawRecord(record) {
    const transactionType = String(record?.transaction_type ?? '').trim().toUpperCase();
    if (transactionType !== 'BUY' && transactionType !== 'SELL') {
      return null;
    }

    return {
      id: record.id ?? null,
      ticker: normalizeTicker(record.stock_symbol),
      stockId: record.stock_id ?? null,
      securityId: record.security_id ?? null,
      broker: {
        code: normalizeBroker(record.broker?.code),
        name: String(record.broker?.name ?? '').trim()
      },
      date: normalizeDateInput(record.date),
      transactionType,
      transactionTypeCode: record.transaction_type_code ?? null,
      investorGroup: String(record.investor_group ?? '').trim().toUpperCase() || 'UNKNOWN',
      investorGroupCode: record.investor_group_code ?? null,
      volume: toNumber(record.volume),
      value: toNumber(record.value),
      frequency: toNumber(record.frequency),
      avgPrice: round(toNumber(record.avg_price), 2)
    };
  }

  summarizeRecords(ticker, date, records, { topN = 5 } = {}) {
    const normalizedTicker = normalizeTicker(ticker);
    const byBroker = new Map();
    const byInvestorGroup = new Map();
    const overall = createTradeBucket();

    for (const record of records) {
      applyTrade(overall, record);

      const brokerCode = record.broker.code || 'UNKNOWN';
      if (!byBroker.has(brokerCode)) {
        byBroker.set(
          brokerCode,
          createTradeBucket({
            code: brokerCode,
            name: record.broker.name,
            investorGroups: new Set()
          })
        );
      }
      const brokerBucket = byBroker.get(brokerCode);
      brokerBucket.investorGroups.add(record.investorGroup);
      applyTrade(brokerBucket, record);

      if (!byInvestorGroup.has(record.investorGroup)) {
        byInvestorGroup.set(record.investorGroup, createTradeBucket({ investorGroup: record.investorGroup }));
      }
      applyTrade(byInvestorGroup.get(record.investorGroup), record);
    }

    const brokerRows = Array.from(byBroker.values())
      .map((bucket) => {
        const finalized = finalizeBucket(bucket);
        return {
          code: finalized.code,
          name: finalized.name,
          investorGroups: Array.from(finalized.investorGroups).sort(),
          date,
          ticker: normalizedTicker,
          records: finalized.records,
          buyVolume: finalized.buyVolume,
          sellVolume: finalized.sellVolume,
          netVolume: finalized.netVolume,
          buyValue: finalized.buyValue,
          sellValue: finalized.sellValue,
          netValue: finalized.netValue,
          netValueAbs: finalized.netValueAbs,
          buyFrequency: finalized.buyFrequency,
          sellFrequency: finalized.sellFrequency,
          netFrequency: finalized.netFrequency,
          buyAvgPrice: finalized.buyAvgPrice,
          sellAvgPrice: finalized.sellAvgPrice,
          netSide: finalized.netSide
        };
      })
      .sort((left, right) => right.netValueAbs - left.netValueAbs);

    const investorGroups = {};
    for (const [group, bucket] of byInvestorGroup.entries()) {
      investorGroups[group] = finalizeBucket(bucket);
    }

    const finalizedOverall = finalizeBucket(overall);
    const topNetBuyers = brokerRows
      .filter((row) => row.netValue > 0)
      .sort((left, right) => right.netValue - left.netValue)
      .slice(0, topN);
    const topNetSellers = brokerRows
      .filter((row) => row.netValue < 0)
      .sort((left, right) => left.netValue - right.netValue)
      .slice(0, topN);
    const topAbsBroker = brokerRows[0] ?? null;

    const summary = {
      ticker: normalizedTicker,
      date,
      rawRecords: records.length,
      brokerCount: brokerRows.length,
      buyVolume: finalizedOverall.buyVolume,
      sellVolume: finalizedOverall.sellVolume,
      buyValue: finalizedOverall.buyValue,
      sellValue: finalizedOverall.sellValue,
      totalValue: finalizedOverall.totalValue,
      buyFrequency: finalizedOverall.buyFrequency,
      sellFrequency: finalizedOverall.sellFrequency,
      foreignNetValue: investorGroups.FOREIGN?.netValue ?? 0,
      localNetValue: investorGroups.LOCAL?.netValue ?? 0,
      governmentNetValue: investorGroups.GOVERNMENT?.netValue ?? 0,
      foreignNetVolume: investorGroups.FOREIGN?.netVolume ?? 0,
      localNetVolume: investorGroups.LOCAL?.netVolume ?? 0,
      governmentNetVolume: investorGroups.GOVERNMENT?.netVolume ?? 0,
      brokerConcentrationPct: round(pct(topAbsBroker?.netValueAbs ?? 0, finalizedOverall.totalValue), 2),
      topNetBuyer: topNetBuyers[0] ?? null,
      topNetSeller: topNetSellers[0] ?? null,
      topNetBuyers,
      topNetSellers,
      investorGroups,
      brokerRows
    };

    return {
      ...summary,
      bandarSignal: buildDailyBandarSignal(summary)
    };
  }

  async getRaw({ ticker, date, broker, transactionType, investorGroup, limit, sort = 'value_desc' }) {
    await this.ensureLoaded();
    const normalizedTicker = normalizeTicker(ticker);
    const normalizedDate = normalizeDateInput(date ?? this.getLatestDate());
    if (!normalizedTicker) {
      throw new Error('ticker is required');
    }
    if (!normalizedDate) {
      throw new Error('date is required');
    }

    const data = await this.readTickerDate(normalizedTicker, normalizedDate);
    let records = data.records;
    const normalizedBroker = broker ? normalizeBroker(broker) : null;
    const normalizedType = transactionType ? String(transactionType).trim().toUpperCase() : null;
    const normalizedGroup = investorGroup ? String(investorGroup).trim().toUpperCase() : null;

    if (normalizedBroker) {
      records = records.filter((record) => record.broker.code === normalizedBroker);
    }
    if (normalizedType) {
      records = records.filter((record) => record.transactionType === normalizedType);
    }
    if (normalizedGroup) {
      records = records.filter((record) => record.investorGroup === normalizedGroup);
    }

    const sorted = records.slice().sort((left, right) => {
      if (sort === 'volume_desc') {
        return right.volume - left.volume;
      }
      if (sort === 'broker_asc') {
        return left.broker.code.localeCompare(right.broker.code);
      }
      return right.value - left.value;
    });

    const maxRows = normalizeLimit(limit, 200, MAX_LIMIT);
    return {
      ticker: normalizedTicker,
      date: normalizedDate,
      returned: Math.min(sorted.length, maxRows),
      totalMatches: sorted.length,
      records: sorted.slice(0, maxRows)
    };
  }

  async getTickerHistory({ ticker, startDate, endDate, order = 'asc', topN = 5, limit = null }) {
    await this.ensureLoaded();
    const normalizedTicker = normalizeTicker(ticker);
    if (!normalizedTicker) {
      throw new Error('ticker is required');
    }

    let dates = this.resolveDates({ startDate, endDate });
    if (order === 'desc') {
      dates = dates.slice().reverse();
    }
    if (limit !== null && limit !== undefined) {
      dates = dates.slice(0, normalizeLimit(limit, dates.length, MAX_LIMIT));
    }

    const rows = [];
    for (const date of dates) {
      const data = await this.readTickerDate(normalizedTicker, date, { missingAsNull: true });
      if (!data) {
        continue;
      }

      const summary = this.summarizeRecords(normalizedTicker, date, data.records, {
        topN: normalizeLimit(topN, 5, 20)
      });
      const eodRecord = this.eodStore?.getRecord(normalizedTicker, date) ?? null;
      rows.push({
        ...summary,
        eod: this.eodStore?.serializeRecord(eodRecord) ?? null
      });
    }

    return {
      ticker: normalizedTicker,
      startDate: rows[0]?.date ?? null,
      endDate: rows[rows.length - 1]?.date ?? null,
      returned: rows.length,
      records: rows
    };
  }

  async getTickerBrokers({ ticker, startDate, endDate, broker, limit, sort = 'net_value_desc', includeDaily = false }) {
    const history = await this.getTickerHistory({ ticker, startDate, endDate, topN: 10 });
    const normalizedBroker = broker ? normalizeBroker(broker) : null;
    const buckets = new Map();
    let totalTickerValue = 0;

    for (const daily of history.records) {
      totalTickerValue += daily.totalValue;
      for (const row of daily.brokerRows) {
        if (normalizedBroker && row.code !== normalizedBroker) {
          continue;
        }

        if (!buckets.has(row.code)) {
          buckets.set(row.code, createRangeBrokerBucket(row));
        }
        applyDailyBroker(buckets.get(row.code), row);
      }
    }

    let records = Array.from(buckets.values()).map((bucket) => finalizeRangeBrokerBucket(bucket, totalTickerValue, includeDaily));
    records = sortRows(records, sort);
    const maxRows = normalizeLimit(limit, 50, MAX_LIMIT);

    return {
      ticker: normalizeTicker(ticker),
      startDate: history.startDate,
      endDate: history.endDate,
      tradingDays: history.returned,
      totalMatches: records.length,
      returned: Math.min(records.length, maxRows),
      records: records.slice(0, maxRows)
    };
  }

  async getMarketRanking({ date, side = 'accumulation', limit, topN = 3 }) {
    await this.ensureLoaded();
    const normalizedDate = normalizeDateInput(date ?? this.getLatestDate());
    if (!normalizedDate) {
      throw new Error('date is required');
    }

    const dirPath = path.join(this.dataDir, `brokerdata_${normalizedDate}`);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && BROKER_FILE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    const summaries = await mapLimit(files, 24, async (fileName) => {
      const [, ticker] = fileName.match(BROKER_FILE_PATTERN);
      const data = await this.readTickerDate(ticker, normalizedDate, { missingAsNull: true });
      if (!data) {
        return null;
      }
      const summary = this.summarizeRecords(ticker, normalizedDate, data.records, {
        topN: normalizeLimit(topN, 3, 10)
      });
      const eodRecord = this.eodStore?.getRecord(ticker, normalizedDate) ?? null;
      return {
        ticker: normalizeTicker(ticker),
        date: normalizedDate,
        close: eodRecord?.close ?? null,
        changePercent: eodRecord?.changePercent ?? null,
        totalValue: summary.totalValue,
        foreignNetValue: summary.foreignNetValue,
        localNetValue: summary.localNetValue,
        governmentNetValue: summary.governmentNetValue,
        brokerConcentrationPct: summary.brokerConcentrationPct,
        topNetBuyer: summary.topNetBuyer,
        topNetSeller: summary.topNetSeller,
        bandarSignal: summary.bandarSignal
      };
    });

    const records = summaries.filter(Boolean);

    const ranked = records.sort((left, right) => {
      switch (side) {
        case 'distribution':
          return (right.topNetSeller?.netValueAbs ?? 0) - (left.topNetSeller?.netValueAbs ?? 0);
        case 'foreign_accumulation':
          return right.foreignNetValue - left.foreignNetValue;
        case 'foreign_distribution':
          return left.foreignNetValue - right.foreignNetValue;
        case 'concentration':
          return right.brokerConcentrationPct - left.brokerConcentrationPct;
        case 'value':
          return right.totalValue - left.totalValue;
        case 'accumulation':
        default:
          return (right.topNetBuyer?.netValueAbs ?? 0) - (left.topNetBuyer?.netValueAbs ?? 0);
      }
    });

    const maxRows = normalizeLimit(limit, 50, MAX_LIMIT);
    return {
      date: normalizedDate,
      side,
      totalMatches: ranked.length,
      returned: Math.min(ranked.length, maxRows),
      records: ranked.slice(0, maxRows)
    };
  }

  async getBrokerHistory({ broker, ticker, startDate, endDate, limit, sort = 'net_value_desc' }) {
    await this.ensureLoaded();
    const normalizedBroker = normalizeBroker(broker);
    const normalizedTicker = ticker ? normalizeTicker(ticker) : null;
    if (!normalizedBroker) {
      throw new Error('broker is required');
    }

    const dates = this.resolveDates({
      startDate,
      endDate,
      maxDays: normalizedTicker ? 240 : 31
    });

    const records = [];
    for (const date of dates) {
      if (normalizedTicker) {
        const data = await this.readTickerDate(normalizedTicker, date, { missingAsNull: true });
        if (!data) {
          continue;
        }
        const summary = this.summarizeRecords(normalizedTicker, date, data.records, { topN: 5 });
        const row = summary.brokerRows.find((item) => item.code === normalizedBroker);
        if (row) {
          records.push(row);
        }
        continue;
      }

      const dirPath = path.join(this.dataDir, `brokerdata_${date}`);
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const dateRows = await mapLimit(entries.filter((entry) => entry.isFile() && BROKER_FILE_PATTERN.test(entry.name)), 24, async (entry) => {
        if (!entry.isFile() || !BROKER_FILE_PATTERN.test(entry.name)) {
          return null;
        }
        const [, fileTicker] = entry.name.match(BROKER_FILE_PATTERN);
        const data = await this.readTickerDate(fileTicker, date, { missingAsNull: true });
        if (!data) {
          return null;
        }
        const summary = this.summarizeRecords(fileTicker, date, data.records, { topN: 3 });
        const row = summary.brokerRows.find((item) => item.code === normalizedBroker);
        if (row) {
          return row;
        }
        return null;
      });
      records.push(...dateRows.filter(Boolean));
    }

    const sorted = sortRows(records, sort);
    const maxRows = normalizeLimit(limit, 100, MAX_LIMIT);
    return {
      broker: normalizedBroker,
      ticker: normalizedTicker,
      startDate: dates[0] ?? null,
      endDate: dates[dates.length - 1] ?? null,
      totalMatches: sorted.length,
      returned: Math.min(sorted.length, maxRows),
      records: sorted.slice(0, maxRows)
    };
  }

  async getSignal({ ticker, startDate, endDate }) {
    const history = await this.getTickerHistory({ ticker, startDate, endDate, topN: 5 });
    const brokers = await this.getTickerBrokers({ ticker, startDate, endDate, limit: 20 });
    const eodRows = history.records.map((row) => row.eod).filter(Boolean);
    const period = summarizePeriod(history.records, brokers.records, eodRows);

    const topAccumulator = period.topAccumulators[0] ?? null;
    const topDistributor = period.topDistributors[0] ?? null;
    const foreignComponent = Math.max(-35, Math.min(35, period.foreignNetValuePct ?? 0));
    const accumulatorComponent = topAccumulator ? Math.min(35, topAccumulator.netValuePctOfTicker) : 0;
    const distributorComponent = topDistributor ? Math.min(35, topDistributor.netValuePctOfTicker) : 0;
    const consistencyComponent = topAccumulator && topAccumulator.status === 'ACCUMULATION'
      ? Math.min(20, topAccumulator.consistencyScore / 5)
      : topDistributor && topDistributor.status === 'DISTRIBUTION'
        ? -Math.min(20, topDistributor.consistencyScore / 5)
        : 0;
    const priceComponent = period.priceChangePct === null
      ? 0
      : Math.max(-10, Math.min(10, period.priceChangePct / 2));
    const score = foreignComponent + accumulatorComponent - distributorComponent + consistencyComponent + priceComponent;
    const label = classifyTickerSignal(score);

    const reasons = [];
    if (topAccumulator) {
      reasons.push(`Top accumulator ${topAccumulator.code} net buy ${topAccumulator.netValue.toLocaleString('en-US')} over ${topAccumulator.activeDays} active days.`);
    }
    if (topDistributor) {
      reasons.push(`Top distributor ${topDistributor.code} net sell ${Math.abs(topDistributor.netValue).toLocaleString('en-US')} over ${topDistributor.activeDays} active days.`);
    }
    reasons.push(`Foreign net value ${period.foreignNetValue.toLocaleString('en-US')} (${period.foreignNetValuePct}pct of traded value).`);
    if (period.priceChangePct !== null) {
      reasons.push(`Price changed ${period.priceChangePct}pct from ${period.firstClose} to ${period.latestClose}.`);
    }

    return {
      ticker: normalizeTicker(ticker),
      startDate: history.startDate,
      endDate: history.endDate,
      label,
      score: round(score, 2),
      confidence: round(Math.min(95, Math.max(20, Math.abs(score) + 35)), 2),
      summary: period,
      topAccumulators: period.topAccumulators,
      topDistributors: period.topDistributors,
      reasons,
      caveat: 'Broker summary shows broker-level flow, not the final beneficial owner. Treat the signal as probabilistic evidence.'
    };
  }

  async compare({ ticker, fromStart, fromEnd, toStart, toEnd }) {
    if (!fromStart || !fromEnd || !toStart || !toEnd) {
      throw new Error('fromStart, fromEnd, toStart, and toEnd are required');
    }

    const fromHistory = await this.getTickerHistory({ ticker, startDate: fromStart, endDate: fromEnd, topN: 5 });
    const toHistory = await this.getTickerHistory({ ticker, startDate: toStart, endDate: toEnd, topN: 5 });
    const fromBrokers = await this.getTickerBrokers({ ticker, startDate: fromStart, endDate: fromEnd, limit: 20 });
    const toBrokers = await this.getTickerBrokers({ ticker, startDate: toStart, endDate: toEnd, limit: 20 });

    const fromSummary = summarizePeriod(fromHistory.records, fromBrokers.records, fromHistory.records.map((row) => row.eod).filter(Boolean));
    const toSummary = summarizePeriod(toHistory.records, toBrokers.records, toHistory.records.map((row) => row.eod).filter(Boolean));

    return {
      ticker: normalizeTicker(ticker),
      from: {
        startDate: fromHistory.startDate,
        endDate: fromHistory.endDate,
        summary: fromSummary
      },
      to: {
        startDate: toHistory.startDate,
        endDate: toHistory.endDate,
        summary: toSummary
      },
      delta: {
        totalValue: toSummary.totalValue - fromSummary.totalValue,
        foreignNetValue: toSummary.foreignNetValue - fromSummary.foreignNetValue,
        localNetValue: toSummary.localNetValue - fromSummary.localNetValue,
        governmentNetValue: toSummary.governmentNetValue - fromSummary.governmentNetValue,
        priceChangePct: round((toSummary.priceChangePct ?? 0) - (fromSummary.priceChangePct ?? 0), 2)
      }
    };
  }
}
