import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, BookOpen, CheckCircle2, ChevronRight, Clock3, Database, Download, Eye, EyeOff, Gauge, Heart, HelpCircle, Layers3, LineChart, Play, RefreshCw, Search, SlidersHorizontal, StopCircle, Target, TrendingUp, X, Zap } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { fetchBroksumMarketRanking, fetchIhsgHistory, fetchMarketSnapshot, fetchTickerHistory, parseWatchlist } from './lib/api';
import { buildMaxScreenerCsv, getMaxScreenerExportDate } from './lib/csvExport';
import { buildIhsgImpactRows, buildIhsgImpactRowsFromMarket, buildIhsgMoverGroups, getIhsgFloatMeta, getIhsgIndexSnapshot } from './lib/ihsgImpact';
import { IDX_UNIVERSE, IDX_UNIVERSE_COUNT } from './lib/idxUniverse';
import { INDEX_FILTER_OPTIONS, getIndexConstituentCount, getIndexFilterMeta, getIndexMemberSet } from './lib/indexConstituents';
import { analyzeTicker, DEFAULT_SETTINGS, DEFAULT_WATCHLIST, STRATEGY_OPTIONS } from './lib/maxEngine';
import type { IhsgImpactRow, IhsgIndexSnapshot, IhsgMoverGroup } from './lib/ihsgImpact';
import type { IndexFilterMode } from './lib/indexConstituents';
import type { BroksumMarketRankingRecord } from './lib/api';
import type { CleanEodRecord, MarketSnapshot, MaxSettings, ScanResult, SignalName, StrategyName } from './lib/types';

type FilterMode = 'signals' | 'all' | 'reversal' | 'momentum' | 'breakout' | 'risk';
type UniverseMode = 'all-idx' | 'custom';
type PageMode = 'movers' | 'scanner';

const signalColors: Record<string, string> = {
  'SMART SNIPER': '#00e5ff',
  'SNIPER COMBO': '#00e5ff',
  'BETA BREAKOUT': '#4f7cff',
  'SMART GAMMA': '#ffd700',
  'GAMMA PUMP': '#ffd700',
  'G ACC': '#ffd700',
  'V-SHAPE': '#d500f9',
  'EARLY SWEEP': '#ff8a00',
  'UNSAFE DIP': '#ff1744',
  HOLD: '#00e676',
  WAIT: '#8a92a6',
  AVOID: '#ff1744',
};

const signalLabels: SignalName[] = ['SMART SNIPER', 'SNIPER COMBO', 'BETA BREAKOUT', 'SMART GAMMA', 'G ACC', 'V-SHAPE', 'EARLY SWEEP'];

const guideSignals = [
  {
    name: 'SNIPER COMBO',
    group: 'Reversal / demand response',
    use: 'Buy the dip yang masih terstruktur di area demand atau discount.',
    note: 'Butuh volume, candle quality, aman dari crash filter, dan opsional imbalance/FVG.',
  },
  {
    name: 'SMART SNIPER',
    group: 'Upgrade dari SNIPER COMBO',
    use: 'Reversal yang sudah lolos konteks RISEN dan tidak berada di rezim crash/downtrend normal.',
    note: 'Ini bukan boolean sinyal baru, tetapi SNIPER yang difilter/di-upgrade oleh RISEN.',
  },
  {
    name: 'BETA BREAKOUT',
    group: 'Breakout / buy strength',
    use: 'Trend flip bullish saat harga sudah masuk area premium.',
    note: 'Lebih cocok untuk continuation setelah acceptance, bukan entry diskon.',
  },
  {
    name: 'V-SHAPE',
    group: 'Fast rebound / snapback',
    use: 'Rebound cepat setelah candle merah, close menembus midpoint candle sebelumnya, dan volume melonjak.',
    note: 'Paling perlu hati-hati karena implementasinya relatif longgar dan rawan false positive.',
  },
  {
    name: 'EARLY SWEEP',
    group: 'Liquidity sweep dini',
    use: 'Sweep low pivot terakhir dengan RSI membaik dan candle recovery bullish di area Sniper.',
    note: 'Sangat dini dan tidak punya filter volume eksplisit, jadi validasi likuiditas tetap penting.',
  },
  {
    name: 'GAMMA PUMP',
    group: 'Momentum continuation',
    use: 'Harga kuat di atas EMA50/EMA200, arah bullish, candle kuat, volume naik, dan RSI valid.',
    note: 'Anti-Crash tidak memfilter Gamma dasar dengan cara yang sama seperti Sniper/Beta/V-Shape/Early.',
  },
  {
    name: 'SMART GAMMA',
    group: 'Gamma + konfirmasi RISEN',
    use: 'Momentum continuation yang lolos breakout/squeeze RISEN.',
    note: 'Saat Show RISEN ON, Gamma mentah harus lolos filter SMART GAMMA agar tetap hidup.',
  },
  {
    name: 'G ACC',
    group: 'Gamma acceleration',
    use: 'Gamma lanjutan saat close lebih tinggi dari gamma reference aktif.',
    note: 'Ini rename/label lanjutan dari Gamma, bukan sinyal dasar terpisah.',
  },
];

const guidePrinciples = [
  'Mesin inti hanya punya lima sinyal dasar: Sniper, Beta, V-Shape, Gamma, dan Early. Label SMART dan G ACC adalah layer pasca-proses.',
  'Signal di screener ini dihitung dari data EOD candle yang sudah tutup, jadi lebih stabil daripada candle realtime intraday.',
  'Di TradingView realtime, sinyal bisa muncul/hilang sebelum candle tutup karena logika tidak memakai close-bar confirmation.',
  'Overlap bisa terjadi: satu saham dapat punya lebih dari satu sinyal aktif, tetapi tabel tetap memilih satu label utama.',
  'Show RISEN bukan hanya tampilan. Saat aktif, logika Sniper dan Gamma ikut berubah karena harus lolos filter SMART.',
  'Filter Lagging menyaring terutama BETA/GAMMA yang lemah relatif terhadap sektor, bukan sekadar relatif terhadap IHSG.',
];

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function formatIdr(value: number) {
  return `Rp ${formatNumber(value)}`;
}

function formatCompactIdr(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000_000_000).toFixed(2)}Q`;
  if (abs >= 1_000_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}${formatIdr(abs)}`;
}

function formatCompactQty(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  return `${sign}${formatNumber(abs)}`;
}

