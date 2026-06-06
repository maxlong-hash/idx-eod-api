import type { CleanEodRecord, EodHistoryResponse, EodMarketResponse, MarketSnapshot } from './types';

const API_BASE = '';

function cleanRecords(response: EodHistoryResponse): CleanEodRecord[] {
  return response.records
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
      tradeFrequency: row.tradeFrequency == null ? null : Number(row.tradeFrequency),
      tradeValue: row.tradeValue == null ? null : Number(row.tradeValue),
      nbsa: row.nbsa == null ? null : Number(row.nbsa),
      previousClose: row.previousClose == null ? null : Number(row.previousClose),
      change: row.change == null ? null : Number(row.change),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchTickerHistory(ticker: string, startDate: string, signal?: AbortSignal) {
  const query = new URLSearchParams({
    ticker,
    startDate,
    order: 'asc',
    format: 'json',
  });
  const payload = await fetchJson<EodHistoryResponse>(`/api/eod/history?${query.toString()}`, signal);
  return {
    latestAvailableDate: payload.latestAvailableDate,
    records: cleanRecords(payload),
  };
}

export async function fetchIhsgHistory(startDate: string, signal?: AbortSignal) {
  const query = new URLSearchParams({
    startDate,
    order: 'asc',
    format: 'json',
  });
  const payload = await fetchJson<EodHistoryResponse>(`/api/eod/ihsg?${query.toString()}`, signal);
  return cleanRecords(payload);
}

export async function fetchMarketSnapshot(date?: string, signal?: AbortSignal): Promise<MarketSnapshot> {
  const query = new URLSearchParams({
    orderBy: 'ticker',
  });
  if (date) query.set('date', date);
  const payload = await fetchJson<EodMarketResponse>(`/api/eod/market?${query.toString()}`, signal);
  return {
    date: payload.date,
    totalTickers: payload.totalTickers,
    returned: payload.returned,
    totalVolume: Number(payload.totalVolume ?? 0),
    totalTradeValue: Number(payload.totalTradeValue ?? 0),
    gainers: payload.gainers,
    losers: payload.losers,
    unchanged: payload.unchanged,
    records: cleanRecords({ records: payload.records } as EodHistoryResponse),
  };
}

export type BroksumMarketRankingSide = 'net_foreign_buy' | 'net_foreign_sell' | 'foreign_accumulation' | 'foreign_distribution' | 'value';

export type BroksumMarketRankingRecord = {
  ticker: string;
  date: string;
  close: number | null;
  changePercent: number | null;
  totalValue: number;
  foreignNetValue: number;
  localNetValue: number;
  governmentNetValue: number;
  brokerConcentrationPct: number;
};

export type BroksumMarketRankingResponse = {
  date: string;
  side: BroksumMarketRankingSide;
  totalMatches: number;
  returned: number;
  records: BroksumMarketRankingRecord[];
};

export async function fetchBroksumMarketRanking(
  side: BroksumMarketRankingSide,
  date?: string | null,
  limit = 12,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ side, limit: String(limit), format: 'json' });
  if (date) query.set('date', date);
  return fetchJson<BroksumMarketRankingResponse>(`/api/broksum/market/ranking?${query.toString()}`, signal);
}

export function parseWatchlist(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim().toUpperCase().replace(/^IDX:/, ''))
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}
