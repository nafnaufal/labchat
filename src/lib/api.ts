import { fetch } from 'expo/fetch';

export type ApiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant';
  /** Plain text, or OpenAI-style content parts (text + image_url) for vision input. */
  content: string | ApiContentPart[];
}

export interface ChatUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  estimated: boolean;
}

export interface ChatResult {
  content: string;
  usage: ChatUsage;
}

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** GET /v1/models — returns the list of model ids available to this key. */
export async function fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  const json: unknown = await res.json();
  const data: unknown[] = Array.isArray((json as { data?: unknown[] })?.data)
    ? (json as { data: unknown[] }).data
    : Array.isArray(json)
      ? (json as unknown[])
      : [];
  return data
    .map((entry) => (typeof entry === 'string' ? entry : (entry as { id?: unknown })?.id))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export interface ReferencePrice {
  input: number;
  output: number;
  /** Image-generation models: USD per generated image (mediaPricing.perImageUsd). */
  image: number;
  displayName?: string;
}

/** GET /v1/prices — public reference prices (USD per 1M tokens / per image) for every catalog model. */
export async function fetchReferencePrices(baseUrl: string): Promise<Map<string, ReferencePrice>> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/prices`);
  if (!res.ok) {
    throw await toApiError(res);
  }
  const json = (await res.json()) as {
    models?: Array<{
      model?: string;
      displayName?: string;
      mediaType?: string;
      mediaPricing?: { perImageUsd?: number };
      providers?: Array<{ pricing?: { input?: number; output?: number } }>;
    }>;
  };
  const map = new Map<string, ReferencePrice>();
  for (const entry of json?.models ?? []) {
    if (typeof entry?.model !== 'string' || !entry.model) continue;
    // providers[] is sorted by output price ascending — the first entry is the cheapest.
    const pricing = entry.providers?.[0]?.pricing;
    const input = typeof pricing?.input === 'number' ? pricing.input : 0;
    const output = typeof pricing?.output === 'number' ? pricing.output : 0;
    // Image models have no providers[] — their price lives in mediaPricing.
    const image =
      entry.mediaType === 'image' && typeof entry.mediaPricing?.perImageUsd === 'number'
        ? entry.mediaPricing.perImageUsd
        : 0;
    if (input <= 0 && output <= 0 && image <= 0) continue;
    map.set(entry.model, { input, output, image, displayName: entry.displayName });
  }
  return map;
}

export interface ModelCapabilities {
  id: string;
  displayName?: string;
  /** Accepts image input (vision). */
  vision: boolean;
  /** Generates images via POST /v1/images/generations. */
  imageGen: boolean;
}

/**
 * GET /v1/models — public per-model capabilities. OpenRouter-compatible rows expose
 * `architecture.input_modalities`/`output_modalities` and `supported_features`; the two are
 * sometimes inconsistent, so vision ORs them: an image in input_modalities OR a
 * "vision" feature both count. Image generation is output_modalities containing "image"
 * (or an "image" feature).
 */
export async function fetchModelCapabilities(baseUrl: string): Promise<Map<string, ModelCapabilities>> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/models`);
  if (!res.ok) {
    throw await toApiError(res);
  }
  const json = (await res.json()) as {
    data?: Array<{
      id?: string;
      name?: string;
      architecture?: { input_modalities?: string[]; output_modalities?: string[] };
      supported_features?: string[];
    }>;
  };
  const map = new Map<string, ModelCapabilities>();
  for (const row of json?.data ?? []) {
    if (typeof row?.id !== 'string' || !row.id) continue;
    const inputMods = row.architecture?.input_modalities ?? [];
    const outputMods = row.architecture?.output_modalities ?? [];
    const features = row.supported_features ?? [];
    const has = (list: string[], value: string) => list.some((m) => m?.toLowerCase() === value);
    map.set(row.id, {
      id: row.id,
      displayName: typeof row.name === 'string' && row.name ? row.name : undefined,
      vision: has(inputMods, 'image') || has(features, 'vision'),
      imageGen: has(outputMods, 'image') || has(features, 'image'),
    });
  }
  return map;
}

/** Extracts the min-discount floor from a base URL like `https://…/min99/v1`, if present. */
export function extractMinDiscount(baseUrl: string): number | null {
  const match = normalizeBaseUrl(baseUrl).match(/\/min(\d{1,3})(?=\/|$)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 0 && value <= 100 ? value : null;
}

/**
 * Injects the min-discount floor into a base URL, producing e.g.
 * `https://api.surplusintelligence.ai/min99/v1`. Any existing /min{N} segment is
 * stripped first, so the setting is the single source of truth. 0 leaves the URL
 * as-is (a hand-written /min{N} segment in the base URL still works).
 */
export function withMinDiscount(baseUrl: string, minDiscount: number): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const n = Math.min(100, Math.max(0, Math.round(minDiscount) || 0));
  if (n <= 0) return normalized;
  const scheme = normalized.indexOf('://');
  if (scheme < 0) return normalized;
  const pathStart = scheme + 3 + normalized.slice(scheme + 3).indexOf('/');
  const origin = pathStart < scheme + 3 ? normalized : normalized.slice(0, pathStart);
  let path = pathStart < scheme + 3 ? '' : normalized.slice(pathStart);
  path = path.replace(/^\/min\d{1,3}(?=\/|$)/i, '');
  return `${origin}/min${n}${path || '/v1'}`;
}

