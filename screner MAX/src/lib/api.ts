import type { CleanEodRecord, EodHistoryResponse } from './types';

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
