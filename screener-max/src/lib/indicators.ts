export type MaybeNumber = number | null;

export function sma(values: number[], length: number): MaybeNumber[] {
  const out: MaybeNumber[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

export function ema(values: number[], length: number): MaybeNumber[] {
  const out: MaybeNumber[] = Array(values.length).fill(null);
  if (!values.length) return out;
  const alpha = 2 / (length + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i += 1) {
    prev = values[i] * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

export function rma(values: number[], length: number): MaybeNumber[] {
  const out: MaybeNumber[] = Array(values.length).fill(null);
  let sum = 0;
  let prev: number | null = null;
  for (let i = 0; i < values.length; i += 1) {
    if (i < length) {
      sum += values[i];
      if (i === length - 1) {
        prev = sum / length;
        out[i] = prev;
      }
      continue;
    }
    prev = ((prev ?? values[i - 1]) * (length - 1) + values[i]) / length;
    out[i] = prev;
  }
  return out;
}

export function highest(values: number[], length: number, index: number): number | null {
  if (index < 0) return null;
  let result = -Infinity;
  const start = Math.max(0, index - length + 1);
  for (let i = start; i <= index; i += 1) result = Math.max(result, values[i]);
  return Number.isFinite(result) ? result : null;
}

export function lowest(values: number[], length: number, index: number): number | null {
  if (index < 0) return null;
  let result = Infinity;
  const start = Math.max(0, index - length + 1);
  for (let i = start; i <= index; i += 1) result = Math.min(result, values[i]);
  return Number.isFinite(result) ? result : null;
}

export function highestPrevious(values: number[], length: number, index: number): number | null {
  if (index <= 0) return null;
  let result = -Infinity;
  const start = Math.max(0, index - length);
  for (let i = start; i < index; i += 1) result = Math.max(result, values[i]);
  return Number.isFinite(result) ? result : null;
}

export function lowestPrevious(values: number[], length: number, index: number): number | null {
  if (index <= 0) return null;
  let result = Infinity;
  const start = Math.max(0, index - length);
  for (let i = start; i < index; i += 1) result = Math.min(result, values[i]);
  return Number.isFinite(result) ? result : null;
}

export function trueRange(high: number[], low: number[], close: number[]): number[] {
  return high.map((value, index) => {
    if (index === 0) return value - low[index];
    return Math.max(value - low[index], Math.abs(value - close[index - 1]), Math.abs(low[index] - close[index - 1]));
  });
}

export function atr(high: number[], low: number[], close: number[], length: number): MaybeNumber[] {
  return rma(trueRange(high, low, close), length);
}

export function rsi(values: number[], length: number): MaybeNumber[] {
  const gains: number[] = Array(values.length).fill(0);
  const losses: number[] = Array(values.length).fill(0);
  for (let i = 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    gains[i] = Math.max(delta, 0);
    losses[i] = Math.max(-delta, 0);
  }
  const avgGain = rma(gains, length);
  const avgLoss = rma(losses, length);
  return values.map((_, i) => {
    const gain = avgGain[i];
    const loss = avgLoss[i];
    if (gain == null || loss == null) return null;
    if (loss === 0) return 100;
    const rs = gain / loss;
    return 100 - 100 / (1 + rs);
  });
}

export function dmi(high: number[], low: number[], close: number[], length = 14, adxLength = 14) {
  const tr = trueRange(high, low, close);
  const plusDm: number[] = Array(high.length).fill(0);
  const minusDm: number[] = Array(high.length).fill(0);

  for (let i = 1; i < high.length; i += 1) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  const trRma = rma(tr, length);
  const plusRma = rma(plusDm, length);
  const minusRma = rma(minusDm, length);
  const plusDi: MaybeNumber[] = Array(high.length).fill(null);
  const minusDi: MaybeNumber[] = Array(high.length).fill(null);
  const dx: number[] = Array(high.length).fill(0);

  for (let i = 0; i < high.length; i += 1) {
    if (trRma[i] == null || trRma[i] === 0 || plusRma[i] == null || minusRma[i] == null) continue;
    plusDi[i] = (100 * plusRma[i]!) / trRma[i]!;
    minusDi[i] = (100 * minusRma[i]!) / trRma[i]!;
    const sum = plusDi[i]! + minusDi[i]!;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDi[i]! - minusDi[i]!)) / sum;
  }

  return { plusDi, minusDi, adx: rma(dx, adxLength) };
}

export function pivotLowAt(values: number[], currentIndex: number, left: number, right: number): number | null {
  const pivotIndex = currentIndex - right;
  if (pivotIndex - left < 0 || pivotIndex + right > currentIndex) return null;
  const pivot = values[pivotIndex];
  for (let i = pivotIndex - left; i <= pivotIndex + right; i += 1) {
    if (i !== pivotIndex && values[i] <= pivot) return null;
  }
  return pivot;
}

export function pivotHighAt(values: number[], currentIndex: number, left: number, right: number): number | null {
  const pivotIndex = currentIndex - right;
  if (pivotIndex - left < 0 || pivotIndex + right > currentIndex) return null;
  const pivot = values[pivotIndex];
  for (let i = pivotIndex - left; i <= pivotIndex + right; i += 1) {
    if (i !== pivotIndex && values[i] >= pivot) return null;
  }
  return pivot;
}

export function crossover(values: MaybeNumber[], level: number, index: number): boolean {
  if (index <= 0 || values[index] == null || values[index - 1] == null) return false;
  return values[index]! > level && values[index - 1]! <= level;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function safeDiv(num: number, den: number, fallback = 0): number {
  return den !== 0 && Number.isFinite(den) ? num / den : fallback;
}
