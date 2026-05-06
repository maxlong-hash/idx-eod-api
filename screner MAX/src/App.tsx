import { Activity, AlertTriangle, BarChart3, BookOpen, CheckCircle2, ChevronRight, Clock3, Download, Filter, Gauge, Heart, HelpCircle, Layers3, Play, RefreshCw, Search, Settings2, Shield, SlidersHorizontal, StopCircle, Target, TrendingUp, X, Zap } from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { fetchIhsgHistory, fetchTickerHistory, parseWatchlist } from './lib/api';
import { IDX_UNIVERSE, IDX_UNIVERSE_COUNT } from './lib/idxUniverse';
import { analyzeTicker, DEFAULT_SETTINGS, DEFAULT_WATCHLIST, STRATEGY_OPTIONS } from './lib/maxEngine';
import type { MaxSettings, ScanResult, SignalName, StrategyName } from './lib/types';

type FilterMode = 'signals' | 'all' | 'reversal' | 'momentum' | 'breakout' | 'risk';
type UniverseMode = 'all-idx' | 'custom';

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

function parseRupiahInput(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

function formatPct(value: number) {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
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

function ToggleRow({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (value: boolean) => void; icon?: React.ReactNode }) {
  return (
    <label className="toggle-row">
      <span className="toggle-label">
        {icon}
        {label}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
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

function NumericInput({ label, value, onChange, step = 1, min, wide = false }: { label: string; value: number; onChange: (value: number) => void; step?: number; min?: number; wide?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className={wide ? 'wide-input' : undefined}
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
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

function SettingsRail({ settings, onChange }: { settings: MaxSettings; onChange: (settings: MaxSettings) => void }) {
  const patch = (partial: Partial<MaxSettings>) => onChange({ ...settings, ...partial });

  return (
    <aside className="settings-rail">
      <div className="rail-title">
        <Settings2 size={18} />
        <span>MaX Logic</span>
      </div>

      <div className="setting-group">
        <div className="group-heading">Strategy Logic</div>
        <ToggleRow label="Wajib FVG/Imbalance" checked={settings.useFvgFilter} onChange={(value) => patch({ useFvgFilter: value })} />
        <ToggleRow label="Lepas Safety Gamma" checked={settings.gammaAggressive} onChange={(value) => patch({ gammaAggressive: value })} icon={<Zap size={15} />} />
        <ToggleRow label="Anti-Crash ADX" checked={settings.useCrashFilter} onChange={(value) => patch({ useCrashFilter: value })} icon={<Shield size={15} />} />
        <NumericInput label="Periode Demand" value={settings.lookbackLen} min={50} onChange={(value) => patch({ lookbackLen: value })} />
        <NumericInput label="V-Shape Vol Factor" value={settings.vVolFactor} step={0.1} min={1} onChange={(value) => patch({ vVolFactor: value })} />
        <NumericInput label="Batas Crash ADX" value={settings.adxLimit} min={20} onChange={(value) => patch({ adxLimit: value })} />
        <NumericInput label="Pivot Left" value={settings.pivotLeft} min={2} onChange={(value) => patch({ pivotLeft: value })} />
        <NumericInput label="Pivot Right" value={settings.pivotRight} min={1} onChange={(value) => patch({ pivotRight: value })} />
        <ToggleRow label="Filter jika Lagging" checked={settings.useQuadFilter} onChange={(value) => patch({ useQuadFilter: value })} icon={<Filter size={15} />} />
      </div>

      <div className="setting-group">
        <div className="group-heading">Trading Plan</div>
        <RupiahInput label="Modal Portfolio (Rp)" value={settings.portfolioCapital} onChange={(value) => patch({ portfolioCapital: value })} />
        <SelectInput label="Grid Strategy" value={settings.strategy} options={STRATEGY_OPTIONS} onChange={(value) => patch({ strategy: value as StrategyName })} />
      </div>

      <div className="setting-group">
        <div className="group-heading">RISEN</div>
        <ToggleRow label="Show RISEN Features" checked={settings.showRisen} onChange={(value) => patch({ showRisen: value })} />
        <NumericInput label="Explosive/Crash %" value={settings.risenThresholdPct} step={0.1} min={0} onChange={(value) => patch({ risenThresholdPct: value })} />
        <NumericInput label="Breakout Lookback" value={settings.risenLookback} min={1} onChange={(value) => patch({ risenLookback: value })} />
        <NumericInput label="Vol Mult vs SMA15" value={settings.risenVolumeMultiplier} step={0.1} min={0} onChange={(value) => patch({ risenVolumeMultiplier: value })} />
        <ToggleRow label="Use Scored Consolidation" checked={settings.risenUseScored} onChange={(value) => patch({ risenUseScored: value })} />
      </div>

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

function DetailPanel({ result }: { result?: ScanResult }) {
  if (!result) {
    return (
      <aside className="detail-panel empty-detail">
        <Search size={26} />
        <p>Pilih ticker dari tabel untuk melihat alasan sinyal dan trading plan.</p>
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

export function App() {
  const [settings, setSettings] = useState<MaxSettings>(DEFAULT_SETTINGS);
  const [universeMode, setUniverseMode] = useState<UniverseMode>('all-idx');
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const [filter, setFilter] = useState<FilterMode>('signals');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScanResult[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string | undefined>();
  const [isScanning, setIsScanning] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(() => new URLSearchParams(window.location.search).get('guide') === '1');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const deferredQuery = useDeferredValue(query);

  const filteredResults = useMemo(() => {
    const needle = deferredQuery.trim().toUpperCase();
    return results
      .filter((item) => resultMatchesFilter(item, filter))
      .filter((item) => (needle ? item.ticker.includes(needle) || item.signal.includes(needle) : true))
      .sort((a, b) => b.score - a.score);
  }, [deferredQuery, filter, results]);

  const selected = useMemo(() => {
    return results.find((item) => item.ticker === selectedTicker) ?? filteredResults[0] ?? results[0];
  }, [filteredResults, results, selectedTicker]);

  const selectedUniverse = useMemo(() => {
    return universeMode === 'all-idx' ? IDX_UNIVERSE : parseWatchlist(watchlist);
  }, [universeMode, watchlist]);

  const canScan = !isScanning && selectedUniverse.length > 0;

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
    setSelectedTicker(undefined);

    const nextResults: ScanResult[] = [];
    try {
      const benchmark = await fetchIhsgHistory(settings.startDate, controller.signal).catch(() => []);
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
    const rows = [
      ['Ticker', 'Date', 'HistoryBars', 'HistoryQuality', 'Price', 'ChangePct', 'Signal', 'ActiveSignals', 'SniperLocation', 'LastActiveSignals', 'LastActiveDate', 'LastSniperLocation', 'Regime', 'Quadrant', 'RVol', 'AgeDays', 'Score', 'Strategy', 'PortfolioCapital', 'Buy1', 'Buy2', 'Buy3', 'Buy4', 'Weight1', 'Weight2', 'Weight3', 'Weight4', 'Lot1', 'Lot2', 'Lot3', 'Lot4', 'TotalLots', 'TotalDeployed', 'CashLeft', 'AvgEntry', 'TheoreticalAvgEntry', 'RiskBuy1Pct', 'RiskAvgPct', 'RewardRiskBuy1', 'RewardRiskAvg'],
      ...filteredResults.map((item) => [
        item.ticker,
        item.latestDate,
        item.historyBars,
        item.historyQuality,
        item.price,
        item.changePct,
        item.signal,
        formatSignalList(item.activeSignals),
        item.sniperLocation ?? '',
        formatSignalList(item.lastActiveSignals),
        item.lastActiveDate ?? '',
        item.lastSniperLocation ?? '',
        item.regime,
        item.quadrant,
        item.rvol,
        item.ageDays < 999 ? item.ageDays : '',
        item.score,
        item.plan?.strategy ?? '',
        item.plan?.portfolioCapital ?? '',
        item.plan?.buy1 ?? '',
        item.plan?.buy2 ?? '',
        item.plan?.buy3 ?? '',
        item.plan?.buy4 ?? '',
        item.plan?.weight1 ?? '',
        item.plan?.weight2 ?? '',
        item.plan?.weight3 ?? '',
        item.plan?.weight4 ?? '',
        item.plan?.lot1 ?? '',
        item.plan?.lot2 ?? '',
        item.plan?.lot3 ?? '',
        item.plan?.lot4 ?? '',
        item.plan?.totalLots ?? '',
        item.plan?.totalDeployed ?? '',
        item.plan?.cashLeft ?? '',
        item.plan?.avgEntry ?? '',
        item.plan?.theoreticalAvgEntry ?? '',
        item.plan?.riskPct ?? '',
        item.plan?.avgRiskPct ?? '',
        item.plan?.rewardRisk ?? '',
        item.plan?.avgRewardRisk ?? '',
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `max-screener-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <SettingsRail settings={settings} onChange={setSettings} />

      <main className="scanner-main">
        <header className="topbar">
          <div>
            <div className="app-title">
              <Gauge size={22} />
              <h1>MaX Signal Screener</h1>
            </div>
            <p>Scan seluruh IDX untuk sinyal Sniper, Beta, Smart Gamma, G Acc, V-Shape, dan Early Sweep.</p>
          </div>
          <div className="top-actions">
            <button className="icon-button" type="button" onClick={exportCsv} disabled={!filteredResults.length} title="Export CSV">
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
              <button className="primary-button" type="button" onClick={runScan} disabled={!canScan}>
                <Play size={18} />
                Scan Sekarang
              </button>
            )}
          </div>
        </header>

        <section className="control-band">
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
              <h2>Scanner Results</h2>
              <p>{filter === 'signals' ? 'Hanya saham dengan sinyal aktif di candle terbaru.' : 'Mode tampilan mengikuti filter aktif.'}</p>
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
      </main>

      <DetailPanel result={selected} />
      {isGuideOpen && <GuideModal onClose={() => setIsGuideOpen(false)} />}
    </div>
  );
}
