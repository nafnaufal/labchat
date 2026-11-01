import { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showDialog } from '@/components/ui/dialog';
import { Icon, type IconName } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeTime, formatUsd } from '@/lib/format';
import type { Conversation } from '@/lib/types';

const PANEL_WIDTH = 320;

export type AppSection = 'chat' | 'browse' | 'settings';

const NAV_ITEMS: Array<{ key: AppSection; label: string; icon: IconName }> = [
  { key: 'chat', label: 'Chat', icon: 'chat' },
  { key: 'browse', label: 'Cari Model', icon: 'search' },
  { key: 'settings', label: 'Setelan', icon: 'settings' },
];

interface AppDrawerProps {
  visible: boolean;
  activeSection: AppSection;
  conversations: Conversation[];
  /** Conversation currently open in the Chat screen, for the active highlight. */
  activeConversationId: string | null;
  onClose: () => void;
  onNavigate: (section: AppSection) => void;
  onSelectConversation: (conversation: Conversation) => void;
  onNewChat: () => void;
  onDeleteConversation: (conversation: Conversation) => void;
}

/** ChatGPT-style left drawer: new-chat button + conversation history + section nav at the bottom. */
export function AppDrawer({
  visible,
  activeSection,
  conversations,
  activeConversationId,
  onClose,
  onNavigate,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
}: AppDrawerProps) {
  const colors = useTheme();
  const { top, bottom } = useSafeAreaInsets();
  const translateX = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    translateX.setValue(-PANEL_WIDTH);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateX, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [visible, translateX, backdropOpacity]);

  // ---- Leftward swipe on the panel closes the drawer ----
  const closeTouchRef = useRef<{ startX: number; startY: number }>({ startX: 0, startY: 0 });

  const onPanelTouchStart = useCallback((e: GestureResponderEvent) => {
    closeTouchRef.current = { startX: e.nativeEvent.pageX, startY: e.nativeEvent.pageY };
  }, []);

  const onPanelTouchEnd = useCallback(
    (e: GestureResponderEvent) => {
      const dx = e.nativeEvent.pageX - closeTouchRef.current.startX;
      const dy = Math.abs(e.nativeEvent.pageY - closeTouchRef.current.startY);
      if (dx < -48 && Math.abs(dx) > dy * 1.5) {
        onClose();
      }
    },
    [onClose]
  );

  const confirmDelete = (conversation: Conversation) => {
    showDialog({
      title: 'Hapus percakapan',
      message: 'Percakapan dan semua pesannya akan dihapus.',
      actions: [
        { label: 'Batal', style: 'cancel' },
        {
          label: 'Hapus',
          style: 'destructive',
          onPress: () => onDeleteConversation(conversation),
        },
      ],
    });
  };

  const renderRow = ({ item }: { item: Conversation }) => {
    const active = item.id === activeConversationId;
    const meta: string[] = [formatRelativeTime(item.updatedAt)];
    if (item.messageCount) meta.push(`${item.messageCount} pesan`);
    if (item.totalCost != null && item.totalCost > 0) meta.push(`~${formatUsd(item.totalCost)}`);
    return (
      <Pressable
        onPress={() => onSelectConversation(item)}
        onLongPress={() => confirmDelete(item)}
        accessibilityRole="button"
        accessibilityLabel={`Buka percakapan ${item.title ?? 'tanpa judul'}`}
        style={({ pressed }) => ({
          paddingHorizontal: 16,
          paddingVertical: 10,
          gap: 2,
          backgroundColor: active
            ? colors.backgroundElement
            : pressed
              ? colors.backgroundElement
              : undefined,
          borderLeftWidth: 3,
          borderLeftColor: active ? colors.accent : 'transparent',
        })}>
        <Text
          numberOfLines={1}
          style={{ color: colors.text, fontSize: 15, fontWeight: active ? '700' : '500' }}>
          {item.title ?? 'Chat baru'}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>
          {meta.join(' · ')}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
        <View style={{ flex: 1 }}>
          {/* Backdrop fills the whole screen and sits below the panel. */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              opacity: backdropOpacity,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Tutup menu"
              style={{ flex: 1 }}
            />
          </Animated.View>
          {/* Panel pinned to the LEFT edge; translateX(-PANEL_WIDTH) starts it off-screen. */}
            <Animated.View
              onTouchStart={onPanelTouchStart}
              onTouchEnd={onPanelTouchEnd}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: PANEL_WIDTH,
                maxWidth: '85%',
                backgroundColor: colors.background,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderRightColor: colors.border,
                paddingTop: top,
                paddingBottom: bottom,
                transform: [{ translateX }],
              }}>
          {/* Header + new chat */}
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 14,
              paddingBottom: 12,
              gap: 12,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: colors.border,
            }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>LabChat</Text>
            <Pressable
              onPress={onNewChat}
              accessibilityRole="button"
              accessibilityLabel="Chat baru"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                height: 44,
                borderRadius: 22,
                borderCurve: 'continuous',
                backgroundColor: colors.accent,
                opacity: pressed ? 0.85 : 1,
              })}>
              <Icon name="plus" size={18} color="#ffffff" />
              <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '700' }}>Chat baru</Text>
            </Pressable>
          </View>

          {/* History */}
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={renderRow}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={25}
            maxToRenderPerBatch={25}
            windowSize={5}
            removeClippedSubviews
            contentContainerStyle={{ paddingBottom: 16 }}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', gap: 8, paddingTop: 48, paddingHorizontal: 24 }}>
                <Icon name="chat" size={32} color={colors.textSecondary} />
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Belum ada percakapan</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
                  Chat yang kamu kirim akan muncul di sini.
                </Text>
              </View>
            }
            ItemSeparatorComponent={() => (
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
            )}
          />

          {/* Section nav at the bottom */}
          <View
            style={{
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
            }}>
            {NAV_ITEMS.map((item) => {
              const active = item.key === activeSection;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => onNavigate(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingHorizontal: 16,
                    height: 48,
                    backgroundColor: active
                      ? colors.backgroundElement
                      : pressed
                        ? colors.backgroundElement
                        : undefined,
                    borderLeftWidth: 3,
                    borderLeftColor: active ? colors.accent : 'transparent',
                  })}>
                  <Icon name={item.icon} size={20} color={active ? colors.accent : colors.textSecondary} />
                  <Text
                    style={{
                      color: active ? colors.text : colors.textSecondary,
                      fontSize: 15,
                      fontWeight: active ? '700' : '500',
                    }}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
        </View>
    </Modal>
  );
}
