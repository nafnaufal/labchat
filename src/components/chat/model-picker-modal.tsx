import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { CapabilityBadges } from '@/components/ui/capability-badges';
import { useTheme } from '@/hooks/use-theme';
import { formatUsd, priceSummary } from '@/lib/format';
import type { ModelInfo } from '@/lib/types';

interface ModelPickerModalProps {
  visible: boolean;
  title?: string;
  models: ModelInfo[];
  selectedId: string | null;
  /** Shows an extra "none" row that calls onSelect(null) — for clearing a default. */
  allowNone?: boolean;
  noneLabel?: string;
  onSelect: (model: ModelInfo | null) => void;
  onClose: () => void;
}

/** Full-screen modal listing the user's saved models. Plain RN Modal — no native sheet. */
export function ModelPickerModal({
  visible,
  title = 'Pilih model',
  models,
  selectedId,
  allowNone = false,
  noneLabel = 'Tanpa model default',
  onSelect,
  onClose,
}: ModelPickerModalProps) {
  const colors = useTheme();
  const { top, bottom } = useSafeAreaInsets();

  const renderRow = ({ item }: { item: ModelInfo }) => {
    const selected = item.id === selectedId;
    return (
      <Pressable
        onPress={() => onSelect(item)}
        accessibilityRole="button"
        accessibilityLabel={`Pilih model ${item.displayName ?? item.id}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: pressed ? colors.backgroundElement : undefined,
        })}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{ color: colors.text, fontSize: 15, fontWeight: selected ? '700' : '400' }}>
            {item.displayName ?? item.id}
          </Text>
          {item.displayName ? (
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, fontFamily: 'monospace' }}>
              {item.id}
            </Text>
          ) : null}
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {item.imageGen
              ? item.imagePrice > 0
                ? `${formatUsd(item.imagePrice)} /gambar`
                : 'Model gambar'
              : priceSummary(item.inputPrice, item.outputPrice)}
          </Text>
          <CapabilityBadges vision={item.vision} imageGen={item.imageGen} size="small" />
        </View>
        {selected ? <Icon name="check" size={20} color={colors.accent} /> : null}
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: top, paddingBottom: bottom }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 8,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}>
          <Pressable onPress={onClose} hitSlop={8} style={{ paddingHorizontal: 8, paddingVertical: 10 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 16 }}>Tutup</Text>
          </Pressable>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
          <View style={{ width: 60 }} />
        </View>

        {models.length === 0 && !allowNone ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>
            <Icon name="models" size={40} color={colors.textSecondary} />
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Belum ada model</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 21 }}>
              Buka tab Cari Model, lalu ketuk tombol + untuk menambahkan model ke daftar.
            </Text>
          </View>
        ) : (
          <FlatList
            data={models}
            keyExtractor={(item) => item.id}
            renderItem={renderRow}
            contentContainerStyle={{ paddingBottom: 24 }}
            ListHeaderComponent={
              allowNone
                ? () => (
                    <Pressable
                      onPress={() => onSelect(null)}
                      accessibilityRole="button"
                      accessibilityLabel={noneLabel}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        backgroundColor: pressed ? colors.backgroundElement : undefined,
                      })}>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: colors.text,
                            fontSize: 15,
                            fontWeight: selectedId === null ? '700' : '400',
                          }}>
                          {noneLabel}
                        </Text>
                      </View>
                      {selectedId === null ? <Icon name="check" size={20} color={colors.accent} /> : null}
                    </Pressable>
                  )
                : undefined
            }
            ItemSeparatorComponent={() => <Separator color={colors.border} />}
          />
        )}
      </View>
    </Modal>
  );
}

function Separator({ color }: { color: string }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color }} />;
}
