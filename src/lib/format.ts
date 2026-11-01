import type { ModelInfo } from './types';

// Keep this file dependency-free — it is imported by nearly every screen, so any
// import added here ripples through the whole bundle.

/** Rough token estimate (~4 chars per token) when the API does not report usage. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Actual cost after applying the model's discount, in USD. */
export function computeCost(
  model: ModelInfo | null,
  inputTokens: number | null,
  outputTokens: number | null
): number | null {
  if (!model) return null;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  const gross = (input / 1e6) * model.inputPrice + (output / 1e6) * model.outputPrice;
  return gross * (1 - model.discountPct / 100);
}

/** Cost from live market prices (already net of discount), in USD. */
export function computeMarketCost(
  inputPrice: number | null,
  outputPrice: number | null,
  inputTokens: number | null,
  outputTokens: number | null
): number | null {
  if (inputPrice == null && outputPrice == null) return null;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  const cost = (input / 1e6) * (inputPrice ?? 0) + (output / 1e6) * (outputPrice ?? 0);
  return cost > 0 ? cost : null;
}

/** Percentage without a trailing ".0", e.g. 99.9% or 50%. */
export function formatPct(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function formatUsd(value: number): string {
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(5)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** Reference price line, e.g. "$3 in · $15 out /1jt tok". */
export function priceSummary(input: number, output: number): string {
  if (input <= 0 && output <= 0) return 'Harga belum tersedia';
  return `${formatUsd(input)} in · ${formatUsd(output)} out /1jt tok`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}rb`;
  return String(tokens);
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  const date = new Date(timestamp);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}
