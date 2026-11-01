import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

interface ScreenHeaderProps {
  title: string;
  /** Optional leading element (e.g. the drawer button). */
  leading?: ReactNode;
  actions?: ReactNode;
}

/** Minimal top bar for tab screens — the app's own look, no native stack header. */
export function ScreenHeader({ title, leading, actions }: ScreenHeaderProps) {
  const colors = useTheme();
  const { top } = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: top + 8,
        paddingHorizontal: 8,
        paddingBottom: 10,
        backgroundColor: colors.background,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}>
      {leading}
      <ThemedText
        type="smallBold"
        style={{ fontSize: 22, lineHeight: 28, flex: 1, marginLeft: leading ? 0 : 8 }}
        numberOfLines={1}>
        {title}
      </ThemedText>
      {actions}
    </View>
  );
}
