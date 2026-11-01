import { useCallback, useRef, useState, type RefObject } from 'react';
import { View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppDrawer, type AppSection } from '@/components/app-drawer';
import { BrowseScreen } from '@/screens/browse';
import { ChatScreen, type ChatScreenHandle } from '@/screens/chat';
import { SettingsScreen } from '@/screens/settings';
import { deleteConversation, listConversations } from '@/lib/db';
import type { Conversation } from '@/lib/types';

/** Width of the invisible left-edge zone that accepts swipe-to-open. */
const EDGE_FRACTION = 0.5;
/** Minimum rightward distance (px) for a swipe to trigger the drawer. */
const SWIPE_THRESHOLD = 48;

/**
 * Owns the app's single-screen navigation: the three sections are swapped in place
 * (all stay mounted so chat state survives switching), and the left drawer carries
 * the section nav plus chat history. Replaces the old bottom NativeTabs.
 */
export function AppShell() {
  const [section, setSection] = useState<AppSection>('chat');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const chatRef = useRef<ChatScreenHandle>(null);
  const { top } = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const refreshConversations = useCallback(async () => {
    setConversations(await listConversations());
  }, []);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    void refreshConversations();
  }, [refreshConversations]);

  // ---- Edge-swipe open: raw onTouch* events on the outer View ----
  // These fire before any child responder claims the touch, so they're
  // guaranteed to see the initial position even when a FlatList is below.
  const touchRef = useRef<{ startX: number; startY: number; valid: boolean }>({
    startX: 0,
    startY: 0,
    valid: false,
  });

  const onTouchStart = useCallback(
    (e: GestureResponderEvent) => {
      if (drawerOpen) return;
      const { pageX, pageY } = e.nativeEvent;
      // Only track touches that start in the left half of the screen, below the header.
      touchRef.current = {
        startX: pageX,
        startY: pageY,
        valid: pageX <= screenWidth * EDGE_FRACTION && pageY > top + 56,
      };
    },
    [drawerOpen, screenWidth, top]
  );

  const onTouchEnd = useCallback(
    (e: GestureResponderEvent) => {
      const t = touchRef.current;
      if (!t.valid) return;
      const dx = e.nativeEvent.pageX - t.startX;
      const dy = Math.abs(e.nativeEvent.pageY - t.startY);
      if (dx > SWIPE_THRESHOLD && dx > dy * 1.5) {
        openDrawer();
      }
      touchRef.current.valid = false;
    },
    [openDrawer]
  );

  const navigate = useCallback((target: AppSection) => {
    setDrawerOpen(false);
    setSection(target);
  }, []);

  const selectConversation = useCallback(
    (conversation: Conversation) => {
      setDrawerOpen(false);
      setSection('chat');
      if (conversation.id !== activeConversationId) {
        chatRef.current?.openConversation(conversation.id);
      }
    },
    [activeConversationId]
  );

  const startNewChat = useCallback(() => {
    setDrawerOpen(false);
    setSection('chat');
    chatRef.current?.newChat();
  }, []);

  const deleteConversationFromDrawer = useCallback(
    (conversation: Conversation) => {
      void (async () => {
        await deleteConversation(conversation.id);
        if (conversation.id === activeConversationId) {
          chatRef.current?.conversationDeleted(conversation.id);
        }
        await refreshConversations();
      })();
    },
    [activeConversationId, refreshConversations]
  );

  return (
    <View style={{ flex: 1 }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Sections stay mounted; the inactive ones are hidden so state survives switching. */}
      <View style={{ flex: 1, display: section === 'chat' ? 'flex' : 'none' }}>
        <ChatScreen
          ref={chatRef as RefObject<ChatScreenHandle>}
          active={section === 'chat'}
          onOpenDrawer={openDrawer}
          onConversationChanged={setActiveConversationId}
        />
      </View>
      <View style={{ flex: 1, display: section === 'browse' ? 'flex' : 'none' }}>
        <BrowseScreen active={section === 'browse'} onOpenDrawer={openDrawer} />
      </View>
      <View style={{ flex: 1, display: section === 'settings' ? 'flex' : 'none' }}>
        <SettingsScreen active={section === 'settings'} onOpenDrawer={openDrawer} />
      </View>

      <AppDrawer
        visible={drawerOpen}
        activeSection={section}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onClose={() => setDrawerOpen(false)}
        onNavigate={navigate}
        onSelectConversation={selectConversation}
        onNewChat={startNewChat}
        onDeleteConversation={deleteConversationFromDrawer}
      />
    </View>
  );
}