function parseRupiahInput(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

function formatPct(value: number) {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function formatWeightPct(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatImpactPoints(value: number | null) {
  if (value == null) return '-';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}`;
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildMoversCsv(rows: IhsgImpactRow[], foreignBuyRows: BroksumMarketRankingRecord[], foreignSellRows: BroksumMarketRankingRecord[]) {
  const foreignByTicker = new Map<string, BroksumMarketRankingRecord>();
  [...foreignBuyRows, ...foreignSellRows].forEach((row) => {
    if (!foreignByTicker.has(row.ticker)) foreignByTicker.set(row.ticker, row);
  });
  const headers = [
    'ticker',
    'date',
    'price',
    'changePct',
    'volume',
    'tradeFrequency',
    'turnoverValue',
    'nbsa',
    'ihsgWeightPct',
    'rawWeightPct',
    'impactPct',
    'impactPoints',
    'floatPct',
    'idxFreeFloatPct',
    'foreignNetValue',
    'marketCap',
    'freeFloatMarketCap',
    'group',
    'source',
    'confidence',
  ];
  const lines = rows.map((row) => {
    const foreign = foreignByTicker.get(row.ticker);
    return [
      row.ticker,
      row.latestDate,
      row.price,
      row.changePct,
      row.volume,
      row.tradeFrequency ?? '',
      row.turnoverValue,
      row.nbsa ?? '',
      row.cappedWeightPct,
      row.rawWeightPct,
      row.impactPct,
      row.impactPoints ?? '',
      row.floatPct,
      row.idxFreeFloatPct ?? '',
      foreign?.foreignNetValue ?? '',
      row.marketCap,
      row.freeFloatMarketCap,
      row.groupLabel,
      row.source,
      row.confidence,
    ].map(csvCell).join(',');
  });
  return [headers.join(','), ...lines].join('\n');
}

function resultMatchesFilter(result: ScanResult, mode: FilterMode) {
  if (mode === 'all') return true;
  if (mode === 'signals') return result.activeSignal;
  return result.signalGroup === mode;
}

function formatAge(result: ScanResult) {
  if (result.ageDays >= 999) return '-';
  return result.ageDays <= 1 ? 'NEW' : `${result.ageDays}d`;
}

function formatSignalList(signals: SignalName[]) {
  return signals.length ? signals.join(' + ') : '-';
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="sparkline-empty" />;
  const width = 210;
  const height = 58;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price sparkline">
      <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="guide-overlay" role="presentation" onMouseDown={onClose}>
      <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="guide-top">
          <div>
            <div className="guide-kicker">
              <BookOpen size={16} />
              Panduan MaX Screener
            </div>
            <h2 id="guide-title">Cara membaca sinyal</h2>
            <p>Ringkasan praktis dari riset MaX V7.30 agar hasil scan tidak dibaca sebagai sinyal tunggal yang berdiri sendiri.</p>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label="Tutup panduan">
            <X size={20} />
          </button>
        </div>

        <div className="guide-content">
          <section className="guide-section guide-alert">
            <div>
              <Layers3 size={20} />
            </div>
            <div>
              <h3>Prinsip utama</h3>
              <ul>
                {guidePrinciples.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="guide-section">
            <h3>Arti tiap sinyal</h3>
            <div className="guide-signal-grid">
              {guideSignals.map((signal) => {
                const color = signalColors[signal.name] ?? signalColors.HOLD;
                return (
                  <article key={signal.name} className="guide-signal-card">
                    <span className="guide-signal-pill" style={{ '--signal': color } as React.CSSProperties}>
                      {signal.name}
                    </span>
                    <strong>{signal.group}</strong>
                    <p>{signal.use}</p>
                    <small>{signal.note}</small>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="guide-section guide-usage">
            <h3>Cara pakai cepat</h3>
            <div>
              <span>1</span>
              <p>Mulai dari filter <strong>Signal Only</strong> untuk mencari saham yang punya sinyal aktif di EOD terbaru.</p>
            </div>
            <div>
              <span>2</span>
              <p>Buka detail ticker, baca <strong>Regime, RRG, RVol, Signal Age,</strong> dan <strong>Logic Notes</strong> sebelum melihat plan.</p>
            </div>
            <div>
              <span>3</span>
              <p>Untuk reversal, prioritaskan SMART SNIPER / SNIPER / EARLY di demand. Untuk momentum, cek BETA, SMART GAMMA, atau G ACC.</p>
            </div>
            <div>
              <span>4</span>
              <p>Jika muncul V-SHAPE, perlakukan sebagai sinyal agresif. Konfirmasi ulang dengan struktur harga, volume, dan risiko.</p>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function ResultCell({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <td data-label={label} className={className}>
      {children}
    </td>
  );
}

function SelectInput({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function RupiahInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="wide-input rupiah-input"
        type="text"
        inputMode="numeric"
        value={value > 0 ? formatNumber(value) : ''}
        placeholder="0"
        onChange={(event) => onChange(parseRupiahInput(event.target.value))}
      />
    </label>
  );
}

function SettingsRail({
  settings,
  onChange,
  isVisible,
  onToggle,
}: {
  settings: MaxSettings;
  onChange: (settings: MaxSettings) => void;
  isVisible: boolean;
  onToggle: () => void;
}) {
  const patch = (partial: Partial<MaxSettings>) => onChange({ ...settings, ...partial });

  return (
    <aside className={`settings-rail trading-plan-rail ${isVisible ? '' : 'is-collapsed'}`} aria-label="Trading plan settings">
      <button className="portfolio-toggle-button" type="button" onClick={onToggle} aria-expanded={isVisible} title={isVisible ? 'Hide portfolio' : 'Show portfolio'}>
        {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
        <span>{isVisible ? 'Hide Portfolio' : 'Portfolio'}</span>
      </button>
      {isVisible && (
        <div className="setting-group">
          <div className="group-heading">Trading Plan</div>
          <RupiahInput label="Modal Portfolio (Rp)" value={settings.portfolioCapital} onChange={(value) => patch({ portfolioCapital: value })} />
          <SelectInput label="Grid Strategy" value={settings.strategy} options={STRATEGY_OPTIONS} onChange={(value) => patch({ strategy: value as StrategyName })} />
        </div>
      )}
    </aside>
  );
}

function ResultsTable({ results, selectedTicker, onSelect }: { results: ScanResult[]; selectedTicker?: string; onSelect: (ticker: string) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Date</th>
            <th>Price</th>
            <th>Signal</th>
            <th>Regime</th>
            <th>RRG</th>
            <th>RVol</th>
            <th>Age</th>
            <th>Score</th>
            <th>Risk B1</th>
            <th>Risk Avg</th>
            <th>Lots</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => {
            const color = signalColors[result.signal] ?? '#8a92a6';
            const lastSignalColor = result.lastActiveSignal ? (signalColors[result.lastActiveSignal] ?? '#8a92a6') : '#8a92a6';
            const extraSignals = result.activeSignals.filter((signal) => signal !== result.signal);
            const activeSignalNote =
              result.activeSignals.length > 1
                ? `also: ${formatSignalList(extraSignals)}`
                : result.activeSignals.length === 1 && result.activeSignals[0] !== result.signal
                  ? `active: ${result.activeSignals[0]}`
                  : '';
            const noteSignal = extraSignals[0] ?? result.activeSignals[0] ?? result.signal;
            const noteColor = signalColors[noteSignal] ?? color;
            const showLastSignal = !result.activeSignal && result.lastActiveSignals.length > 0;
            return (
              <tr key={result.ticker} className={selectedTicker === result.ticker ? 'selected' : ''} onClick={() => onSelect(result.ticker)}>
                <ResultCell label="Ticker">
                  <div className="ticker-stack">
                    <span className="ticker-cell">{result.ticker}</span>
                    {result.historyQuality !== 'FULL' && <span>IPO {result.historyBars} bars</span>}
                  </div>
                </ResultCell>
                <ResultCell label="Date">{result.latestDate}</ResultCell>
                <ResultCell label="Price" className={result.changePct >= 0 ? 'pos' : 'neg'}>{formatNumber(result.price)}</ResultCell>
                <ResultCell label="Signal">
                  <div className="signal-stack">
                    <span className="signal-pill" style={{ '--signal': color } as React.CSSProperties}>
                      {result.signal}
                    </span>
                    {activeSignalNote && (
                      <span className="last-signal-note" style={{ '--last-signal': noteColor } as React.CSSProperties}>
                        {activeSignalNote}
                      </span>
                    )}
                    {showLastSignal && (
                      <span className="last-signal-note" style={{ '--last-signal': lastSignalColor } as React.CSSProperties}>
                        last: {formatSignalList(result.lastActiveSignals)}
                      </span>
                    )}
                  </div>
                </ResultCell>
                <ResultCell label="Regime">{result.regime}</ResultCell>
                <ResultCell label="RRG" className={`quad ${result.quadrant.toLowerCase()}`}>{result.quadrant}</ResultCell>
                <ResultCell label="RVol" className={result.rvol >= 2 ? 'hot' : result.rvol >= 1 ? 'pos' : ''}>{result.rvol.toFixed(2)}x</ResultCell>
                <ResultCell label="Age">
                  <div className="age-stack">
                    <strong>{formatAge(result)}</strong>
                    {result.lastActiveDate && <span>{result.lastActiveDate}</span>}
                  </div>
                </ResultCell>
                <ResultCell label="Score">{formatNumber(result.score)}</ResultCell>
                <ResultCell label="Risk B1">{result.plan ? `${result.plan.riskPct.toFixed(2)}%` : '-'}</ResultCell>
                <ResultCell label="Risk Avg">{result.plan ? `${result.plan.avgRiskPct.toFixed(2)}%` : '-'}</ResultCell>
                <ResultCell label="Lots">{result.plan ? `${formatNumber(result.plan.totalLots)}L` : '-'}</ResultCell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MiniCandleChart({
  records,
  isLoading,
  error,
}: {
  records: CleanEodRecord[];
  isLoading: boolean;
  error: string | null;
}) {
  const rows = records
    .filter((row) => row.open != null && row.high != null && row.low != null && row.close != null && row.volume != null)
    .slice(-48);
  const latest = rows.at(-1);

  if (!rows.length) {
    return (
      <section className="mini-candle-card">
        <div className="mini-candle-head">
          <span>EOD Candle / Volume</span>
          <strong>{isLoading ? 'Loading' : '-'}</strong>
        </div>
        <div className="mini-candle-empty">{error ?? (isLoading ? 'Memuat chart ticker...' : 'Belum ada data chart ticker.')}</div>
      </section>
    );
  }

  const width = 340;
  const height = 164;
  const padX = 12;
  const padTop = 12;
  const priceHeight = 96;
  const volumeGap = 12;
  const volumeHeight = 36;
  const innerWidth = width - padX * 2;
  const highs = rows.map((row) => row.high);
  const lows = rows.map((row) => row.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const priceSpan = maxHigh - minLow || 1;
  const maxVolume = Math.max(...rows.map((row) => row.volume), 1);
  const xStep = rows.length > 1 ? innerWidth / (rows.length - 1) : innerWidth;
  const bodyWidth = Math.max(3, Math.min(8, (innerWidth / rows.length) * 0.58));
  const priceY = (value: number) => padTop + (1 - (value - minLow) / priceSpan) * priceHeight;
  const volumeTop = padTop + priceHeight + volumeGap;
  const latestTone = latest && latest.close >= latest.open ? 'pos' : 'neg';

  return (
    <section className="mini-candle-card">
      <div className="mini-candle-head">
        <span>EOD Candle / Volume</span>
        <strong className={latestTone}>{latest ? `${latest.date} / ${formatCompactQty(latest.volume)}` : '-'}</strong>
      </div>
      <svg className="mini-candle-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Mini candlestick chart with volume">
        <line className="mini-candle-baseline" x1={padX} x2={width - padX} y1={volumeTop - 6} y2={volumeTop - 6} />
        {rows.map((row, index) => {
          const x = rows.length > 1 ? padX + index * xStep : padX + innerWidth / 2;
          const openY = priceY(row.open);
          const closeY = priceY(row.close);
          const highY = priceY(row.high);
          const lowY = priceY(row.low);
          const isUp = row.close >= row.open;
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(1.4, Math.abs(closeY - openY));
          const volumeBarHeight = Math.max(1, (row.volume / maxVolume) * volumeHeight);
          return (
            <g key={`${row.date}-${index}`} className={isUp ? 'mini-candle-up' : 'mini-candle-down'}>
              <line className="mini-candle-wick" x1={x} x2={x} y1={highY} y2={lowY} />
              <rect className="mini-candle-body" x={x - bodyWidth / 2} y={bodyY} width={bodyWidth} height={bodyHeight} rx="1.2" />
              <rect className="mini-volume-bar" x={x - bodyWidth / 2} y={volumeTop + volumeHeight - volumeBarHeight} width={bodyWidth} height={volumeBarHeight} rx="1" />
            </g>
          );
        })}
      </svg>
      {error && <div className="mini-candle-foot neg">{error}</div>}
    </section>
  );
}

function DetailPanel({
  result,
  impactRow,
  chartRecords,
  isChartLoading,
  chartError,
}: {
  result?: ScanResult;
  impactRow?: IhsgImpactRow;
  chartRecords: CleanEodRecord[];
  isChartLoading: boolean;
  chartError: string | null;
}) {
  if (!result) {
    if (impactRow) {
      const tone = impactRow.changePct >= 0 ? 'pos' : 'neg';
      const marketRows = [
        { label: 'IHSG Weight Est', value: formatWeightPct(impactRow.cappedWeightPct), meta: `${impactRow.source === 'KSEI_RESIDUAL' ? 'KSEI residual' : 'IDX benchmark'} / ${impactRow.confidence}` },
        { label: 'IHSG Impact', value: formatImpactPoints(impactRow.impactPoints), meta: `${formatPct(impactRow.impactPct)} index return`, tone: impactRow.impactPct >= 0 ? 'pos' : 'neg' },
        { label: 'Float Ratio', value: formatWeightPct(impactRow.floatPct), meta: impactRow.idxFreeFloatPct == null ? 'no IDX benchmark' : `IDX ${formatWeightPct(impactRow.idxFreeFloatPct)}` },
        { label: 'Free-float MCap', value: formatCompactIdr(impactRow.freeFloatMarketCap), meta: `MCap ${formatCompactIdr(impactRow.marketCap)}` },
        { label: 'Volume', value: formatCompactQty(impactRow.volume), meta: `${formatCompactIdr(impactRow.turnoverValue)} turnover` },
        { label: 'Frequency', value: impactRow.tradeFrequency == null ? '-' : formatCompactQty(impactRow.tradeFrequency), meta: `NBSA ${impactRow.nbsa == null ? '-' : formatCompactIdr(impactRow.nbsa)}` },
        { label: 'Group', value: impactRow.groupLabel, meta: impactRow.issuer },
      ];

      return (
        <aside className="detail-panel">
          <div className="detail-head">
            <div>
              <div className="detail-kicker">Market Mover</div>
              <h2>{impactRow.ticker}</h2>
            </div>
            <span className={`signal-badge ${tone}`}>{formatPct(impactRow.changePct)}</span>
          </div>

          <div className="price-block">
            <div>
              <span>Close</span>
              <strong>{formatNumber(impactRow.price)}</strong>
            </div>
            <div className={tone}>{formatPct(impactRow.changePct)}</div>
          </div>

          <MiniCandleChart records={chartRecords} isLoading={isChartLoading} error={chartError} />

          <div className="detail-section">
            <h3><Database size={16} /> Market Context</h3>
            <div className="context-grid">
              {marketRows.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong className={item.tone}>{item.value}</strong>
                  {item.meta && <small>{item.meta}</small>}
                </div>
              ))}
            </div>
          </div>
        </aside>
      );
    }

    return (
      <aside className="detail-panel empty-detail">
        <Search size={26} />
        <p>Pilih ticker dari tabel untuk melihat detail market, alasan sinyal, dan trading plan.</p>
      </aside>
    );
  }

  const color = signalColors[result.signal] ?? '#8a92a6';
  const lastSignalColor = result.lastActiveSignal ? (signalColors[result.lastActiveSignal] ?? '#8a92a6') : '#8a92a6';
  const planRows = result.plan
    ? [
        { label: 'Buy 1', value: formatNumber(result.plan.buy1), meta: `${(result.plan.weight1 * 100).toFixed(0)}% / ${formatNumber(result.plan.lot1)}L` },
        { label: 'Buy 2', value: formatNumber(result.plan.buy2), meta: `${(result.plan.weight2 * 100).toFixed(0)}% / ${formatNumber(result.plan.lot2)}L` },
        { label: 'Buy 3', value: formatNumber(result.plan.buy3), meta: `${(result.plan.weight3 * 100).toFixed(0)}% / ${formatNumber(result.plan.lot3)}L` },
        { label: 'Buy 4', value: formatNumber(result.plan.buy4), meta: `${(result.plan.weight4 * 100).toFixed(0)}% / ${formatNumber(result.plan.lot4)}L` },
        { label: 'Grid Avg', value: formatNumber(result.plan.avgEntry), meta: `${formatNumber(result.plan.totalLots)}L / ${formatIdr(result.plan.totalDeployed)}` },
        { label: 'Cash Left', value: formatIdr(result.plan.cashLeft), meta: `Modal ${formatIdr(result.plan.portfolioCapital)}` },
        { label: 'SL', value: formatNumber(result.plan.stopLoss), meta: 'Structure stop' },
        { label: 'TP1', value: formatNumber(result.plan.tp1), meta: 'Target 1' },
        { label: 'TP2', value: formatNumber(result.plan.tp2), meta: 'Smart / 3R' },
        { label: 'TP2 Fib', value: formatNumber(result.plan.tp2Fib), meta: 'Expansion 1.618' },
      ]
    : [];
  const latestVolume = result.records[result.records.length - 1]?.volume ?? 0;
  const contextRows = [
    ...(impactRow
      ? [
          { label: 'IHSG Weight Est', value: formatWeightPct(impactRow.cappedWeightPct), meta: `${impactRow.source === 'KSEI_RESIDUAL' ? 'KSEI residual' : 'IDX benchmark'} / ${impactRow.confidence}` },
          { label: 'IHSG Impact', value: formatImpactPoints(impactRow.impactPoints), meta: `${formatPct(impactRow.impactPct)} index return`, tone: impactRow.impactPct >= 0 ? 'pos' : 'neg' },
          { label: 'Float Ratio', value: formatWeightPct(impactRow.floatPct), meta: impactRow.idxFreeFloatPct == null ? 'no IDX benchmark' : `IDX ${formatWeightPct(impactRow.idxFreeFloatPct)}` },
          { label: 'Free-float MCap', value: formatCompactIdr(impactRow.freeFloatMarketCap), meta: `MCap ${formatCompactIdr(impactRow.marketCap)}` },
        ]
      : []),
    { label: 'Trend Short', value: result.trendShort, tone: result.trendShort === 'BULLISH' ? 'pos' : result.trendShort === 'BEARISH' ? 'neg' : '' },
    { label: 'Trend Medium', value: result.trendMedium, tone: result.trendMedium === 'BULLISH' ? 'pos' : result.trendMedium === 'BEARISH' ? 'neg' : '' },
    { label: 'Trend Long', value: result.trendLong, tone: result.trendLong === 'BULLISH' ? 'pos' : result.trendLong === 'BEARISH' ? 'neg' : '' },
    { label: 'Structure', value: result.structure, tone: result.structure.includes('DOWNTREND') ? 'neg' : result.structure.includes('UPTREND') ? 'pos' : '' },
    { label: 'Vol Power', value: `${result.volPower.toFixed(2)}x`, meta: result.volRegime, tone: result.volPower >= 2 ? 'hot' : result.volPower >= 1.2 ? 'pos' : '' },
    { label: 'X-Ray Power', value: `B:${result.xrayBuyPower.toFixed(0)}% S:${result.xraySellPower.toFixed(0)}%`, meta: 'candle close pressure', tone: result.xrayBuyPower >= 60 ? 'pos' : result.xraySellPower >= 60 ? 'neg' : '' },
    { label: 'Alpha Status', value: result.alphaStatus, tone: result.quadrant === 'LAGGING' ? 'neg' : result.quadrant === 'LEADING' ? 'pos' : '' },
    { label: 'DMI', value: `+${result.plusDi.toFixed(1)} / -${result.minusDi.toFixed(1)}`, meta: `ADX ${result.adx.toFixed(1)}` },
    { label: 'EMA 21 / 50 / 200', value: [result.ema21, result.ema50, result.ema200].map((item) => (item == null ? '-' : formatNumber(item))).join(' / ') },
    { label: 'Volume / SMA20', value: `${formatNumber(latestVolume)} / ${result.volumeSma20 == null ? '-' : formatNumber(result.volumeSma20)}` },
    { label: 'RISEN Score', value: result.risenScore.toFixed(1), meta: [result.risenInsideRolling ? 'inside rolling' : '', result.risenRecentUpBreak ? 'up break' : '', result.risenVolSurge ? 'vol surge' : ''].filter(Boolean).join(' / ') || 'no extra flag' },
  ];

  return (
    <aside className="detail-panel">
      <div className="detail-head">
        <div>
          <div className="detail-kicker">Selected Ticker</div>
          <h2>{result.ticker}</h2>
        </div>
        <span className="signal-badge" style={{ background: color, color: result.signal.includes('GAMMA') || result.signal === 'G ACC' ? '#111318' : '#ffffff' }}>
          {result.signal}
        </span>
      </div>

      <div className="price-block">
        <div>
          <span>Close</span>
          <strong>{formatNumber(result.price)}</strong>
        </div>
        <div className={result.changePct >= 0 ? 'pos' : 'neg'}>{formatPct(result.changePct)}</div>
      </div>

      <Sparkline values={result.sparkline} color={color} />
      <MiniCandleChart records={chartRecords} isLoading={isChartLoading} error={chartError} />

      <div className="metric-grid">
        <div>
          <span>Trend</span>
          <strong className={result.status === 'UPTREND' ? 'pos' : 'neg'}>{result.status}</strong>
        </div>
        <div>
          <span>RISEN</span>
          <strong>{result.regime}</strong>
        </div>
        <div>
          <span>RSI</span>
          <strong>{result.rsi.toFixed(1)}</strong>
        </div>
        <div>
          <span>ADX</span>
          <strong>{result.adx.toFixed(1)}</strong>
        </div>
        <div>
          <span>Current Signals</span>
          <strong>{formatSignalList(result.activeSignals)}</strong>
        </div>
        <div>
          <span>Sniper Location</span>
          <strong>{result.sniperLocation ?? result.lastSniperLocation ?? '-'}</strong>
        </div>
        <div>
          <span>Last Signal</span>
          <strong style={{ color: lastSignalColor }}>{formatSignalList(result.lastActiveSignals)}</strong>
        </div>
        <div>
          <span>Signal Age</span>
          <strong>{formatAge(result)}</strong>
        </div>
        <div>
          <span>History</span>
          <strong>{result.historyQuality === 'FULL' ? `${result.historyBars} bars` : `IPO / SHORT ${result.historyBars} bars`}</strong>
        </div>
      </div>

      <section className="detail-section">
        <h3>
          <Activity size={16} />
          MAX Context
        </h3>
        <div className="context-grid">
          {contextRows.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong className={item.tone}>{item.value}</strong>
              {item.meta && <small>{item.meta}</small>}
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h3>
          <CheckCircle2 size={16} />
          Logic Notes
        </h3>
        <ul className="reason-list">
          {result.reason.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="detail-section">
        <h3>
          <Target size={16} />
          Trading Plan
        </h3>
        {result.plan ? (
          <>
            <div className="plan-grid">
              {planRows.map(({ label, value, meta }) => (
                <div key={label} className={label === 'SL' ? 'danger-plan' : label.startsWith('TP') ? 'target-plan' : ''}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{meta}</small>
                </div>
              ))}
            </div>
            <div className="rrr-line">
              <span>Portfolio Manager</span>
              <strong>{formatNumber(result.plan.totalLots)} Lot</strong>
              <span>{formatIdr(result.plan.totalDeployed)} terpakai / {formatIdr(result.plan.cashLeft)} cash</span>
            </div>
            <div className="rrr-line">
              <span>{result.plan.strategy}</span>
              <strong>Avg Risk {result.plan.avgRiskPct.toFixed(2)}%</strong>
              <span>Buy1 Risk {result.plan.riskPct.toFixed(2)}%</span>
            </div>
            <div className="rrr-line">
              <span>Reward/Risk</span>
              <strong>{result.plan.rewardRisk.toFixed(2)}R</strong>
              <span>Avg {result.plan.avgRewardRisk.toFixed(2)}R / Upside {result.plan.upsidePct.toFixed(2)}%</span>
            </div>
          </>
        ) : (
          <p className="muted-copy">Belum ada plan aktif. Early Sweep sengaja tidak memicu grid otomatis, sama seperti script Pine.</p>
        )}
      </section>
    </aside>
  );
}

function SummaryStrip({ results, filtered }: { results: ScanResult[]; filtered: ScanResult[] }) {
  const active = results.filter((item) => item.activeSignal).length;
  const smart = results.filter((item) => item.activeSignals.some((signal) => signal === 'SMART SNIPER' || signal === 'SMART GAMMA' || signal === 'G ACC')).length;
  const risk = results.filter((item) => item.signalGroup === 'risk' || item.regime === 'CRASH / SELL-OFF').length;
  const latestDate = results.find(Boolean)?.latestDate ?? '-';

  return (
    <div className="summary-strip">
      <div>
        <Activity size={18} />
        <span>Active Signal</span>
        <strong>{active}</strong>
      </div>
      <div>
        <Zap size={18} />
        <span>Smart/G Acc</span>
        <strong>{smart}</strong>
      </div>
      <div>
        <AlertTriangle size={18} />
        <span>Risk Flag</span>
        <strong>{risk}</strong>
      </div>
      <div>
        <BarChart3 size={18} />
        <span>Displayed</span>
        <strong>{filtered.length}</strong>
      </div>
      <div>
        <Clock3 size={18} />
        <span>Latest EOD</span>
        <strong>{latestDate}</strong>
      </div>
    </div>
  );
}

function IhsgChart({ records, snapshot }: { records: CleanEodRecord[]; snapshot: IhsgIndexSnapshot | null }) {
  const chartRecords = records.slice(-90);
  const values = chartRecords.map((row) => row.close);
  const width = 760;
  const height = 180;
  const chartPadding = 16;
  const chartWidth = width - chartPadding * 2;
  const chartHeight = height - chartPadding * 2;
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;
  const chartPoints = values.map((value, index) => {
    const x = chartPadding + (index / Math.max(1, values.length - 1)) * chartWidth;
    const y = chartPadding + (1 - (value - min) / span) * chartHeight;
    return { x, y };
  });
  const points = chartPoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const lastPoint = chartPoints.at(-1);
  const baseline = height - chartPadding;
  const area = points ? `${chartPadding},${baseline} ${points} ${width - chartPadding},${baseline}` : '';
  const isNegative = Boolean(snapshot && snapshot.changePct < 0);
  const chartToneClass = isNegative ? 'is-negative' : 'is-positive';
  const areaStartColor = isNegative ? 'rgba(255, 51, 51, 0.28)' : 'rgba(0, 212, 170, 0.34)';
  const areaEndColor = isNegative ? 'rgba(255, 51, 51, 0)' : 'rgba(0, 212, 170, 0)';

  return (
    <section className={`ihsg-chart-card ${chartToneClass}`}>
      <div className="mover-card-head">
        <div>
          <div className="section-header">IHSG Pulse</div>
          <p>{snapshot ? `${snapshot.date} - Close ${formatNumber(snapshot.close, 2)} - ${formatPct(snapshot.changePct)}` : 'IHSG belum dimuat'}</p>
        </div>
        <span className={snapshot && snapshot.changePct >= 0 ? 'mover-status pos' : 'mover-status neg'}>
          {snapshot ? formatImpactPoints(snapshot.close - (snapshot.previousClose ?? snapshot.close)) : '-'}
        </span>
      </div>
      {points ? (
        <svg className={`ihsg-chart ${chartToneClass}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="IHSG chart">
          <defs>
            <linearGradient id="ihsgArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={areaStartColor} />
              <stop offset="100%" stopColor={areaEndColor} />
            </linearGradient>
          </defs>
          <path d={`M ${area} Z`} fill="url(#ihsgArea)" />
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {lastPoint && (
            <g className={`ihsg-pulse-marker ${chartToneClass}`} transform={`translate(${lastPoint.x.toFixed(2)} ${lastPoint.y.toFixed(2)})`}>
              <circle className="ihsg-pulse-ring" r="7" />
              <circle className="ihsg-pulse-dot" r="4.4" />
            </g>
          )}
        </svg>
      ) : (
        <div className="mover-empty-line">Belum ada data chart.</div>
      )}
    </section>
  );
}

