import { Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

interface CapabilityBadgesProps {
  vision: boolean;
  imageGen: boolean;
  /** Compact badges for list rows. */
  size?: 'small' | 'normal';
}

const LABELS = {
  vision: 'VISION',
  imageGen: 'IMAGE GEN',
} as const;

/**
 * Capability badges derived from the public /v1/models catalog:
 * VISION = model accepts image input, IMAGE GEN = model generates images.
 */
export function CapabilityBadges({ vision, imageGen, size = 'normal' }: CapabilityBadgesProps) {
  const colors = useTheme();
  if (!vision && !imageGen) return null;
  const small = size === 'small';
  const items: Array<keyof typeof LABELS> = [
    ...(vision ? (['vision'] as const) : []),
    ...(imageGen ? (['imageGen'] as const) : []),
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {items.map((key) => (
        <View
          key={key}
          style={{
            backgroundColor: key === 'imageGen' ? `${colors.accent}22` : colors.backgroundElement,
            borderColor: key === 'imageGen' ? colors.accent : colors.border,
            borderWidth: 1,
            borderRadius: small ? 4 : 5,
            paddingHorizontal: small ? 5 : 6,
            paddingVertical: small ? 1 : 2,
            alignSelf: 'flex-start',
          }}>
          <Text
            style={{
              color: key === 'imageGen' ? colors.accent : colors.textSecondary,
              fontSize: small ? 9 : 10,
              fontWeight: '700',
              letterSpacing: 0.5,
            }}>
            {LABELS[key]}
          </Text>
        </View>
      ))}
    </View>
  );
}
