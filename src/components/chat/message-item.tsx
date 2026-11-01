import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Modal, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Markdown } from '@/components/markdown';
import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';
import { formatTokens, formatUsd } from '@/lib/format';
import type { Message } from '@/lib/types';

interface MessageItemProps {
  message: Message;
  /** True while this message is being streamed — shows a cursor instead of meta info. */
  streaming?: boolean;
  /** User messages: long-press rewinds this prompt in place. */
  onRewind?: (message: Message) => void;
  /** Assistant messages: branch everything up to and including this reply. */
  onBranch?: (message: Message) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  streaming,
  onRewind,
  onBranch,
}: MessageItemProps) {
  const colors = useTheme();
  const [copied, setCopied] = useState(false);
  const [viewerPath, setViewerPath] = useState<string | null>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { top: safeTop } = useSafeAreaInsets();

  const copy = async () => {
    await Clipboard.setStringAsync(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Images are decoded at native resolution — cap the viewer bubble so a long
  // chat with many attachments can't pile up full-size bitmaps in RAM.
  const size = message.imagePaths.length > 1 ? 112 : 200;
  const images =
    message.imagePaths.length > 0 ? (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: 220 }}>
        {message.imagePaths.map((path) => (
          <MessageImage
            key={path}
            path={path}
            size={size}
            onPress={() => setViewerPath(path)}
          />
        ))}
      </View>
    ) : null;

  if (message.role === 'user') {
    return (
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Pressable
          onLongPress={() => onRewind?.(message)}
          onPress={() => {}}
          delayLongPress={350}
          accessibilityLabel="Pesan kamu — tekan lama untuk rewind"
          style={({ pressed }) => ({
            backgroundColor: pressed ? colors.backgroundSelected : colors.backgroundElement,
            borderRadius: 20,
            borderCurve: 'continuous',
            paddingVertical: message.content ? 10 : 6,
            paddingHorizontal: message.content ? 14 : 6,
            maxWidth: '85%',
            gap: 8,
          })}>
          {images}
          {message.content ? (
            // Not selectable: Android's text-selection handler would swallow the
            // long-press meant for rewind. The text is still recoverable via rewind.
            <Text style={{ color: colors.text, fontSize: 16, lineHeight: 23 }}>
              {message.content}
            </Text>
          ) : null}
        </Pressable>
      </View>
    );
  }

  // Streaming message: markdown is re-parsed on every token, so use the cheap
  // plain-text bubble until the stream settles. Props are by-value-equal, so
  // memo skips every row whose message object didn't change.
  // Max 10 lines rendered while streaming to bound Text layout memory.
  if (streaming) {
    return (
      <View style={{ gap: 6 }}>
        <Text
          numberOfLines={10}
          style={{ color: colors.text, fontSize: 16, lineHeight: 23 }}>
          {message.content}
        </Text>
        <Text style={{ color: colors.accent, fontSize: 16, lineHeight: 20, marginTop: -4 }}>▍</Text>
      </View>
    );
  }

  const meta: string[] = [];
  if (message.modelId) meta.push(message.modelId);
  if (message.inputTokens != null || message.outputTokens != null) {
    const inTok = message.inputTokens != null ? formatTokens(message.inputTokens) : '?';
    const outTok = message.outputTokens != null ? formatTokens(message.outputTokens) : '?';
    meta.push(`${inTok} masuk · ${outTok} keluar`);
  }
  if (message.cost != null && message.cost > 0) meta.push(`~${formatUsd(message.cost)}`);

  const empty = message.content.trim() === '' && message.imagePaths.length === 0;

  return (
    <View style={{ gap: 6 }}>
      {images}
      {message.content.trim() === '' ? null : (
        <>
          <Markdown text={message.content} />
        </>
      )}
      {!streaming && !empty ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {meta.length > 0 ? (
            <Text
              selectable
              style={{
                color: colors.textSecondary,
                fontSize: 11,
                flex: 1,
                fontVariant: ['tabular-nums'],
              }}>
              {meta.join(' · ')}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {message.content ? (
            <Pressable onPress={copy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Salin pesan">
              <Icon name={copied ? 'check' : 'copy'} size={15} color={copied ? colors.success : colors.textSecondary} />
            </Pressable>
          ) : null}
          {onBranch ? (
            <Pressable onPress={() => onBranch(message)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Branch dari balasan ini">
              <Icon name="branch" size={15} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Fullscreen image viewer */}
      <Modal visible={viewerPath !== null} transparent animationType="fade" onRequestClose={() => setViewerPath(null)}>
        <Pressable
          onPress={() => setViewerPath(null)}
          accessibilityRole="button"
          accessibilityLabel="Tutup gambar"
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          <Image
            source={{ uri: viewerPath ?? undefined }}
            style={{ width: screenWidth, height: screenHeight * 0.8 }}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={viewerPath ?? undefined}
          />
          <View
            style={{
              position: 'absolute',
              top: safeTop + 12,
              right: 16,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.15)',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon name="close" size={20} color="#ffffff" />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
});

function MessageImage({ path, size, onPress }: { path: string; size: number; onPress: () => void }) {
  const colors = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Lihat gambar">
      <Image
        source={{ uri: path }}
        style={{
          width: size,
          height: size,
          borderRadius: 14,
          borderCurve: 'continuous',
          backgroundColor: colors.border,
        }}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={path}
        transition={120}
      />
    </Pressable>
  );
}
