import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ModelPickerModal } from '@/components/chat/model-picker-modal';
import { PromptModal } from '@/components/chat/prompt-modal';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { showDialog } from '@/components/ui/dialog';
import { ScreenHeader } from '@/components/ui/screen-header';
import { useTheme } from '@/hooks/use-theme';
import { fetchAvailableModels } from '@/lib/api';
import {
  deleteAllConversations,
  getStorageStats,
  listModels,
  resetAllData,
  type StorageStats,
} from '@/lib/db';
import {
  DEFAULT_BASE_URL,
  getApiKey,
  loadSettings,
  saveBaseUrl,
  saveCustomInstructions,
  saveDefaultModel,
  saveMinDiscount,
  saveStreaming,
  setApiKey,
} from '@/lib/settings';
import type { ModelInfo } from '@/lib/types';

interface SettingsScreenProps {
  /** True while this section is the active one. */
  active?: boolean;
  onOpenDrawer?: () => void;
}

export function SettingsScreen({ active = false, onOpenDrawer }: SettingsScreenProps) {
  const colors = useTheme();
  const { bottom } = useSafeAreaInsets();
  const [apiKey, setApiKeyState] = useState<string>('');
  const [baseUrl, setBaseUrlState] = useState(DEFAULT_BASE_URL);
  const [customInstructions, setCustomInstructionsState] = useState('');
  const [streaming, setStreaming] = useState(true);
  const [minDiscount, setMinDiscountState] = useState(0);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const presets = [0, 30, 50, 90, 99];

  const load = useCallback(async () => {
    const [settings, key, modelList, storageStats] = await Promise.all([
      loadSettings(),
      getApiKey(),
      listModels(),
      getStorageStats(),
    ]);
    setApiKeyState(key ?? '');
    setBaseUrlState(settings.baseUrl);
    setCustomInstructionsState(settings.customInstructions);
    setStreaming(settings.streaming);
    setMinDiscountState(settings.minDiscount);
    setDefaultModelId(settings.defaultModelId);
    setModels(modelList);
    setStats(storageStats);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Also reload when this section becomes active again (the route-level focus
  // effect above only covers modal open/close, not section switches).
  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const testConnection = async () => {
    if (testing) return;
    const key = apiKey.trim();
    if (!key) {
      showDialog({
        title: 'Uji koneksi',
        message: 'Isi API key dulu (buyer key inf_… dari surplusintelligence.ai).',
      });
      return;
    }
    setTesting(true);
    try {
      const ids = await fetchAvailableModels(baseUrl, key);
      showDialog({
        title: 'Koneksi berhasil',
        message: `${ids.length} model tersedia untuk API key ini.`,
      });
    } catch (e) {
      showDialog({
        title: 'Koneksi gagal',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const saveApiKey = async () => {
    await setApiKey(apiKey);
  };

  const saveBaseUrlValue = async () => {
    await saveBaseUrl(baseUrl);
    setBaseUrlState((prev) => prev.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL);
  };

  const saveMinDiscountValue = async (value: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(value) || 0));
    setMinDiscountState(clamped);
    await saveMinDiscount(clamped);
  };

  const saveCustomInstructionsValue = async () => {
    await saveCustomInstructions(customInstructions);
  };

  const pickDefaultModel = async (model: ModelInfo | null) => {
    setPickerVisible(false);
    await saveDefaultModel(model?.id ?? null);
    setDefaultModelId(model?.id ?? null);
  };

  const defaultModel = models.find((m) => m.id === defaultModelId) ?? null;

  const confirmClearChats = () => {
    showDialog({
      title: 'Hapus semua percakapan',
      message: 'Semua riwayat chat akan dihapus permanen dari perangkat.',
      actions: [
        { label: 'Batal', style: 'cancel' },
        {
          label: 'Hapus',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteAllConversations();
              await load();
            })();
          },
        },
      ],
    });
  };

  const confirmReset = () => {
    showDialog({
      title: 'Reset semua data',
      message: 'Percakapan, model, pengaturan, dan API key akan dihapus. Aplikasi kembali seperti baru.',
      actions: [
        { label: 'Batal', style: 'cancel' },
        {
          label: 'Reset',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await resetAllData();
              await setApiKey(null);
              await load();
            })();
          },
        },
      ],
    });
  };

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="Setelan" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="Setelan"
        leading={
          onOpenDrawer ? (
            <IconButton name="sidebar" onPress={onOpenDrawer} color={colors.text} accessibilityLabel="Buka menu" />
          ) : undefined
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: 48 + bottom }}>
        {/* --- API --- */}
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '700' }}>AKUN &amp; API</Text>
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600' }}>API Key</Text>
            <TextInput
              value={apiKey}
              onChangeText={setApiKeyState}
              onBlur={saveApiKey}
              onEndEditing={saveApiKey}
              placeholder="inf_…"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              secureTextEntry
              selectTextOnFocus={false}
              style={{
                color: colors.text,
                backgroundColor: colors.backgroundElement,
                borderRadius: 12,
                borderCurve: 'continuous',
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
              }}
            />
            <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17 }}>
              Buyer key dari surplusintelligence.ai. Tampil tersandi (tidak bisa dilihat/disalin), disimpan aman di SecureStore perangkat, dan hanya dikirim ke Surplus saat request. Tempel untuk mengisi.
            </Text>
          </View>
          <Pressable
            onPress={testConnection}
            disabled={testing}
            accessibilityRole="button"
            accessibilityLabel="Uji koneksi API"
            style={({ pressed }) => ({
              backgroundColor: colors.backgroundElement,
              borderRadius: 12,
              borderCurve: 'continuous',
              paddingVertical: 12,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 8,
              opacity: pressed || testing ? 0.7 : 1,
            })}>
            {testing ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : null}
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Uji koneksi</Text>
          </Pressable>
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600' }}>Base URL</Text>
            <TextInput
              value={baseUrl}
              onChangeText={setBaseUrlState}
              onBlur={saveBaseUrlValue}
              onEndEditing={saveBaseUrlValue}
              placeholder={DEFAULT_BASE_URL}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={{
                color: colors.text,
                backgroundColor: colors.backgroundElement,
                borderRadius: 12,
                borderCurve: 'continuous',
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 13,
                fontFamily: 'monospace',
              }}
            />
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              Default: {DEFAULT_BASE_URL}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17 }}>
              URL polos saja — tidak perlu disisipi /minN manual. Diskon diatur lewat
              “Diskon minimum” di bawah (atau segmen /minN di URL tetap dipakai kalau setting-nya 0).
            </Text>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
              Diskon minimum
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <IconButton
                name="minus"
                onPress={() => saveMinDiscountValue(minDiscount - 1)}
                accessibilityLabel="Kurangi diskon minimum"
              />
              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.backgroundElement,
                  borderRadius: 12,
                  borderCurve: 'continuous',
                  paddingVertical: 12,
                  alignItems: 'center',
                }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
                  {minDiscount === 0 ? 'Mati' : `${minDiscount}%`}
                </Text>
              </View>
              <IconButton
                name="plus"
                onPress={() => saveMinDiscountValue(minDiscount + 1)}
                accessibilityLabel="Tambah diskon minimum"
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {presets.map((preset) => {
                const activeChip = preset === minDiscount;
                return (
                  <Pressable
                    key={preset}
                    onPress={() => saveMinDiscountValue(preset)}
                    accessibilityRole="button"
                    accessibilityLabel={`Diskon minimum ${preset === 0 ? 'mati' : `${preset} persen`}`}
                    style={({ pressed }) => ({
                      flex: 1,
                      height: 36,
                      borderRadius: 12,
                      borderCurve: 'continuous',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: activeChip
                        ? colors.accent
                        : pressed
                          ? colors.backgroundSelected
                          : colors.backgroundElement,
                    })}>
                    <Text
                      style={{
                        color: activeChip ? '#ffffff' : colors.text,
                        fontSize: 13,
                        fontWeight: '600',
                      }}>
                      {preset === 0 ? 'Mati' : `min${preset}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17 }}>
              Semua request chat &amp; gambar dikirim lewat /minN — penjual hanya melayani kalau
              diskonnya ≥ N. Berlaku langsung untuk request berikutnya; makin tinggi makin murah,
              tapi makin sering tidak ada penjual yang memenuhi syarat.
            </Text>
          </View>
        </View>

        {/* --- Chat --- */}
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '700' }}>CHAT</Text>
          <Pressable
            onPress={() => setPickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Pilih model default"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: colors.backgroundElement,
              borderRadius: 12,
              borderCurve: 'continuous',
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}>
            <View style={{ gap: 2, flex: 1, paddingRight: 12 }}>
              <Text style={{ color: colors.text, fontSize: 15 }}>Model default</Text>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>
                {defaultModel
                  ? (defaultModel.displayName ?? defaultModel.id)
                  : 'Dipakai untuk chat baru — pilih dari daftar model'}
              </Text>
            </View>
            <Icon name="chevronDown" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => setPromptVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Edit custom instructions"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: colors.backgroundElement,
              borderRadius: 12,
              borderCurve: 'continuous',
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}>
            <View style={{ gap: 2, flex: 1, paddingRight: 12 }}>
              <Text style={{ color: colors.text, fontSize: 15 }}>Custom Instructions</Text>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>
                {customInstructions ? customInstructions : 'Seperti AGENTS.md — dikirim ke setiap chat'}
              </Text>
            </View>
            <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '600' }}>Edit</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setStreaming(!streaming);
              saveStreaming(!streaming);
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: streaming }}
            accessibilityLabel="Respons streaming"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: colors.backgroundElement,
              borderRadius: 12,
              borderCurve: 'continuous',
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}>
            <View style={{ gap: 2, flex: 1, paddingRight: 12 }}>
              <Text style={{ color: colors.text, fontSize: 15 }}>Respons streaming</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                Jawaban muncul kata demi kata
              </Text>
            </View>
            <Switch
              value={streaming}
              onValueChange={(value) => {
                setStreaming(value);
                saveStreaming(value);
              }}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </Pressable>
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17 }}>
            Perilaku dasar asisten (langsung jawab, Markdown bila membantu, tidak mengarang) selalu aktif. Custom Instructions ditambahkan di atas perilaku dasar ini; system prompt khusus percakapan menggantikannya sepenuhnya.
          </Text>
        </View>

        {/* --- Storage --- */}
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '700' }}>PENYIMPANAN</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
            {stats
              ? `${stats.conversations} percakapan · ${stats.messages} pesan · ${stats.models} model tersimpan lokal di perangkat.`
              : '—'}
          </Text>
          <Pressable
            onPress={confirmClearChats}
            accessibilityRole="button"
            accessibilityLabel="Hapus semua percakapan"
            style={({ pressed }) => ({
              paddingVertical: 12,
              alignItems: 'center',
              borderRadius: 12,
              borderCurve: 'continuous',
              backgroundColor: colors.backgroundElement,
              opacity: pressed ? 0.7 : 1,
            })}>
            <Text style={{ color: colors.error, fontSize: 15, fontWeight: '600' }}>
              Hapus semua percakapan
            </Text>
          </Pressable>
          <Pressable
            onPress={confirmReset}
            accessibilityRole="button"
            accessibilityLabel="Reset semua data"
            style={({ pressed }) => ({
              paddingVertical: 12,
              alignItems: 'center',
              borderRadius: 12,
              borderCurve: 'continuous',
              backgroundColor: colors.backgroundElement,
              opacity: pressed ? 0.7 : 1,
            })}>
            <Text style={{ color: colors.error, fontSize: 15, fontWeight: '600' }}>
              Reset semua data (chat, model, setelan)
            </Text>
          </Pressable>
        </View>

        {/* --- About --- */}
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '700' }}>TENTANG</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
            LabChat v1.0 — klien pribadi khusus Surplus Intelligence. Semua data tersimpan lokal; tidak ada analytics atau server pihak ketiga.
          </Text>
        </View>
      </ScrollView>

      <ModelPickerModal
        visible={pickerVisible}
        title="Model default"
        models={models}
        selectedId={defaultModelId}
        allowNone
        onSelect={pickDefaultModel}
        onClose={() => setPickerVisible(false)}
      />
      <PromptModal
        visible={promptVisible}
        title="Custom Instructions"
        initial={customInstructions}
        placeholder="Contoh: Jawab singkat dan padat dalam Bahasa Indonesia. Gunakan format list bila memungkinkan."
        hint="Dikirim sebagai system prompt di setiap percakapan. Percakapan bisa punya override sendiri lewat menu di dalam chat."
        onSave={async (value) => {
          setCustomInstructionsState(value);
          await saveCustomInstructions(value);
          setPromptVisible(false);
        }}
        onClose={() => setPromptVisible(false)}
      />
    </View>
  );
}
