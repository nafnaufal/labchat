import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

interface PromptModalProps {
  visible: boolean;
  title: string;
  initial: string;
  placeholder?: string;
  hint?: string;
  onSave: (value: string) => void;
  onClose: () => void;
}

/** Full-screen editor for a system prompt / custom instructions. */
export function PromptModal({
  visible,
  title,
  initial,
  placeholder,
  hint,
  onSave,
  onClose,
}: PromptModalProps) {
  const colors = useTheme();
  const { top, bottom } = useSafeAreaInsets();
  const [value, setValue] = useState(initial);

  // Reset the draft each time the sheet opens.
  const onShow = () => setValue(initial);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={onShow}>
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: top + 8,
          paddingBottom: bottom,
        }}>
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
            <Text style={{ color: colors.textSecondary, fontSize: 16 }}>Batal</Text>
          </Pressable>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
          <Pressable
            onPress={() => onSave(value)}
            hitSlop={8}
            style={{ paddingHorizontal: 8, paddingVertical: 10 }}>
            <Text style={{ color: colors.accent, fontSize: 16, fontWeight: '700' }}>Simpan</Text>
          </Pressable>
        </View>
        <TextInput
          value={value}
          onChangeText={setValue}
          multiline
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          textAlignVertical="top"
          style={{
            flex: 1,
            color: colors.text,
            fontSize: 15,
            lineHeight: 22,
            padding: 16,
            backgroundColor: colors.background,
          }}
        />
        {hint ? (
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 12,
              lineHeight: 18,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}>
            {hint}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}