/**
 * The discount floor used for cost display: the setting wins when non-zero,
 * otherwise a /min{N} segment hand-written into the base URL applies.
 */
export function effectiveMinDiscount(baseUrl: string, minDiscount: number): number {
  const n = Math.min(100, Math.max(0, Math.round(minDiscount) || 0));
  if (n > 0) return n;
  return extractMinDiscount(baseUrl) ?? 0;
}

export interface MarketEntry {
  /** Cheapest healthy ask right now, USD per 1M tokens — already net of discount. */
  input: number | null;
  output: number | null;
  /** Cheapest healthy ask per image (media_unit 'image'), USD — net of discount. */
  image: number | null;
  /** Deepest discount on offer right now vs reference price, in percent. */
  discountPct: number | null;
  /** Deepest discount an actual fill got in the last 90 days, percent. */
  bestDiscountPct: number | null;
}

/** GET /api/markets is site-level (outside /v1, unaffected by the min{N} segment). */
function originOf(baseUrl: string): string {
  const url = normalizeBaseUrl(baseUrl);
  const scheme = url.indexOf('://');
  if (scheme < 0) return url;
  const slash = url.slice(scheme + 3).indexOf('/');
  return slash < 0 ? url : url.slice(0, scheme + 3 + slash);
}

function microUsd(value: unknown): number | null {
  return typeof value === 'number' && value > 0 ? value / 1e6 : null;
}

function pctOf(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * GET /api/markets — public live order-book snapshot for every model: the cheapest
 * ask (post-discount) plus the discount on offer. Cached 30s server-side, precomputed
 * every 15 minutes. Fields are omitted (→ null, never 0) when no offer has a reference.
 */
export async function fetchMarketPrices(baseUrl: string): Promise<Map<string, MarketEntry>> {
  const res = await fetch(`${originOf(baseUrl)}/api/markets`);
  if (!res.ok) {
    throw await toApiError(res);
  }
  const json = (await res.json()) as {
    markets?: Array<{
      model?: string;
      best_input_per_1m?: number;
      best_output_per_1m?: number;
      best_media_unit_price?: number;
      media_unit?: string;
      best_live_discount_pct?: number;
      best_discount_pct?: number;
    }>;
  };
  const map = new Map<string, MarketEntry>();
  for (const row of json?.markets ?? []) {
    if (typeof row?.model !== 'string' || !row.model) continue;
    map.set(row.model, {
      input: microUsd(row.best_input_per_1m),
      output: microUsd(row.best_output_per_1m),
      image: row.media_unit === 'image' ? microUsd(row.best_media_unit_price) : null,
      discountPct: pctOf(row.best_live_discount_pct),
      bestDiscountPct: pctOf(row.best_discount_pct),
    });
  }
  return map;
}

const MARKET_TTL_MS = 5 * 60_000;
let marketCache: { origin: string; at: number; promise: Promise<Map<string, MarketEntry>> } | null =
  null;

/**
 * Shared market snapshot with a 5-minute TTL (the response is ~1.5MB). Browse, chat
 * cost estimation, and model detail all reuse one fetch. Failures are not cached.
 */
export function getMarketMap(baseUrl: string): Promise<Map<string, MarketEntry>> {
  const origin = originOf(baseUrl);
  if (marketCache && marketCache.origin === origin && Date.now() - marketCache.at < MARKET_TTL_MS) {
    return marketCache.promise;
  }
  const promise = fetchMarketPrices(origin);
  marketCache = { origin, at: Date.now(), promise };
  promise.catch(() => {
    if (marketCache && marketCache.promise === promise) marketCache = null;
  });
  return promise;
}

interface ChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ApiMessage[];
  stream: boolean;
  /** Minimum-discount floor (0 = off); applied as a /min{N} URL segment. */
  minDiscount?: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

/** POST /v1/chat/completions — streams the answer when `stream` is true, with a JSON fallback. */
export async function chatCompletion(opts: ChatOptions): Promise<ChatResult> {
  const url = `${withMinDiscount(opts.baseUrl, opts.minDiscount ?? 0)}/chat/completions`;
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
  };
  if (opts.stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    throw await toApiError(res);
  }

  if (opts.stream && res.body) {
    return consumeStream(res.body, opts.onDelta);
  }

  const json = (await res.json()) as StreamJson;
  const content: string = json?.choices?.[0]?.message?.content ?? '';
  return { content, usage: usageFromJson(json) };
}

