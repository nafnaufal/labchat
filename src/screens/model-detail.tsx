import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router/stack';
import { useRouter } from 'expo-router';

import { CapabilityBadges } from '@/components/ui/capability-badges';
import { showDialog } from '@/components/ui/dialog';
import { useTheme } from '@/hooks/use-theme';
import {
  effectiveMinDiscount,
  fetchModelCapabilities,
  fetchReferencePrices,
  getMarketMap,
  type MarketEntry,
  type ModelCapabilities,
  type ReferencePrice,
} from '@/lib/api';
import { getModel, getSetting, removeModel, upsertModels } from '@/lib/db';
import { formatPct, formatUsd } from '@/lib/format';
import { SETTING_KEYS, loadSettings, saveDefaultModel } from '@/lib/settings';

interface ModelInfoView {
  displayName?: string;
  input: number;
  output: number;
  image: number;
  vision: boolean;
  imageGen: boolean;
}

export function ModelDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const colors = useTheme();
  const modelId = decodeURIComponent(id);

  const [inList, setInList] = useState<boolean | null>(null); // null = still loading
  const [info, setInfo] = useState<ModelInfoView | null>(null);
  const [market, setMarket] = useState<MarketEntry | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setInList(null);
      setInfo(null);
      setMarket(null);
      setError(null);
      try {
        const [stored, settings, defaultId] = await Promise.all([
          getModel(modelId),
          loadSettings(),
          getSetting(SETTING_KEYS.defaultModel),
        ]);
        if (cancelled) return;
        setInList(stored !== null);
        setIsDefault(defaultId === modelId);
        setDiscount(effectiveMinDiscount(settings.baseUrl, settings.minDiscount));

        // Capabilities are public and cheap — always refresh them so vision /
        // image-gen flags stay current even for models added before image
        // support existed.
        let cap: ModelCapabilities | undefined;
        try {
          cap = (await fetchModelCapabilities(settings.baseUrl)).get(modelId);
        } catch {
          // Capabilities endpoint unavailable — fall back to stored flags.
        }
        if (cancelled) return;

        // Live market price (cheapest ask, net of discount). Cached across screens.
        try {
          setMarket((await getMarketMap(settings.baseUrl)).get(modelId) ?? null);
        } catch {
          // Market data unavailable — fall back to reference prices.
        }
        if (cancelled) return;

        if (stored) {
          setInfo({
            displayName: stored.displayName ?? cap?.displayName ?? undefined,
            input: stored.inputPrice,
            output: stored.outputPrice,
            image: stored.imagePrice,
            vision: cap?.vision ?? stored.vision,
            imageGen: cap?.imageGen ?? stored.imageGen,
          });
          // Persist refreshed capabilities (and a display name if we learned one).
          if (cap && (cap.vision !== stored.vision || cap.imageGen !== stored.imageGen)) {
            await upsertModels([
              {
                id: modelId,
                displayName: stored.displayName ?? cap.displayName ?? null,
                inputPrice: stored.inputPrice,
                outputPrice: stored.outputPrice,
                imagePrice: stored.imagePrice,
                discountPct: stored.discountPct,
                vision: cap.vision,
                imageGen: cap.imageGen,
                source: stored.source,
                updatedAt: Date.now(),
              },
            ]);
          }
          return;
        }

        // Not in the list yet — pull the reference price from the public catalog.
        let price: ReferencePrice | undefined;
        try {
          price = (await fetchReferencePrices(settings.baseUrl)).get(modelId);
        } catch {
          // ignore — capabilities alone still make the detail page useful
        }
        if (cancelled) return;
        if (price || cap) {
          setInfo({
            displayName: price?.displayName ?? cap?.displayName ?? undefined,
            input: price?.input ?? 0,
            output: price?.output ?? 0,
            image: price?.image ?? 0,
            vision: cap?.vision ?? false,
            imageGen: cap?.imageGen ?? false,
          });
        } else {
          setError('Model ini tidak ditemukan di katalog /v1/prices.');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const addToList = async () => {
    if (busy || !info) return;
    setBusy(true);
    try {
      await upsertModels([
        {
          id: modelId,
          displayName: info.displayName ?? null,
          inputPrice: info.input,
          outputPrice: info.output,
          imagePrice: info.image,
          discountPct: discount,
          vision: info.vision,
          imageGen: info.imageGen,
          source: 'manual',
          updatedAt: Date.now(),
        },
      ]);
      setInList(true);
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = () => {
    showDialog({
      title: 'Hapus dari daftar',
      message: `Model "${modelId}" dihapus dari daftar model.`,
      actions: [
        { label: 'Batal', style: 'cancel' },
        {
          label: 'Hapus',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (isDefault) {
                await saveDefaultModel(null);
                setIsDefault(false);
              }
              await removeModel(modelId);
              setInList(false);
            })();
          },
        },
      ],
    });
  };

  const makeDefault = async () => {
    if (busy || !inList) return;
    setBusy(true);
    try {
      await saveDefaultModel(modelId);
      setIsDefault(true);
    } finally {
      setBusy(false);
    }
  };

  const factor = 1 - discount / 100;
  // Effective prices: live market ask (net of discount) when available, else
  // reference price × the URL's min-discount floor.
  const effIn = market?.input ?? (info ? info.input * factor : 0);
  const effOut = market?.output ?? (info ? info.output * factor : 0);
  const effImage = market?.image ?? (info ? info.image * factor : 0);
  const marketDiscount = market?.discountPct ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: 'Detail model' }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        {inList === null ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 80 }}>
            <ActivityIndicator color={colors.textSecondary} />
          </View>
        ) : error && !info ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 60 }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>Gagal memuat</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
              {error}
            </Text>
          </View>
        ) : (
          <>
            {/* Identity */}
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>
                {info?.displayName ?? modelId}
              </Text>
              <Text
                selectable
                style={{ color: colors.textSecondary, fontSize: 13, fontFamily: 'monospace' }}>
                {modelId}
              </Text>
              {info ? <CapabilityBadges vision={info.vision} imageGen={info.imageGen} /> : null}
              {inList ? (
                <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
                  <View
                    style={{
                      backgroundColor: colors.accent,
                      borderRadius: 6,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      alignSelf: 'flex-start',
                    }}>
                    <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}>DI DAFTAR</Text>
                  </View>
                  {isDefault ? (
                    <View
                      style={{
                        backgroundColor: colors.backgroundElement,
                        borderRadius: 6,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        alignSelf: 'flex-start',
                      }}>
                      <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>DEFAULT</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>

            {/* Prices */}
            <View
              style={{
                backgroundColor: colors.backgroundElement,
                borderRadius: 12,
                borderCurve: 'continuous',
                padding: 14,
                gap: 6,
              }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
                Harga &amp; estimasi
              </Text>
              {info && info.imageGen && effImage > 0 ? (
                <>
                  <Text style={{ color: colors.text, fontSize: 15 }}>
                    {formatUsd(effImage)} per gambar dihasilkan
                  </Text>
                  {marketDiscount != null && market?.image != null ? (
                    <Text style={{ color: colors.accent, fontSize: 13 }}>
                      {`Harga pasar saat ini · diskon tertinggi on offer: −${formatPct(marketDiscount)}`}
                    </Text>
                  ) : discount > 0 ? (
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {`Estimasi dari harga referensi × diskon min${discount}`}
                    </Text>
                  ) : null}
                  <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
                    Kirim prompt teks di chat — model ini menghasilkan gambar, bukan teks.
                  </Text>
                </>
              ) : info && (effIn > 0 || effOut > 0) ? (
                <>
                  <Text style={{ color: colors.text, fontSize: 15 }}>
                    {formatUsd(effIn)} in · {formatUsd(effOut)} out per 1 jt token
                  </Text>
                  {marketDiscount != null && (market?.input != null || market?.output != null) ? (
                    <Text style={{ color: colors.accent, fontSize: 13 }}>
                      {`Harga pasar saat ini · diskon tertinggi on offer: −${formatPct(marketDiscount)}`}
                    </Text>
                  ) : discount > 0 ? (
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {`Estimasi dari harga referensi × diskon min${discount}`}
                    </Text>
                  ) : null}
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                    {`1rb token masuk ≈ ${formatUsd((1000 / 1e6) * effIn)} · 1rb keluar ≈ ${formatUsd((1000 / 1e6) * effOut)}`}
                  </Text>
                </>
              ) : (
                <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
                  Harga belum tersedia untuk model ini.
                </Text>
              )}
            </View>

            {error ? (
              <Text style={{ color: colors.error, fontSize: 13, lineHeight: 19 }}>{error}</Text>
            ) : null}

            {/* Actions */}
            {inList ? (
              <View style={{ gap: 10 }}>
                {isDefault ? null : (
                  <Pressable
                    onPress={makeDefault}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Jadikan model default"
                    style={({ pressed }) => ({
                      backgroundColor: colors.backgroundElement,
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 48,
                      borderRadius: 12,
                      borderCurve: 'continuous',
                      opacity: pressed || busy ? 0.7 : 1,
                    })}>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
                      Jadikan model default
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={confirmRemove}
                  accessibilityRole="button"
                  accessibilityLabel="Hapus dari daftar"
                  style={({ pressed }) => ({
                    backgroundColor: colors.backgroundElement,
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 48,
                    borderRadius: 12,
                    borderCurve: 'continuous',
                    opacity: pressed ? 0.7 : 1,
                  })}>
                  <Text style={{ color: colors.error, fontSize: 15, fontWeight: '600' }}>
                    Hapus dari daftar
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={addToList}
                disabled={busy || !info}
                accessibilityRole="button"
                accessibilityLabel="Tambah ke daftar model"
                style={({ pressed }) => ({
                  backgroundColor: colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 48,
                  borderRadius: 12,
                  borderCurve: 'continuous',
                  opacity: pressed || busy || !info ? 0.7 : 1,
                })}>
                <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '700' }}>Tambah ke daftar</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
