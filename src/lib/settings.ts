import * as SecureStore from 'expo-secure-store';

import { getSetting, setSetting } from './db';
import type { AppSettings } from './types';

export const DEFAULT_BASE_URL = 'https://api.surplusintelligence.ai/v1';

export const SETTING_KEYS = {
  baseUrl: 'base_url',
  defaultModel: 'default_model_id',
  customInstructions: 'custom_instructions',
  streaming: 'streaming',
  minDiscount: 'min_discount',
} as const;

const API_KEY_STORE_KEY = 'surplus-api-key';
/** Fallback key when SecureStore is unavailable (e.g. web). */
const API_KEY_DB_KEY = 'api_key';

export async function getApiKey(): Promise<string | null> {
  if (process.env.EXPO_OS === 'web') {
    return getSetting(API_KEY_DB_KEY);
  }
  try {
    const value = await SecureStore.getItemAsync(API_KEY_STORE_KEY);
    if (value !== null) return value;
  } catch {
    // fall through to db fallback
  }
  return getSetting(API_KEY_DB_KEY);
}

export async function setApiKey(key: string | null): Promise<void> {
  const trimmed = key?.trim() || null;
  if (process.env.EXPO_OS === 'web') {
    await setSetting(API_KEY_DB_KEY, trimmed);
    return;
  }
  try {
    if (trimmed) {
      await SecureStore.setItemAsync(API_KEY_STORE_KEY, trimmed);
    } else {
      await SecureStore.deleteItemAsync(API_KEY_STORE_KEY);
    }
  } catch {
    await setSetting(API_KEY_DB_KEY, trimmed);
  }
}

export async function loadSettings(): Promise<AppSettings> {
  const [baseUrl, defaultModelId, customInstructions, streaming, minDiscount] = await Promise.all([
    getSetting(SETTING_KEYS.baseUrl),
    getSetting(SETTING_KEYS.defaultModel),
    getSetting(SETTING_KEYS.customInstructions),
    getSetting(SETTING_KEYS.streaming),
    getSetting(SETTING_KEYS.minDiscount),
  ]);
  const parsedDiscount = Number.parseInt(minDiscount ?? '0', 10);
  return {
    baseUrl: baseUrl?.trim() || DEFAULT_BASE_URL,
    defaultModelId: defaultModelId || null,
    customInstructions: customInstructions ?? '',
    // default: on
    streaming: streaming !== '0',
    minDiscount: Number.isFinite(parsedDiscount) ? Math.min(100, Math.max(0, parsedDiscount)) : 0,
  };
}

export async function saveBaseUrl(value: string): Promise<void> {
  const trimmed = value.trim().replace(/\/+$/, '');
  await setSetting(SETTING_KEYS.baseUrl, trimmed || DEFAULT_BASE_URL);
}

export async function saveDefaultModel(modelId: string | null): Promise<void> {
  await setSetting(SETTING_KEYS.defaultModel, modelId);
}

export async function saveCustomInstructions(value: string): Promise<void> {
  await setSetting(SETTING_KEYS.customInstructions, value.trim() || null);
}

export async function saveStreaming(enabled: boolean): Promise<void> {
  await setSetting(SETTING_KEYS.streaming, enabled ? '1' : '0');
}

export async function saveMinDiscount(value: number): Promise<void> {
  const clamped = Math.min(100, Math.max(0, Math.round(value) || 0));
  await setSetting(SETTING_KEYS.minDiscount, String(clamped));
}
