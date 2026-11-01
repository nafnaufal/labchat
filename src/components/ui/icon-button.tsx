import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';

interface IconButtonProps {
  name: IconName;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function IconButton({
  name,
  onPress,
  color,
  disabled,
  style,
  accessibilityLabel,
}: IconButtonProps) {
  const colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? name}
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : disabled ? 0.35 : 1,
        },
        style,
      ]}>
      <Icon name={name} size={22} color={color ?? colors.text} />
    </Pressable>
  );
}