export interface ImageGenResult {
  /** Base64-encoded JPEG/PNG images (response_format: b64_json). */
  images: string[];
  /** Total images billed — used for cost estimation; null when the API omits it. */
  imageCount: number | null;
}

interface ImageGenOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  /** Minimum-discount floor (0 = off); applied as a /min{N} URL segment. */
  minDiscount?: number;
  signal?: AbortSignal;
}

/**
 * POST /v1/images/generations — synchronous image generation. Requests b64_json so
 * the result can be saved locally; a URL-shaped response is fetched and converted.
 */
export async function generateImage(opts: ImageGenOptions): Promise<ImageGenResult> {
  const res = await fetch(`${withMinDiscount(opts.baseUrl, opts.minDiscount ?? 0)}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      prompt: opts.prompt,
      response_format: 'b64_json',
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    usage?: { total_images?: number; images?: number };
  };
  const images: string[] = [];
  for (const item of json?.data ?? []) {
    if (typeof item?.b64_json === 'string' && item.b64_json) {
      images.push(item.b64_json);
    } else if (typeof item?.url === 'string' && /^https?:/i.test(item.url)) {
      // Fallback: URL response — download and convert to base64.
      const imgRes = await fetch(item.url, { signal: opts.signal });
      if (!imgRes.ok) continue;
      const bytes = new Uint8Array(await imgRes.arrayBuffer());
      images.push(bytesToBase64(bytes));
    }
  }
  const billed =
    typeof json?.usage?.total_images === 'number'
      ? json.usage.total_images
      : typeof json?.usage?.images === 'number'
        ? json.usage.images
        : null;
  if (images.length === 0) {
    throw new ApiError('Respons generate gambar tidak berisi gambar.');
  }
  return { images, imageCount: billed ?? images.length };
}

/** Pure-JS base64 (no btoa — not available in Hermes/React Native). */
export function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : chars[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : chars[b2 & 63];
  }
  return out;
}


interface StreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: UsageJson | null;
}interface StreamJson {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: UsageJson | null;
}

interface UsageJson {
  prompt_tokens?: number;
  input_tokens?: number;
  completion_tokens?: number;
  output_tokens?: number;
}

async function consumeStream(
  body: { getReader: () => { read: () => Promise<{ done: boolean; value?: unknown }> } },
  onDelta?: (delta: string) => void
): Promise<ChatResult> {
  const reader = body.getReader();
  let buffer = '';
  let content = '';
  let rawUsage: UsageJson | null | undefined;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decodeChunk(value);

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      // SSE comments / heartbeats start with ':'
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(payload) as StreamChunk;
      } catch {
        continue;
      }
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        content += delta;
        onDelta?.(delta);
      }
      if (chunk?.usage) {
        rawUsage = chunk.usage;
      }
    }
  }

  return { content, usage: usageFromJson({ usage: rawUsage }) };
}

function decodeChunk(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(value);
    }
    let out = '';
    for (const byte of value) out += String.fromCharCode(byte);
    return out;
  }
  return '';
}

function usageFromJson(json: StreamJson | { usage?: UsageJson | null }): ChatUsage {
  const usage = json?.usage;
  if (!usage) {
    return { inputTokens: null, outputTokens: null, estimated: true };
  }
  const input = usage.prompt_tokens ?? usage.input_tokens ?? null;
  const output = usage.completion_tokens ?? usage.output_tokens ?? null;
  return {
    inputTokens: typeof input === 'number' ? input : null,
    outputTokens: typeof output === 'number' ? output : null,
    estimated: false,
  };
}

async function toApiError(res: Response): Promise<ApiError> {
  let detail = '';
  try {
    const json = (await res.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof json?.error === 'string') detail = json.error;
    else detail = json?.error?.message ?? json?.message ?? '';
  } catch {
    // response body was not JSON
  }
  const status = res.status;
  let hint = '';
  if (status === 401) hint = 'API key tidak valid atau belum disetel.';
  else if (status === 404) hint = 'Endpoint atau model tidak ditemukan — periksa Base URL dan nama model.';
  else if (status === 429) hint = 'Terlalu banyak permintaan, coba lagi sebentar lagi.';
  else if (status === 502 || status === 503) hint = 'Model sedang tidak tersedia (tidak ada penjual aktif) — coba model lain.';
  const parts = [`HTTP ${status}`, detail, hint].filter(Boolean);
  return new ApiError(parts.join(' · '), status);
}