function ImpactTable({
  title,
  rows,
  icon,
  selectedTicker,
  onSelect,
}: {
  title: string;
  rows: IhsgImpactRow[];
  icon: React.ReactNode;
  selectedTicker?: string;
  onSelect: (ticker: string) => void;
}) {
  return (
    <section className="mover-card">
      <div className="mover-card-head">
        <div className="section-header">
          {icon}
          {title}
        </div>
        <span className="mover-count">{rows.length}</span>
      </div>
      {rows.length ? (
        <div className="impact-list">
          {rows.map((row) => (
            <button key={row.ticker} className={`impact-row ${selectedTicker === row.ticker ? 'active' : ''}`} type="button" onClick={() => onSelect(row.ticker)}>
              <span className="impact-ticker">{row.ticker}</span>
              <span className={row.changePct >= 0 ? 'pos' : 'neg'}>{formatPct(row.changePct)}</span>
              <span>{formatWeightPct(row.cappedWeightPct)}</span>
              <strong className={row.impactPct >= 0 ? 'pos' : 'neg'}>{formatImpactPoints(row.impactPoints)}</strong>
            </button>
          ))}
        </div>
      ) : (
        <div className="mover-empty-line">Belum ada data.</div>
      )}
    </section>
  );
}

function ActivityTable({
  title,
  rows,
  metric,
  icon,
  selectedTicker,
  onSelect,
}: {
  title: string;
  rows: IhsgImpactRow[];
  metric: 'volume' | 'turnover' | 'frequency';
  icon: React.ReactNode;
  selectedTicker?: string;
  onSelect: (ticker: string) => void;
}) {
  return (
    <section className="mover-card">
      <div className="mover-card-head">
        <div className="section-header">
          {icon}
          {title}
        </div>
        <span className="mover-count">{rows.length}</span>
      </div>
      {rows.length ? (
        <div className="activity-list">
          {rows.map((row) => (
            <button key={row.ticker} className={`activity-row ${selectedTicker === row.ticker ? 'active' : ''}`} type="button" onClick={() => onSelect(row.ticker)}>
              <span className="impact-ticker">{row.ticker}</span>
              <strong>{metric === 'volume' ? formatCompactQty(row.volume) : metric === 'frequency' ? formatCompactQty(row.tradeFrequency ?? 0) : formatCompactIdr(row.turnoverValue)}</strong>
              <span className={row.changePct >= 0 ? 'pos' : 'neg'}>{formatPct(row.changePct)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mover-empty-line">Belum ada data.</div>
      )}
    </section>
  );
}

function ForeignFlowTable({
  title,
  rows,
  icon,
  date,
  note,
  selectedTicker,
  onSelect,
}: {
  title: string;
  rows: BroksumMarketRankingRecord[];
  icon: React.ReactNode;
  date?: string | null;
  note?: string | null;
  selectedTicker?: string;
  onSelect: (ticker: string) => void;
}) {
  return (
    <section className="mover-card">
      <div className="mover-card-head">
        <div>
          <div className="section-header">
            {icon}
            {title}
          </div>
          {date && <p>Broksum {date}</p>}
        </div>
        <span className="mover-count">{rows.length}</span>
      </div>
      {rows.length ? (
        <div className="activity-list">
          {rows.map((row) => (
            <button key={row.ticker} className={`activity-row ${selectedTicker === row.ticker ? 'active' : ''}`} type="button" onClick={() => onSelect(row.ticker)}>
              <span className="impact-ticker">{row.ticker}</span>
              <strong className={row.foreignNetValue >= 0 ? 'pos' : 'neg'}>{formatCompactIdr(row.foreignNetValue)}</strong>
              <span className={(row.changePercent ?? 0) >= 0 ? 'pos' : 'neg'}>{formatPct(row.changePercent ?? 0)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mover-empty-line">{note ?? 'Belum ada data broksum.'}</div>
      )}
    </section>
  );
}

function GroupPressureCard({ group }: { group: IhsgMoverGroup }) {
  const tone = group.impactPct >= 0 ? 'pos' : 'neg';
  return (
    <article className="group-pressure-card">
      <div>
        <span>{group.label}</span>
        <strong className={tone}>{formatImpactPoints(group.impactPoints)}</strong>
      </div>
      <div className="group-pressure-meta">
        <span>Weight {formatWeightPct(group.weightPct)}</span>
        <span>{formatPct(group.avgChangePct)}</span>
      </div>
      <div className="group-leaders">
        {group.leaders.map((row) => (
          <span key={row.ticker}>{row.ticker}</span>
        ))}
      </div>
    </article>
  );
}

function MoversPage({
  marketSnapshot,
  rows,
  groups,
  ihsgRecords,
  ihsgSnapshot,
  foreignBuyRows,
  foreignSellRows,
  foreignFlowDate,
  foreignFlowNote,
  isLoading,
  canScan,
  error,
  selectedTicker,
  onRefresh,
  onSelectTicker,
}: {
  marketSnapshot: MarketSnapshot | null;
  rows: IhsgImpactRow[];
  groups: IhsgMoverGroup[];
  ihsgRecords: CleanEodRecord[];
  ihsgSnapshot: IhsgIndexSnapshot | null;
  foreignBuyRows: BroksumMarketRankingRecord[];
  foreignSellRows: BroksumMarketRankingRecord[];
  foreignFlowDate: string | null;
  foreignFlowNote: string | null;
  isLoading: boolean;
  canScan: boolean;
  error: string | null;
  selectedTicker?: string;
  onRefresh: () => void;
  onSelectTicker: (ticker: string) => void;
}) {
  const meta = getIhsgFloatMeta();
  const decliners = rows.filter((row) => row.impactPct < 0).sort((a, b) => a.impactPct - b.impactPct).slice(0, 10);
  const lifters = rows.filter((row) => row.impactPct > 0).sort((a, b) => b.impactPct - a.impactPct).slice(0, 10);
  const topGainers = [...rows].sort((a, b) => b.changePct - a.changePct).slice(0, 8);
  const topLosers = [...rows].sort((a, b) => a.changePct - b.changePct).slice(0, 8);
  const topVolume = [...rows].sort((a, b) => b.volume - a.volume).slice(0, 8);
  const topTurnover = [...rows].sort((a, b) => b.turnoverValue - a.turnoverValue).slice(0, 8);
  const topFrequency = [...rows].sort((a, b) => (b.tradeFrequency ?? 0) - (a.tradeFrequency ?? 0)).slice(0, 8);
  const driftRows = rows
    .filter((row) => row.confidence === 'LOW' || Math.abs(row.driftPct ?? 0) >= 12)
    .sort((a, b) => Math.abs(b.driftPct ?? 0) - Math.abs(a.driftPct ?? 0))
    .slice(0, 8);
  const totalPressure = decliners.reduce((sum, row) => sum + (row.impactPoints ?? 0), 0);
  const totalSupport = lifters.reduce((sum, row) => sum + (row.impactPoints ?? 0), 0);
  const estimatedCoverage = rows.reduce((sum, row) => sum + row.cappedWeightPct, 0);

  if (!marketSnapshot) {
    return (
      <section className="movers-page">
        <IhsgChart records={ihsgRecords} snapshot={ihsgSnapshot} />
        {error && (
          <div className="error-box">
            <strong>Market movers gagal dimuat</strong>
            <p>{error}</p>
          </div>
        )}
        <div className="movers-empty-state">
          <LineChart size={32} />
          <h2>{isLoading ? 'Memuat market movers' : 'Movers belum dimuat'}</h2>
          <p>Dashboard ini membaca EOD market terbaru, bobot KSEI residual, impact IHSG, value, volume, frequency, dan foreign flow tanpa memakai hasil scanner.</p>
          <button className="primary-button" type="button" onClick={onRefresh} disabled={!canScan || isLoading}>
            <RefreshCw size={18} />
            {isLoading ? 'Loading' : 'Muat Movers'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="movers-page">
      <IhsgChart records={ihsgRecords} snapshot={ihsgSnapshot} />

      <div className="mover-summary-grid">
        <div>
          <AlertTriangle size={18} />
          <span>Pressure</span>
          <strong className="neg">{formatImpactPoints(totalPressure)}</strong>
        </div>
        <div>
          <TrendingUp size={18} />
          <span>Support</span>
          <strong className="pos">{formatImpactPoints(totalSupport)}</strong>
        </div>
        <div>
          <Database size={18} />
          <span>Market Value</span>
          <strong>{formatCompactIdr(marketSnapshot.totalTradeValue)}</strong>
        </div>
        <div>
          <Clock3 size={18} />
          <span>Market Breadth</span>
          <strong>{marketSnapshot.gainers}/{marketSnapshot.losers}</strong>
        </div>
      </div>

      <div className="mover-source-note">
        EOD market {marketSnapshot.date} - {marketSnapshot.totalTickers} tickers - weight coverage {formatWeightPct(estimatedCoverage)} - KSEI residual snapshot {meta.kseiSnapshotDate ?? '-'} - IDX benchmark {meta.benchmarkReportPeriod ?? '-'} - cap 9%
      </div>

      <div className="mover-grid">
        <ImpactTable title="Pemberat IHSG" rows={decliners} icon={<ArrowDownRight size={16} />} selectedTicker={selectedTicker} onSelect={onSelectTicker} />
        <ImpactTable title="Penopang IHSG" rows={lifters} icon={<ArrowUpRight size={16} />} selectedTicker={selectedTicker} onSelect={onSelectTicker} />
        <ImpactTable title="Top Gainer" rows={topGainers} icon={<TrendingUp size={16} />} selectedTicker={selectedTicker} onSelect={onSelectTicker} />
        <ImpactTable title="Top Loser" rows={topLosers} icon={<ArrowDownRight size={16} />} selectedTicker={selectedTicker} onSelect={onSelectTicker} />
        <ActivityTable title="Top Volume" rows={topVolume} metric="volume" icon={<BarChart3 size={16} />} selectedTicker={selectedTicker} onSelect={onSelectTicker} />
        <ActivityTable title="Top Turnover" rows={topTurnover} metric="turnover" icon={<Database size={16} />} selectedTicker={selectedTicker} onSelect={onSelectTicker} />
        <ActivityTable title="Top Frequency" rows={topFrequency} metric="frequency" icon={<Activity size={16} />} selectedTicker={selectedTicker} onSelect={onSelectTicker} />
        <ForeignFlowTable title="Net Foreign Buy" rows={foreignBuyRows} date={foreignFlowDate} note={foreignFlowNote} icon={<ArrowUpRight size={16} />} selectedTicker={selectedTicker} onSelect={onSelectTicker} />
        <ForeignFlowTable title="Net Foreign Sell" rows={foreignSellRows} date={foreignFlowDate} note={foreignFlowNote} icon={<ArrowDownRight size={16} />} selectedTicker={selectedTicker} onSelect={onSelectTicker} />
      </div>

      <section className="mover-card wide-mover-card">
        <div className="mover-card-head">
          <div className="section-header">
            <BarChart3 size={16} />
            Group Pressure
          </div>
          <span className="mover-count">{groups.length}</span>
        </div>
        <div className="group-pressure-grid">
          {groups.slice(0, 8).map((group) => (
            <GroupPressureCard key={group.id} group={group} />
          ))}
        </div>
      </section>

      <ImpactTable title="Float Drift Watch" rows={driftRows} icon={<Database size={16} />} selectedTicker={selectedTicker} onSelect={onSelectTicker} />
    </section>
  );
}

export function App() {
  const [settings, setSettings] = useState<MaxSettings>(DEFAULT_SETTINGS);
  const [activePage, setActivePage] = useState<PageMode>('movers');
  const [universeMode, setUniverseMode] = useState<UniverseMode>('all-idx');
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const [filter, setFilter] = useState<FilterMode>('signals');
  const [indexFilter, setIndexFilter] = useState<IndexFilterMode>('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScanResult[]>([]);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [ihsgHistory, setIhsgHistory] = useState<CleanEodRecord[]>([]);
  const [foreignBuyRows, setForeignBuyRows] = useState<BroksumMarketRankingRecord[]>([]);
  const [foreignSellRows, setForeignSellRows] = useState<BroksumMarketRankingRecord[]>([]);
  const [foreignFlowDate, setForeignFlowDate] = useState<string | null>(null);
  const [foreignFlowNote, setForeignFlowNote] = useState<string | null>(null);
  const [detailHistoryRecords, setDetailHistoryRecords] = useState<CleanEodRecord[]>([]);
  const [isDetailHistoryLoading, setIsDetailHistoryLoading] = useState(false);
  const [detailHistoryError, setDetailHistoryError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [moversError, setMoversError] = useState<string | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | undefined>();
  const [isScanning, setIsScanning] = useState(false);
  const [isLoadingMovers, setIsLoadingMovers] = useState(false);
  const [moversLoaded, setMoversLoaded] = useState(false);
  const [isPortfolioVisible, setIsPortfolioVisible] = useState(true);
  const [isGuideOpen, setIsGuideOpen] = useState(() => new URLSearchParams(window.location.search).get('guide') === '1');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const moversAbortRef = useRef<AbortController | null>(null);
  const deferredQuery = useDeferredValue(query);

  const activeIndexMeta = useMemo(() => getIndexFilterMeta(indexFilter), [indexFilter]);
  const activeIndexCount = useMemo(() => getIndexConstituentCount(indexFilter), [indexFilter]);
  const activeIndexMembers = useMemo(() => getIndexMemberSet(indexFilter), [indexFilter]);
  const latestEod = results.find(Boolean)?.latestDate ?? '-';
  const visibleLatestEod = activePage === 'movers' ? marketSnapshot?.date ?? '-' : latestEod;
  const activeSignalCount = results.filter((item) => item.activeSignal).length;
  const ihsgSnapshot = useMemo(() => getIhsgIndexSnapshot(ihsgHistory), [ihsgHistory]);
  const scannerImpactRows = useMemo(
    () => buildIhsgImpactRows(results, { ihsgPreviousClose: ihsgSnapshot?.previousClose ?? null }),
    [ihsgSnapshot?.previousClose, results],
  );
  const marketImpactRows = useMemo(
    () => buildIhsgImpactRowsFromMarket(marketSnapshot?.records ?? [], { ihsgPreviousClose: ihsgSnapshot?.previousClose ?? null }),
    [ihsgSnapshot?.previousClose, marketSnapshot?.records],
  );
  const ihsgMoverGroups = useMemo(() => buildIhsgMoverGroups(marketImpactRows), [marketImpactRows]);

  const indexFilteredResults = useMemo(() => {
    if (!activeIndexMembers) return results;
    return results.filter((item) => activeIndexMembers.has(item.ticker));
  }, [activeIndexMembers, results]);

  const filteredResults = useMemo(() => {
    const needle = deferredQuery.trim().toUpperCase();
    return indexFilteredResults
      .filter((item) => resultMatchesFilter(item, filter))
      .filter((item) => (needle ? item.ticker.includes(needle) || item.signal.includes(needle) : true))
      .sort((a, b) => b.score - a.score);
  }, [deferredQuery, filter, indexFilteredResults]);

  const selected = useMemo(() => {
    if (activePage === 'movers') {
      return selectedTicker ? results.find((item) => item.ticker === selectedTicker) : undefined;
    }
    return results.find((item) => item.ticker === selectedTicker) ?? filteredResults[0] ?? results[0];
  }, [activePage, filteredResults, results, selectedTicker]);
  const selectedImpactRow = useMemo(() => {
    const ticker = selectedTicker ?? selected?.ticker;
    if (!ticker) return undefined;
    const sourceRows = activePage === 'movers' ? marketImpactRows : scannerImpactRows;
    return sourceRows.find((row) => row.ticker === ticker);
  }, [activePage, marketImpactRows, scannerImpactRows, selected?.ticker, selectedTicker]);
  const detailTicker = selectedTicker ?? selected?.ticker ?? selectedImpactRow?.ticker;
  const selectedHasDetailRecords = Boolean(selected && detailTicker === selected.ticker && selected.records.length);
  const detailChartRecords = selectedHasDetailRecords ? selected?.records ?? [] : detailHistoryRecords;

  const selectedUniverse = useMemo(() => {
    return universeMode === 'all-idx' ? IDX_UNIVERSE : parseWatchlist(watchlist);
  }, [universeMode, watchlist]);

  const visibleUniverseCount = activePage === 'movers' ? marketSnapshot?.totalTickers ?? IDX_UNIVERSE_COUNT : selectedUniverse.length;
  const canScan = !isScanning && selectedUniverse.length > 0;

  useEffect(() => {
    if (activePage === 'movers' && !moversLoaded && !isLoadingMovers) {
      void loadMarketMovers();
    }
  }, [activePage, isLoadingMovers, moversLoaded]);

  useEffect(() => {
    if (!detailTicker || selectedHasDetailRecords) {
      setDetailHistoryRecords([]);
      setIsDetailHistoryLoading(false);
      setDetailHistoryError(null);
      return;
    }

    const controller = new AbortController();
    setIsDetailHistoryLoading(true);
    setDetailHistoryError(null);

    fetchTickerHistory(detailTicker, settings.startDate, controller.signal)
      .then((history) => {
        if (controller.signal.aborted) return;
        setDetailHistoryRecords(history.records);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setDetailHistoryRecords([]);
        setDetailHistoryError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsDetailHistoryLoading(false);
      });

    return () => controller.abort();
  }, [detailTicker, selectedHasDetailRecords, settings.startDate]);

  async function loadMarketMovers() {
    moversAbortRef.current?.abort();
    const controller = new AbortController();
    moversAbortRef.current = controller;
    setIsLoadingMovers(true);
    setMoversError(null);
    setForeignFlowDate(null);
    setForeignFlowNote(null);

    try {
      const [market, ihsgRecords] = await Promise.all([
        fetchMarketSnapshot(undefined, controller.signal),
        fetchIhsgHistory(settings.startDate, controller.signal).catch(() => []),
      ]);
      if (controller.signal.aborted) return;

      setMarketSnapshot(market);
      setMoversLoaded(true);
      if (ihsgRecords.length) setIhsgHistory(ihsgRecords);

      const loadForeignFlows = async (date?: string) => {
        const [foreignBuy, foreignSell] = await Promise.allSettled([
          fetchBroksumMarketRanking('net_foreign_buy', date, 12, controller.signal),
          fetchBroksumMarketRanking('net_foreign_sell', date, 12, controller.signal),
        ]);
        const buyPayload = foreignBuy.status === 'fulfilled' ? foreignBuy.value : null;
        const sellPayload = foreignSell.status === 'fulfilled' ? foreignSell.value : null;
        const errors = [foreignBuy, foreignSell]
          .flatMap((item) => (item.status === 'rejected' ? [item.reason] : []))
          .map((reason) => (reason instanceof Error ? reason.message : String(reason)));

        return {
          date: buyPayload?.date ?? sellPayload?.date ?? date ?? null,
          buyRows: buyPayload?.records ?? [],
          sellRows: sellPayload?.records ?? [],
          errors,
        };
      };

      let foreignFlow = await loadForeignFlows(market.date);
      if (controller.signal.aborted) return;

      setForeignBuyRows(foreignFlow.buyRows);
      setForeignSellRows(foreignFlow.sellRows);
      setForeignFlowDate(foreignFlow.date);
      setForeignFlowNote(
        foreignFlow.buyRows.length || foreignFlow.sellRows.length
          ? foreignFlow.date && foreignFlow.date !== market.date
            ? `Memakai broksum ${foreignFlow.date}; EOD market ${market.date}.`
            : null
          : foreignFlow.errors[0] ?? `Belum ada data broksum net foreign untuk ${market.date}.`,
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setMoversLoaded(true);
        setMarketSnapshot(null);
        setForeignBuyRows([]);
        setForeignSellRows([]);
        setForeignFlowDate(null);
        setForeignFlowNote(null);
        setMoversError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (!controller.signal.aborted) setIsLoadingMovers(false);
    }
  }

  async function runScan() {
    const tickers = selectedUniverse;
    if (!tickers.length) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsScanning(true);
    setProgress({ done: 0, total: tickers.length });
    setErrors([]);
    setResults([]);
    setIhsgHistory([]);
    setSelectedTicker(undefined);

    const nextResults: ScanResult[] = [];
    try {
      const benchmark = await fetchIhsgHistory(settings.startDate, controller.signal).catch(() => []);
      setIhsgHistory(benchmark);
      const concurrency = universeMode === 'all-idx' ? 8 : 5;
      for (let i = 0; i < tickers.length; i += concurrency) {
        const batch = tickers.slice(i, i + concurrency);
        const batchResults: Array<ScanResult | null> = await Promise.all(
          batch.map(async (ticker) => {
            try {
              const history = await fetchTickerHistory(ticker, settings.startDate, controller.signal);
              const analysis = analyzeTicker(ticker, history.records, settings, benchmark);
              const result: ScanResult = { ...analysis, latestAvailableDate: history.latestAvailableDate ?? null };
              return result;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              setErrors((current) => [...current, `${ticker}: ${message}`]);
              return null;
            }
          }),
        );
        nextResults.push(...batchResults.filter((item): item is ScanResult => item != null));
        nextResults.sort((a, b) => b.score - a.score);
        setResults([...nextResults]);
        setProgress({ done: Math.min(i + concurrency, tickers.length), total: tickers.length });
      }
    } finally {
      if (!controller.signal.aborted) setIsScanning(false);
    }
  }

  function cancelScan() {
    abortRef.current?.abort();
    setIsScanning(false);
  }

  function exportCsv() {
    const latestExportDate = getMaxScreenerExportDate(filteredResults);
    const csv = buildMaxScreenerCsv(filteredResults);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `max-screener-${latestExportDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportMoversCsv() {
    if (!marketImpactRows.length) return;
    const csv = buildMoversCsv(marketImpactRows, foreignBuyRows, foreignSellRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `max-market-movers-${marketSnapshot?.date ?? 'latest'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleExport() {
    if (activePage === 'movers') {
      exportMoversCsv();
      return;
    }
    exportCsv();
  }

  const exportDisabled = activePage === 'movers' ? !marketImpactRows.length : !filteredResults.length;
  const statusClass = activePage === 'movers'
    ? isLoadingMovers ? 'scanning' : marketSnapshot ? 'active' : ''
    : isScanning ? 'scanning' : results.length ? 'active' : '';
  const statusText = activePage === 'movers'
    ? isLoadingMovers ? 'LOADING MARKET' : marketSnapshot ? `${marketImpactRows.length} MOVERS` : 'STANDBY'
    : isScanning ? `SCANNING ${progress.done}/${progress.total}` : results.length ? `${filteredResults.length} DISPLAYED` : 'STANDBY';
  const primaryAction = activePage === 'movers'
    ? { label: isLoadingMovers ? 'Loading' : 'Refresh Movers', icon: <RefreshCw size={18} />, onClick: loadMarketMovers, disabled: isLoadingMovers }
    : { label: 'Scan Sekarang', icon: <Play size={18} />, onClick: runScan, disabled: !canScan };

  return (
    <div className={`app-shell ${isPortfolioVisible ? '' : 'portfolio-collapsed'}`}>
      <SettingsRail settings={settings} onChange={setSettings} isVisible={isPortfolioVisible} onToggle={() => setIsPortfolioVisible((value) => !value)} />

      <main className="scanner-main">
        <header className="topbar">
          <div className="topbar-copy">
            <div className="brand-label">MAX V7.30 - SIGNAL INTELLIGENCE ENGINE</div>
            <div className="app-title">
              <Gauge size={22} />
              <h1>MaX Signal Screener</h1>
            </div>
            <p>IDX EOD scanner untuk membaca momentum, reversal, breakout, risk flag, dan trading plan.</p>
            <div className="context-bar">
              <span className="ctx">Latest EOD: <strong>{visibleLatestEod}</strong></span>
              <span className="ctx">Universe: <strong>{visibleUniverseCount}</strong></span>
              <span className="ctx">Signals: <strong>{activeSignalCount}</strong></span>
              <span className="ctx">Index: <strong>{activeIndexMeta.label}</strong></span>
            </div>
            <nav className="view-tabs" aria-label="MaX page tabs">
              <button className={activePage === 'movers' ? 'active' : ''} type="button" onClick={() => setActivePage('movers')}>
                <LineChart size={16} />
                Movers
              </button>
              <button className={activePage === 'scanner' ? 'active' : ''} type="button" onClick={() => setActivePage('scanner')}>
                <Gauge size={16} />
                Scanner
              </button>
            </nav>
          </div>
          <div className="top-actions">
            <div className={`regime-badge ${statusClass}`}>
              {statusText}
            </div>
            <button className="icon-button" type="button" onClick={handleExport} disabled={exportDisabled} title="Export CSV">
              <Download size={18} />
            </button>
            <button className="guide-button" type="button" onClick={() => setIsGuideOpen(true)}>
              <HelpCircle size={18} />
              <span>Panduan</span>
            </button>
            <a className="support-button" href="https://saweria.co/maxlong" target="_blank" rel="noreferrer">
              <Heart size={18} />
              <span>Support Me</span>
            </a>
            {isScanning ? (
              <button className="danger-button" type="button" onClick={cancelScan}>
                <StopCircle size={18} />
                Stop
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
                {primaryAction.icon}
                {primaryAction.label}
              </button>
            )}
          </div>
        </header>

        {activePage === 'movers' ? (
          <MoversPage
            marketSnapshot={marketSnapshot}
            rows={marketImpactRows}
            groups={ihsgMoverGroups}
            ihsgRecords={ihsgHistory}
            ihsgSnapshot={ihsgSnapshot}
            foreignBuyRows={foreignBuyRows}
            foreignSellRows={foreignSellRows}
            foreignFlowDate={foreignFlowDate}
            foreignFlowNote={foreignFlowNote}
            isLoading={isLoadingMovers}
            canScan={!isLoadingMovers}
            error={moversError}
            selectedTicker={selectedTicker}
            onRefresh={loadMarketMovers}
            onSelectTicker={setSelectedTicker}
          />
        ) : (
          <>
        <section className="control-band">
          <div className="section-header control-header">Scan Control Deck</div>
          <label className="watchlist-box">
            <span>Universe</span>
            <div className="universe-switch">
              <button className={universeMode === 'all-idx' ? 'active' : ''} type="button" onClick={() => setUniverseMode('all-idx')}>
                All IDX
                <strong>{IDX_UNIVERSE_COUNT}</strong>
              </button>
              <button className={universeMode === 'custom' ? 'active' : ''} type="button" onClick={() => setUniverseMode('custom')}>
                Custom
                <strong>{parseWatchlist(watchlist).length}</strong>
              </button>
            </div>
            <textarea
              value={watchlist}
              onChange={(event) => setWatchlist(event.target.value)}
              disabled={universeMode === 'all-idx'}
              aria-label="Custom watchlist"
            />
            <small>
              {universeMode === 'all-idx'
                ? `Mode All IDX aktif. App akan scan ${IDX_UNIVERSE_COUNT} ticker dari universe IDX bawaan.`
                : 'Mode custom aktif. Isi ticker dipisah koma, spasi, atau baris baru.'}
            </small>
          </label>
          <div className="scan-tools">
            <label className="search-box">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari ticker / signal" />
            </label>
            <div className="filter-chips" aria-label="Filter results">
              {[
                ['signals', 'Signal Only'],
                ['all', 'All'],
                ['reversal', 'Reversal'],
                ['momentum', 'Momentum'],
                ['breakout', 'Breakout'],
                ['risk', 'Risk'],
              ].map(([value, label]) => (
                <button key={value} className={filter === value ? 'active' : ''} type="button" onClick={() => setFilter(value as FilterMode)}>
                  {label}
                </button>
              ))}
            </div>
            <label className="index-filter-box">
              <span>Filter Index</span>
              <select value={indexFilter} onChange={(event) => setIndexFilter(event.target.value as IndexFilterMode)}>
                {INDEX_FILTER_OPTIONS.map((option) => {
                  const count = getIndexConstituentCount(option.value);
                  return (
                    <option key={option.value} value={option.value}>
                      {option.label}
                      {count ? ` (${count})` : ''}
                    </option>
                  );
                })}
              </select>
              <small>
                {indexFilter === 'all'
                  ? 'Tidak membatasi indeks. Semua hasil scan tetap mengikuti filter sinyal di atas.'
                  : `${activeIndexMeta.description} Muncul ${indexFilteredResults.length}${activeIndexCount ? `/${activeIndexCount}` : ''} ticker dari hasil scan.`}
              </small>
            </label>
          </div>
        </section>

        <SummaryStrip results={results} filtered={filteredResults} />

        {isScanning && (
          <div className="scan-progress">
            <RefreshCw size={18} />
            <span>
              Scanning {progress.done}/{progress.total} ticker
            </span>
            <div className="progress-track">
              <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {!!errors.length && (
          <details className="error-box">
            <summary>
              <AlertTriangle size={16} />
              {errors.length} ticker gagal diproses
            </summary>
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </details>
        )}

        <section className="scanner-card">
          <div className="section-head">
            <div>
              <div className="section-header">Signal Intelligence Board</div>
              <p>
                {filter === 'signals' ? 'Hanya saham dengan sinyal aktif di candle terbaru.' : 'Mode tampilan mengikuti filter aktif.'}
                {indexFilter !== 'all' ? ` Filter indeks: ${activeIndexMeta.label}.` : ''}
              </p>
            </div>
            <div className="signal-legend">
              {signalLabels.slice(0, 5).map((signal) => (
                <span key={signal} style={{ '--signal': signalColors[signal] } as React.CSSProperties}>
                  {signal}
                </span>
              ))}
            </div>
          </div>

          {filteredResults.length ? (
            <ResultsTable results={filteredResults} selectedTicker={selected?.ticker} onSelect={setSelectedTicker} />
          ) : (
            <div className="empty-state">
              <SlidersHorizontal size={30} />
              <h3>{results.length ? 'Tidak ada hasil pada filter ini' : 'Belum ada hasil scan'}</h3>
              <p>Tekan Scan Sekarang untuk mengambil data EOD dan menghitung sinyal dengan setting MaX kamu.</p>
              <button className="secondary-button" type="button" onClick={runScan} disabled={!canScan}>
                Mulai Scan
                <ChevronRight size={17} />
              </button>
            </div>
          )}
        </section>
          </>
        )}
      </main>

      <DetailPanel result={selected} impactRow={selectedImpactRow} chartRecords={detailChartRecords} isChartLoading={isDetailHistoryLoading} chartError={detailHistoryError} />
      {isGuideOpen && <GuideModal onClose={() => setIsGuideOpen(false)} />}
    </div>
  );
}
