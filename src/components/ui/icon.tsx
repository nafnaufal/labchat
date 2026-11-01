import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView } from 'expo-symbols';
import { type StyleProp, type ViewStyle } from 'react-native';

const ICONS = {
  send: { ios: 'arrow.up', md: 'arrow-upward' },
  stop: { ios: 'stop.fill', md: 'stop' },
  plus: { ios: 'plus', md: 'add' },
  trash: { ios: 'trash', md: 'delete' },
  copy: { ios: 'doc.on.doc', md: 'content-copy' },
  check: { ios: 'checkmark', md: 'check' },
  sync: { ios: 'arrow.clockwise', md: 'refresh' },
  chat: { ios: 'message', md: 'chat' },
  models: { ios: 'square.grid.2x2', md: 'category' },
  settings: { ios: 'gear', md: 'settings' },
  menu: { ios: 'ellipsis', md: 'more-vert' },
  minus: { ios: 'minus', md: 'remove' },
  chevronDown: { ios: 'chevron.down', md: 'keyboard-arrow-down' },
  back: { ios: 'chevron.left', md: 'arrow-back' },
  error: { ios: 'exclamationmark.triangle', md: 'error-outline' },
  database: { ios: 'externaldrive', md: 'storage' },
  search: { ios: 'magnifyingglass', md: 'search' },
  image: { ios: 'photo', md: 'image' },
  close: { ios: 'xmark', md: 'close' },
  sparkle: { ios: 'wand.and.stars', md: 'auto-awesome' },
  expand: { ios: 'arrow.up.left.and.arrow.down.right', md: 'open-in-full' },
  sidebar: { ios: 'sidebar.left', md: 'menu' },
  rewind: { ios: 'arrow.uturn.backward', md: 'replay' },
  branch: { ios: 'arrow.triangle.branch', md: 'call-split' },
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}

export function Icon({ name, size = 24, color, style }: IconProps) {
  const def = ICONS[name];
  if (process.env.EXPO_OS === 'ios') {
    return <SymbolView name={def.ios} tintColor={color} size={size} style={style} />;
  }
  return <MaterialIcons name={def.md} size={size} color={color as string} style={style} />;
}
