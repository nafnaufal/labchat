import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

export interface DialogAction {
  label: string;
  style?: 'default' | 'destructive' | 'cancel';
  onPress?: () => void;
}

export interface DialogRequest {
  title?: string;
  message?: string;
  /** Defaults to a single "OK" row when omitted. */
  actions?: DialogAction[];
}

let push: ((req: DialogRequest) => void) | null = null;

/**
 * Themed drop-in replacement for Alert.alert — imperative, so existing call sites
 * only change name and prop names. Renders through the single <DialogHost /> in
 * the root layout.
 */
export function showDialog(req: DialogRequest): void {
  push?.(req);
}

/** Mount once, near the root of the tree. */
export function DialogHost() {
  const colors = useTheme();
  const { top, bottom } = useSafeAreaInsets();
  const [req, setReq] = useState<DialogRequest | null>(null);

  useEffect(() => {
    push = setReq;
    return () => {
      push = null;
    };
  }, []);

  if (!req) return null;

  const actions: DialogAction[] =
    req.actions && req.actions.length > 0 ? req.actions : [{ label: 'OK' }];
  const cancelAction = actions.find((action) => action.style === 'cancel');

  // Dismiss first, then run — same sequencing as the native Alert.
  const run = (action: DialogAction) => {
    setReq(null);
    action.onPress?.();
  };
  const dismiss = () => run(cancelAction ?? { label: '' });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable
        onPress={dismiss}
        accessibilityLabel="Tutup dialog"
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.55)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: top,
          paddingBottom: bottom,
        }}>
        <View
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: 340,
            marginHorizontal: 32,
            backgroundColor: colors.background,
            borderRadius: 20,
            borderCurve: 'continuous',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            overflow: 'hidden',
          }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 6 }}>
            {req.title ? (
              <Text
                style={{
                  color: colors.text,
                  fontSize: 17,
                  fontWeight: '700',
                  textAlign: 'center',
                }}>
                {req.title}
              </Text>
            ) : null}
            {req.message ? (
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 14,
                  lineHeight: 20,
                  textAlign: 'center',
                }}>
                {req.message}
              </Text>
            ) : null}
          </View>

          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />

          {actions.map((action, index) => (
            <View key={action.label}>
              {index > 0 ? (
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
              ) : null}
              <Pressable
                onPress={() => run(action)}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => ({
                  minHeight: 46,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: pressed ? colors.backgroundElement : undefined,
                })}>
                <Text
                  style={{
                    color:
                      action.style === 'destructive'
                        ? colors.error
                        : action.style === 'cancel'
                          ? colors.textSecondary
                          : colors.text,
                    fontSize: 15,
                    fontWeight: '600',
                    textAlign: 'center',
                  }}>
                  {action.label}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}
