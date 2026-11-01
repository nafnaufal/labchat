import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';
import type { PickedImage } from '@/lib/images';

interface ChatInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** Attach handler — only passed when the active model accepts image input. */
  onAttachImage?: () => void;
  onRemoveImage: (index: number) => void;
  pendingImages: PickedImage[];
  maxImages: number;
  /** True when the active model generates images (send = generate from prompt). */
  imageGenMode: boolean;
  busy: boolean;
  pickingImage: boolean;
}

export function ChatInput({
  value,
  onChangeText,
  onSend,
  onStop,
  onAttachImage,
  onRemoveImage,
  pendingImages,
  maxImages,
  imageGenMode,
  busy,
  pickingImage,
}: ChatInputProps) {
  const colors = useTheme();
  const { bottom } = useSafeAreaInsets();

  const canSend = !busy && (value.trim().length > 0 || pendingImages.length > 0);

  return (
    <KeyboardAvoidingView
      // 'padding' on Android too: edge-to-edge (default since SDK 54) means the window
      // no longer resizes for the keyboard, so we must lift the bar ourselves.
      behavior="padding"
      style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
      {/* Pending image previews */}
      {pendingImages.length > 0 ? (
        <View
          style={{
            marginHorizontal: 12,
            marginTop: 8,
            padding: 8,
            borderRadius: 12,
            borderCurve: 'continuous',
            backgroundColor: colors.backgroundElement,
            gap: 6,
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
              {`${pendingImages.length} gambar terlampir`}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
              {`maks ${maxImages}`}
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}>
            {pendingImages.map((image, index) => (
              <View key={`${index}-${image.width}x${image.height}`}>
                <Image
                  source={{ uri: `data:image/jpeg;base64,${image.base64}` }}
                  style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: colors.border }}
                  contentFit="cover"
                />
                <Pressable
                  onPress={() => onRemoveImage(index)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Hapus gambar ${index + 1}`}
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: colors.background,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}>
                  <Icon name="close" size={12} color={colors.text} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: Math.max(bottom, 8) + 4,
        }}>
        {onAttachImage ? (
          <Pressable
            onPress={pickingImage ? undefined : onAttachImage}
            disabled={busy || pickingImage}
            accessibilityRole="button"
            accessibilityLabel="Lampirkan gambar"
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: colors.backgroundElement,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : busy || pickingImage ? 0.4 : 1,
            })}>
            {pickingImage ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Icon name="image" size={22} color={colors.textSecondary} />
            )}
          </Pressable>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          multiline
          placeholder={imageGenMode ? 'Deskripsi gambar yang mau dibuat…' : 'Tanya apa saja…'}
          placeholderTextColor={colors.textSecondary}
          style={{
            flex: 1,
            minHeight: 44,
            maxHeight: 120,
            backgroundColor: colors.backgroundElement,
            borderRadius: 22,
            borderCurve: 'continuous',
            paddingHorizontal: 16,
            paddingVertical: 11,
            paddingTop: 12,
            color: colors.text,
            fontSize: 16,
          }}
          editable={!busy}
        />
        <Pressable
          onPress={busy ? onStop : canSend ? onSend : undefined}
          disabled={!busy && !canSend}
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Hentikan jawaban' : 'Kirim pesan'}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : !busy && !canSend ? 0.4 : 1,
          })}>
          <Icon name={busy ? 'stop' : imageGenMode ? 'sparkle' : 'send'} size={22} color="#ffffff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
