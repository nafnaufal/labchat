import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { CapabilityBadges } from '@/components/ui/capability-badges';
import { useTheme } from '@/hooks/use-theme';
import {
  effectiveMinDiscount,
  fetchModelCapabilities,
  fetchReferencePrices,
  getMarketMap,
  type MarketEntry,
  type ModelCapabilities,
} from '@/lib/api';
import { listModels, upsertModels } from '@/lib/db';
import { formatPct, formatUsd } from '@/lib/format';
import { loadSettings } from '@/lib/settings';

interface CatalogEntry {
  id: string;
  input: number;
  output: number;
  image: number;
  vision: boolean;
  imageGen: boolean;
  displayName?: string;
  /** Live order-book data — null when the model has no offers / the call failed. */
  market: MarketEntry | null;
}

interface BrowseScreenProps {
  /** True while this section is the active one. */
  active?: boolean;
  onOpenDrawer?: () => void;
}

/** Public catalog browser — search a model, add it to your list, open its detail. */
export function BrowseScreen({ active = false, onOpenDrawer }: BrowseScreenProps) {
  const router = useRouter();
  const colors = useTheme();
  const { bottom } = useSafeAreaInsets();
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [myIds, setMyIds] = useState<Set<string>>(new Set());
  const [discount, setDiscount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await loadSettings();
      // Prices, capabilities, and the live order book come from three public endpoints —
      // fetch in parallel, and keep working with whatever succeeds (market data is
      // optional: without it we fall back to reference prices × min-discount).
      const [pricesResult, capsResult, marketResult] = await Promise.allSettled([
        fetchReferencePrices(settings.baseUrl),
        fetchModelCapabilities(settings.baseUrl),
        getMarketMap(settings.baseUrl),
      ]);
      if (pricesResult.status === 'rejected') {
        throw pricesResult.reason instanceof Error
          ? pricesResult.reason
          : new Error(String(pricesResult.reason));
      }
      const caps: Map<string, ModelCapabilities> =
        capsResult.status === 'fulfilled' ? capsResult.value : new Map();
      const market: Map<string, MarketEntry> =
        marketResult.status === 'fulfilled' ? marketResult.value : new Map();
      const list: CatalogEntry[] = [...pricesResult.value.entries()].map(([id, price]) => {
        const cap = caps.get(id);
        return {
          id,
          input: price.input,
          output: price.output,
          image: price.image,
          vision: cap?.vision ?? false,
          imageGen: cap?.imageGen ?? false,
          displayName: price.displayName ?? cap?.displayName,
          market: market.get(id) ?? null,
        };
      });
      // Biggest discount first (nulls — no live offer — at the bottom), then by name.
      const discountOf = (entry: CatalogEntry) =>
        entry.market?.discountPct ?? entry.market?.bestDiscountPct ?? -1;
      list.sort((a, b) => {
        const byDiscount = discountOf(b) - discountOf(a);
        if (byDiscount !== 0) return byDiscount;
        return (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id);
      });
      setEntries(list);
      const eff = effectiveMinDiscount(settings.baseUrl, settings.minDiscount);
      setDiscount(eff);
      lastBaseUrlRef.current = settings.baseUrl;
      lastDiscountRef.current = eff;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Track which models are already in the user's list.
  const loadMyIds = useCallback(async () => {
    const models = await listModels();
    setMyIds(new Set(models.map((m) => m.id)));
  }, []);

  // Base URL the current listing was fetched with — the catalog follows origin
  // changes, while the fallback price lines only need the effective discount.
  const lastBaseUrlRef = useRef<string | null>(null);
  const lastDiscountRef = useRef(-1);

  // Reload when this section becomes active again and its settings changed while
  // hidden: new base URL → full catalog refresh; new discount → just re-render
  // the fallback price lines.
  useEffect(() => {
    if (!active) return;
    void (async () => {
      const settings = await loadSettings();
      const eff = effectiveMinDiscount(settings.baseUrl, settings.minDiscount);
      if (settings.baseUrl !== lastBaseUrlRef.current) {
        await load();
        return;
      }
      if (eff !== lastDiscountRef.current) {
        lastDiscountRef.current = eff;
        setDiscount(eff);
      }
      await loadMyIds();
    })();
  }, [active, load, loadMyIds]);

  useFocusEffect(
    useCallback(() => {
      loadMyIds();
    }, [loadMyIds])
  );

  const addToMyList = async (entry: CatalogEntry) => {
    if (myIds.has(entry.id)) return;
    await upsertModels([
      {
        id: entry.id,
        displayName: entry.displayName ?? null,
        inputPrice: entry.input,
        outputPrice: entry.output,
        imagePrice: entry.image,
        discountPct: discount,
        vision: entry.vision,
        imageGen: entry.imageGen,
        source: 'manual',
        updatedAt: Date.now(),
      },
    ]);
    setMyIds((prev) => {
      const next = new Set(prev);
      next.add(entry.id);
      return next;
    });
  };

  const openDetail = (entry: CatalogEntry) => {
    router.push({ pathname: '/model/[id]', params: { id: entry.id } });
  };

  const q = query.trim().toLowerCase();
  // Catalog is 500+ rows — memoize so typing doesn't re-filter on unrelated renders.
  const filtered = useMemo(
    () =>
      q && entries
        ? entries.filter(
            (entry) =>
              entry.id.toLowerCase().includes(q) || (entry.displayName ?? '').toLowerCase().includes(q)
          )
        : entries,
    [entries, q]
  );

  const renderRow = ({ item }: { item: CatalogEntry }) => {
    const inList = myIds.has(item.id);
    const factor = 1 - discount / 100;
    // Live market ask (net of discount) when available; otherwise reference × min-discount.
    const market = item.market;
    const marketDiscount = market?.discountPct ?? market?.bestDiscountPct ?? null;
    const isImageGenRow = item.imageGen && (market?.image ?? item.image) > 0;
    const priceText = isImageGenRow
      ? `${formatUsd(market?.image ?? item.image * factor)} /gambar`
      : `${formatUsd(market?.input ?? item.input * factor)} in · ${formatUsd(market?.output ?? item.output * factor)} out /1jt tok`;
    const fromMarket = isImageGenRow
      ? market?.image != null
      : market?.input != null || market?.output != null;
    return (
      <Pressable
        onPress={() => openDetail(item)}
        accessibilityRole="button"
        accessibilityLabel={`Detail model ${item.displayName ?? item.id}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: pressed ? colors.backgroundElement : undefined,
        })}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
            {item.displayName ?? item.id}
          </Text>
          {item.displayName ? (
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, fontFamily: 'monospace' }}>
              {item.id}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, flexShrink: 1 }}>
              {`${fromMarket ? '' : '≈'}${priceText}`}
            </Text>
            {marketDiscount != null && marketDiscount > 0 ? (
              <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>
                {`−${formatPct(marketDiscount)}`}
              </Text>
            ) : null}
          </View>
          <CapabilityBadges vision={item.vision} imageGen={item.imageGen} size="small" />
        </View>
        {inList ? (
          <Icon name="check" size={22} color={colors.accent} />
        ) : (
          <IconButton
            name="plus"
            onPress={() => addToMyList(item)}
            accessibilityLabel={`Tambah ${item.displayName ?? item.id} ke daftar`}
          />
        )}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="Cari Model"
        leading={
          onOpenDrawer ? (
            <IconButton name="sidebar" onPress={onOpenDrawer} color={colors.text} accessibilityLabel="Buka menu" />
          ) : undefined
        }
        actions={
          <IconButton name="sync" onPress={load} disabled={loading} accessibilityLabel="Muat ulang daftar model" />
        }
      />

      {/* Search */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 6 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.backgroundElement,
            borderRadius: 12,
            borderCurve: 'continuous',
            paddingHorizontal: 12,
          }}>
          <Icon name="search" size={18} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Cari nama model…"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 }}
          />
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17 }}>
          Ketuk + untuk menambahkan model ke daftar, atau ketuk barisnya untuk detail.
          Harga = ask termurah pasar saat ini (sudah net diskon), diurut dari diskon terbesar.
          Model tanpa penjual aktif memakai estimasi harga referensi (tanda ≈).
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>
          <Icon name="error" size={36} color={colors.textSecondary} />
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>Gagal memuat daftar model</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
            {error}
          </Text>
          <Pressable
            onPress={load}
            accessibilityRole="button"
            accessibilityLabel="Coba lagi"
            style={({ pressed }) => ({
              marginTop: 8,
              backgroundColor: colors.accent,
              paddingHorizontal: 20,
              height: 44,
              borderRadius: 22,
              borderCurve: 'continuous',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}>
            <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '700' }}>Coba lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filtered ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: 24 + bottom }}
          ItemSeparatorComponent={() => <Separator color={colors.border} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 48, gap: 8 }}>
              <Icon name="search" size={36} color={colors.textSecondary} />
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>Tidak ada hasil</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>
                {q ? `Tidak ada model yang cocok dengan “${query.trim()}”.` : 'Daftar model kosong.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function Separator({ color }: { color: string }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color, marginLeft: 16 }} />;
}
