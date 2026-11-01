import { FlatList, Keyboard, Pressable, Text, View } from 'react-native';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatInput } from '@/components/chat/chat-input';
import { MessageItem } from '@/components/chat/message-item';
import { ModelPickerModal } from '@/components/chat/model-picker-modal';
import { PromptModal } from '@/components/chat/prompt-modal';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { showDialog } from '@/components/ui/dialog';
import { useTheme } from '@/hooks/use-theme';
import {
  ApiError,
  chatCompletion,
  effectiveMinDiscount,
  generateImage,
  getMarketMap,
  type ApiContentPart,
  type ApiMessage,
  type MarketEntry,
} from '@/lib/api';
import {
  createConversation,
  deleteConversation,
  deleteMessagesAfter,
  getConversation,
  insertMessage,
  listMessages,
  listModels,
  touchConversation,
  uid,
  updateConversation,
} from '@/lib/db';
import { computeCost, computeMarketCost, estimateTokens } from '@/lib/format';
import { saveImageBase64 } from '@/lib/images';
import { buildSystemPrompt } from '@/lib/persona';
import { getApiKey, loadSettings } from '@/lib/settings';
import type { AppSettings, Conversation, Message, ModelInfo } from '@/lib/types';

const STREAMING_ID = '__streaming__';

export interface ChatScreenHandle {
  /** Open a conversation (no-op when already viewing it). */
  openConversation: (id: string) => void;
  /** Reset to a fresh, unsaved chat (keeps draft picks when already fresh). */
  newChat: () => void;
  /** Reset only when the deleted conversation is the one being viewed. */
  conversationDeleted: (id: string) => void;
}

interface ChatScreenProps {
  /** True while the Chat section is the active one. */
  active: boolean;
  onOpenDrawer: () => void;
  /** Notifies the shell whenever the open conversation changes (drawer highlight). */
  onConversationChanged: (id: string | null) => void;
}

/**
 * The Chat section. Opens as a fresh, unsaved chat — the conversation row is only
 * created in the database when the first message is sent. History + section nav
 * live in the shell's left drawer.
 */
export const ChatScreen = forwardRef<ChatScreenHandle, ChatScreenProps>(function ChatScreen(
  { active, onOpenDrawer, onConversationChanged },
  ref
) {
  const colors = useTheme();
  const { top } = useSafeAreaInsets();

  /** null = fresh chat that has not been persisted yet. */
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[] | null>([]);
  /** Synchronous mirror of `messages` for handlers invoked from a memoized row. */
  const messagesRef = useRef<Message[]>([]);

  const setMessagesTracked = useCallback((next: Message[] | null) => {
    messagesRef.current = next ?? [];
    setMessages(next);
  }, []);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  /** Model / system prompt chosen before the first message (fresh chat). */
  const [draftModelId, setDraftModelId] = useState<string | null>(null);
  const [draftSystemPrompt, setDraftSystemPrompt] = useState<string | null>(null);
  /**
   * Rewind target: the user message being revised. Sending while set deletes every
   * message after it in this same conversation and answers the revised prompt.
   */
  const [rewind, setRewind] = useState<{ messageId: string; text: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const stickToBottom = useRef(true);
  const settingsRef = useRef<AppSettings | null>(null);
  const modelsRef = useRef<ModelInfo[]>([]);
  /** Synchronous mirror of `conversation` for the async send/completion flow. */
  const conversationRef = useRef<Conversation | null>(null);
  /**
   * Set before `setConversationId` inside `send()` — the load effect skips one
   * fetch so it can't clobber state that send already set up (fresh chat, branch).
   */
  const skipLoadRef = useRef(false);

  const effectiveModelId =
    conversation?.modelId ?? draftModelId ?? settings?.defaultModelId ?? null;
  const activeModel = models.find((m) => m.id === effectiveModelId) ?? null;
  /** Image-generation models answer via /v1/images/generations instead of chat completions. */
  const isImageGenModel = activeModel?.imageGen ?? false;

  /** Appends only when still viewing the conversation the message belongs to. */
  const appendMessages = (incoming: Message | Message[]) => {
    const cid = conversationRef.current?.id;
    const items = Array.isArray(incoming) ? incoming : [incoming];
    if (!cid || items.some((m) => m.conversationId !== cid)) return;
    setMessages((prev) => {
      const next = [...(prev ?? []), ...items];
      messagesRef.current = next;
      return next;
    });
  };

  // Refresh models/settings whenever this section becomes active again — changes
  // made in Setelan (default model, base URL, custom instructions) apply immediately.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      const [mods, s] = await Promise.all([listModels(), loadSettings()]);
      if (cancelled) return;
      setModels(mods);
      setSettings(s);
      modelsRef.current = mods;
      settingsRef.current = s;
      // Warm the market-price cache so the first message's cost estimate doesn't stall.
      void getMarketMap(s.baseUrl).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  /** Live market prices for cost estimation; null → fall back to reference prices. */
  const lookupMarket = async (modelId: string): Promise<MarketEntry | null> => {
    if (!settingsRef.current) return null;
    try {
      return (await getMarketMap(settingsRef.current.baseUrl)).get(modelId) ?? null;
    } catch {
      return null;
    }
  };

  // Load the conversation's content whenever the target changes. Skipped once
  // when send() already set up the fresh/branch state itself.
  useEffect(() => {
    if (skipLoadRef.current) {
      skipLoadRef.current = false;
      return;
    }
    let cancelled = false;
    void (async () => {
      if (!conversationId) {
        conversationRef.current = null;
        setConversation(null);
        setMessages([]);
        return;
      }
      const [c, msgs] = await Promise.all([
        getConversation(conversationId),
        listMessages(conversationId),
      ]);
      if (cancelled) return;
      if (!c) {
        resetToNewChat();
        return;
      }
      conversationRef.current = c;
      setConversation(c);
      setMessagesTracked(msgs);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Keep the shell's active-conversation highlight in sync.
  useEffect(() => {
    onConversationChanged(conversationId);
  }, [conversationId, onConversationChanged]);

  const resetToNewChat = () => {
    abortRef.current?.abort();
    conversationRef.current = null;
    setConversationId(null);
    setConversation(null);
    setMessagesTracked([]);
    setStreamText(null);
    setError(null);
    setDraftModelId(null);
    setDraftSystemPrompt(null);
    setRewind(null);
  };

  const runCompletion = async (history: Message[]) => {
    if (!settingsRef.current || !effectiveModelId) return;
    const cid = conversationRef.current?.id;
    if (!cid) return;
    setBusy(true);
    setError(null);
    setStreamText('');
    const controller = new AbortController();
    abortRef.current = controller;
    let streamSoFar = '';

    try {
      const apiKey = await getApiKey();
      if (!apiKey) {
        throw new ApiError('API key belum disetel — buka tab Setelan untuk mengisinya.');
      }
      // System prompt stack: an explicit per-conversation prompt replaces the
      // persona entirely (the user asked for that chat to behave differently);
      // otherwise the persona harness + the user's custom instructions apply.
      const conversationPrompt = (conversationRef.current?.systemPrompt ?? draftSystemPrompt)?.trim();
      const systemPrompt = conversationPrompt
        ? conversationPrompt
        : buildSystemPrompt(settingsRef.current.customInstructions);
      const apiMessages: ApiMessage[] = [];
      if (systemPrompt) {
        apiMessages.push({ role: 'system', content: systemPrompt });
      }
      // Text-only: images are never attached to chat requests. The user's text
      // and assistant replies are sent as plain strings — the current model
      // rejects image/multimodal content parts with a 400 error.
      for (const message of history) {
        if (message.error) continue;
        apiMessages.push({ role: message.role, content: message.content });
      }

      // Discount is enforced by the min{N} setting (or URL segment) — used only for
      // the fallback estimate when live market prices are unavailable.
      const urlDiscount = effectiveMinDiscount(
        settingsRef.current.baseUrl,
        settingsRef.current.minDiscount
      );
      const stored = modelsRef.current.find((entry) => entry.id === effectiveModelId) ?? null;
      const model = stored ? { ...stored, discountPct: urlDiscount } : null;
      const result = await chatCompletion({
        baseUrl: settingsRef.current.baseUrl,
        apiKey,
        model: effectiveModelId,
        messages: apiMessages,
        stream: settingsRef.current.streaming,
        minDiscount: settingsRef.current.minDiscount,
        signal: controller.signal,
        onDelta: (delta) => {
          streamSoFar += delta;
          setStreamText(streamSoFar);
        },
      });

      let inputTokens = result.usage.inputTokens;
      let outputTokens = result.usage.outputTokens;
      if (inputTokens == null) {
        inputTokens = apiMessages.reduce((sum, m) => sum + estimateTokens(textOf(m.content)), 0);
      }
      if (outputTokens == null) {
        outputTokens = estimateTokens(result.content);
      }
      // Cost estimate: live market price (cheapest ask, net of discount) when the
      // model has one; otherwise reference price × the URL's min-discount floor.
      const market = await lookupMarket(effectiveModelId);
      const cost = market
        ? computeMarketCost(market.input, market.output, inputTokens, outputTokens)
        : computeCost(model, inputTokens, outputTokens);
      const assistantMessage: Message = {
        id: uid(),
        conversationId: cid,
        role: 'assistant',
        content: result.content,
        imagePaths: [],
        modelId: effectiveModelId,
        inputTokens,
        outputTokens,
        cost,
        error: false,
        createdAt: Date.now(),
      };
      await insertMessage(assistantMessage);
      await touchConversation(cid);
      appendMessages(assistantMessage);
    } catch (e) {
      const isAbort = e instanceof Error && e.name === 'AbortError';
      if (isAbort) {
        if (streamSoFar.trim()) {
          const partial: Message = {
            id: uid(),
            conversationId: cid,
            role: 'assistant',
            content: streamSoFar,
            imagePaths: [],
            modelId: effectiveModelId,
            inputTokens: null,
            outputTokens: null,
            cost: null,
            error: false,
            createdAt: Date.now(),
          };
          try {
            await insertMessage(partial);
            appendMessages(partial);
          } catch {
            // The conversation may have been deleted mid-stream — drop the partial.
          }
        }
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStreamText(null);
      setBusy(false);
      abortRef.current = null;
    }
  };

  /** Image-generation flow: POST /v1/images/generations, save the image(s) locally. */
  const runImageGeneration = async (prompt: string) => {
    if (!settingsRef.current || !effectiveModelId) return;
    const cid = conversationRef.current?.id;
    if (!cid) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const apiKey = await getApiKey();
      if (!apiKey) {
        throw new ApiError('API key belum disetel — buka tab Setelan untuk mengisinya.');
      }
      const urlDiscount = effectiveMinDiscount(
        settingsRef.current.baseUrl,
        settingsRef.current.minDiscount
      );
      const stored = modelsRef.current.find((entry) => entry.id === effectiveModelId) ?? null;
      const result = await generateImage({
        baseUrl: settingsRef.current.baseUrl,
        apiKey,
        model: effectiveModelId,
        prompt,
        minDiscount: settingsRef.current.minDiscount,
        signal: controller.signal,
      });
      const billed = result.imageCount ?? result.images.length;
      // Per-image cost: market price (net of discount) when available, else the
      // reference per-image price × the URL's min-discount floor.
      const market = await lookupMarket(effectiveModelId);
      const perImage =
        market?.image ??
        (stored && stored.imagePrice > 0 ? stored.imagePrice * (1 - urlDiscount / 100) : null);
      const cost = perImage != null && perImage > 0 ? perImage * billed : null;
      const created: Message[] = [];
      for (let i = 0; i < result.images.length; i++) {
        const path = await saveImageBase64(result.images[i], sniffImageExt(result.images[i]));
        created.push({
          id: uid(),
          conversationId: cid,
          role: 'assistant',
          content: '',
          imagePaths: [path],
          modelId: effectiveModelId,
          inputTokens: null,
          outputTokens: null,
          cost: i === 0 ? cost : null,
          error: false,
          createdAt: Date.now() + i,
        });
      }
      for (const message of created) {
        await insertMessage(message);
      }
      await touchConversation(cid);
      appendMessages(created);
    } catch (e) {
      const isAbort = e instanceof Error && e.name === 'AbortError';
      if (!isAbort) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  /** Long-press on a user message: load its text back into the input as a rewind draft. */
  const startRewind = useCallback(
    (message: Message) => {
      if (busy || streamText !== null) return;
      if (!conversationRef.current) return;
      setRewind({ messageId: message.id, text: message.content });
      setInput(message.content);
      setError(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, streamText]
  );

  const cancelRewind = () => {
    setRewind(null);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !settingsRef.current || !effectiveModelId) return;

    if (!(await getApiKey())) {
      setError('API key belum disetel — buka tab Setelan untuk mengisinya.');
      return;
    }

    setError(null);
    setInput('');

    // First message of a fresh chat: create the conversation row now (not before),
    // carrying the model and system prompt the user picked pre-send.
    let cid = conversationId;
    if (!cid) {
      cid = uid();
      await createConversation(cid, effectiveModelId);
      if (draftSystemPrompt) {
        await updateConversation(cid, { systemPrompt: draftSystemPrompt });
      }
      const created = await getConversation(cid);
      conversationRef.current = created;
      skipLoadRef.current = true;
      setConversationId(cid);
      setConversation(created);
    }

    // Rewind send: truncate everything after the rewound prompt in this same
    // conversation, then continue as a normal send with the revised text there.
    let history = messagesRef.current;
    const rewindTarget = rewind;
    if (rewindTarget && cid === conversationRef.current?.id) {
      const index = history.findIndex((m) => m.id === rewindTarget.messageId);
      if (index >= 0 && history[index]?.role === 'user') {
        await deleteMessagesAfter(cid, rewindTarget.messageId);
        history = history.slice(0, index);
        setMessagesTracked(history);
        setRewind(null);
      } else {
        setRewind(null);
      }
    }

    const userMessage: Message = {
      id: uid(),
      conversationId: cid,
      role: 'user',
      content: text,
      imagePaths: [],
      modelId: null,
      inputTokens: null,
      outputTokens: null,
      cost: null,
      error: false,
      createdAt: Date.now(),
    };
    await insertMessage(userMessage);
    const nextMessages = [...history, userMessage];
    setMessagesTracked(nextMessages);

    const current = conversationRef.current;
    if (current && !current.title) {
      const title = text.length > 48 ? `${text.slice(0, 48)}…` : text;
      await updateConversation(cid, { title });
      const updated = { ...current, title };
      conversationRef.current = updated;
      setConversation(updated);
    }
    await touchConversation(cid);

    if (isImageGenModel) {
      await runImageGeneration(text);
      return;
    }
    await runCompletion(nextMessages);
  };

  const retry = async () => {
    if (busy) return;
    const history = messagesRef.current;
    if (isImageGenModel) {
      const lastUser = [...history].reverse().find((m) => m.role === 'user');
      if (lastUser) await runImageGeneration(lastUser.content);
      return;
    }
    await runCompletion(history);
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const openPicker = async () => {
    // Refresh the list so models added in the Cari Model tab show up right away.
    setModels(await listModels());
    setPickerVisible(true);
  };

  const pickModel = async (model: ModelInfo | null) => {
    setPickerVisible(false);
    if (!model) return;
    if (conversationRef.current) {
      await updateConversation(conversationRef.current.id, { modelId: model.id });
      setConversation((prev) => (prev ? { ...prev, modelId: model.id } : prev));
    } else {
      setDraftModelId(model.id);
    }
  };

  const savePrompt = async (value: string) => {
    const trimmed = value.trim() || null;
    setPromptVisible(false);
    if (conversationRef.current) {
      await updateConversation(conversationRef.current.id, { systemPrompt: trimmed });
      setConversation((prev) => (prev ? { ...prev, systemPrompt: trimmed } : prev));
    } else {
      setDraftSystemPrompt(trimmed);
    }
  };

  // --- Shell handle (drawer actions routed in by the AppShell) ---

  const openConversation = (id: string) => {
    if (id === conversationRef.current?.id) return;
    abortRef.current?.abort();
    conversationRef.current = null;
    setStreamText(null);
    setError(null);
    setInput('');
    setDraftModelId(null);
    setDraftSystemPrompt(null);
    setRewind(null);
    setConversationId(id);
  };

  const newChat = () => {
    // conversationRef is null exactly while the chat is fresh — keep any draft
    // model/system-prompt picks instead of wiping them.
    if (!conversationRef.current) return;
    resetToNewChat();
  };

  const conversationDeleted = (id: string) => {
    if (conversationRef.current?.id !== id) return;
    resetToNewChat();
  };

  useImperativeHandle(ref, () => ({ openConversation, newChat, conversationDeleted }), []);

  const confirmDelete = () => {
    showDialog({
      title: 'Hapus percakapan',
      message: 'Percakapan dan semua pesannya akan dihapus.',
      actions: [
        { label: 'Batal', style: 'cancel' },
        {
          label: 'Hapus',
          style: 'destructive',
          onPress: () => {
            const cid = conversationRef.current?.id;
            if (!cid) return;
            void (async () => {
              await deleteConversation(cid);
              resetToNewChat();
            })();
          },
        },
      ],
    });
  };

  /**
   * Branch from an assistant reply: copy everything up to and including that
   * reply into a new `branch - `-titled conversation and open it. The source
   * chat is never modified — continuing there diverges from this point.
   * Each nesting level adds one more prefix, so a branch of a branch is
   * `branch - branch - ...`.
   */
  const branchFrom = useCallback(
    (message: Message) => {
      const current = conversationRef.current;
      if (!current || busy || streamText !== null) return;
      showDialog({
        title: 'Branch dari balasan ini',
        message:
          'Chat sampai balasan ini akan disalin ke percakapan baru. Chat asal tidak berubah.',
        actions: [
          { label: 'Batal', style: 'cancel' },
          { label: 'Branch', onPress: () => void doBranchFrom(message) },
        ],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, streamText]
  );

  const doBranchFrom = async (message: Message) => {
    const current = conversationRef.current;
    if (!current || busy || streamText !== null) return;
    const history = messagesRef.current;
    const index = history.findIndex((m) => m.id === message.id);
    if (index < 0) return;
    setRewind(null);
    const kept = history.slice(0, index + 1);
    const branchId = uid();
    // Each branch nesting adds one more `branch - ` prefix so the depth is visible.
    const branchTitle = `branch - ${current.title ?? 'Chat'}`;
    await createConversation(branchId, current.modelId ?? effectiveModelId);
    await updateConversation(branchId, {
      title: branchTitle,
      systemPrompt: current.systemPrompt,
    });
    for (const m of kept) {
      await insertMessage({ ...m, id: uid(), conversationId: branchId });
    }
    await touchConversation(branchId);
    const branch = await getConversation(branchId);
    conversationRef.current = branch;
    skipLoadRef.current = true;
    setConversationId(branchId);
    setConversation(branch);
    setMessagesTracked(await listMessages(branchId));
  };

  const openMenu = () => {
    showDialog({
      title: 'Opsi percakapan',
      actions: [
        { label: 'Ganti model', onPress: () => void openPicker() },
        { label: 'System prompt', onPress: () => setPromptVisible(true) },
        { label: 'Hapus percakapan', style: 'destructive', onPress: confirmDelete },
        { label: 'Batal', style: 'cancel' },
      ],
    });
  };

  // Keep settings/models refs fresh for the async completion flow.
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    modelsRef.current = models;
  }, [models]);

  // Follow the stream only while the user is near the bottom.
  useEffect(() => {
    if (stickToBottom.current && messages !== null) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
      });
    }
  }, [messages, streamText]);

  // When the keyboard lifts the input bar, the list shrinks — keep the newest
  // message visible instead of letting it hide behind the keyboard.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (stickToBottom.current) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd({ animated: false });
        });
      }
    });
    return () => sub.remove();
  }, []);

  const onScroll = (event: {
    nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } };
  }) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    stickToBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 120;
  };

  const streamingMessage: Message | null =
    streamText === null
      ? null
      : {
          id: STREAMING_ID,
          conversationId: conversationId ?? '__draft__',
          role: 'assistant',
          content: streamText,
          imagePaths: [],
          modelId: effectiveModelId,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          error: false,
          createdAt: 0,
        };

  const data: Message[] = streamingMessage
    ? [...(messages ?? []), streamingMessage]
    : (messages ?? []);

  // Stable row renderer so memo(MessageItem) actually skips unchanged rows:
  // callbacks receive the message, so no per-row closures are allocated.
  const renderMessage = useCallback(
    ({ item }: { item: Message }) => (
      <MessageItem
        message={item}
        streaming={item.id === STREAMING_ID}
        onRewind={
          item.role === 'user' && item.id !== STREAMING_ID && !busy ? startRewind : undefined
        }
        onBranch={
          item.role === 'assistant' && item.id !== STREAMING_ID && !busy && streamText === null
            ? branchFrom
            : undefined
        }
      />
    ),
    // startRewind/branchFrom are themselves stable (refs + setState only read).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, streamText]
  );

  const modelLabel = effectiveModelId
    ? (models.find((m) => m.id === effectiveModelId)?.displayName ?? effectiveModelId)
    : 'Pilih model';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: top,
          backgroundColor: colors.background,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 6 }}>
          <IconButton
            name="sidebar"
            onPress={onOpenDrawer}
            color={colors.text}
            accessibilityLabel="Buka menu"
          />
          <Pressable
            style={{ flex: 1, alignItems: 'center', gap: 1 }}
            onPress={() => void openPicker()}
            accessibilityRole="button"
            accessibilityLabel="Ganti model">
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, fontWeight: '700', maxWidth: '100%' }}>
              {conversation?.title ?? 'Chat baru'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, maxWidth: 220 }}>
                {modelLabel}
              </Text>
              <Icon name="chevronDown" size={14} color={colors.textSecondary} />
            </View>
          </Pressable>
          <IconButton name="menu" onPress={openMenu} color={colors.text} accessibilityLabel="Opsi percakapan" />
        </View>
      </View>

      {/* Messages */}
      {messages === null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} />
      ) : (
        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(item) => item.id}
          onScroll={onScroll}
          scrollEventThrottle={64}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 18 }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', gap: 8, paddingTop: 48 }}>
              <Icon name="chat" size={36} color={colors.textSecondary} />
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
                Tanya apa saja
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
                {modelLabel !== 'Pilih model'
                  ? 'Pesan terakhir + jawaban dihitung untuk estimasi biaya.'
                  : 'Ketuk “Pilih model” di atas sebelum mulai chat.'}
              </Text>
            </View>
          }
          renderItem={renderMessage}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={3}
          removeClippedSubviews
          updateCellsBatchingPeriod={80}
        />
      )}

      {/* Rewind banner — visible while a prompt revision is staged as a branch. */}
      {rewind ? (
        <View
          style={{
            marginHorizontal: 12,
            marginBottom: 8,
            padding: 10,
            borderRadius: 12,
            borderCurve: 'continuous',
            backgroundColor: colors.backgroundElement,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}>
          <Icon name="rewind" size={18} color={colors.accent} />
          <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>
            Mode rewind — kirim untuk mengganti prompt ini dan menjawab ulang di chat ini. Pesan sesudahnya akan dihapus.
          </Text>
          <IconButton name="close" onPress={cancelRewind} accessibilityLabel="Batalkan rewind" />
        </View>
      ) : null}

      {/* Error banner */}
      {error ? (
        <View
          style={{
            marginHorizontal: 12,
            marginBottom: 8,
            padding: 12,
            borderRadius: 12,
            borderCurve: 'continuous',
            backgroundColor: colors.backgroundElement,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}>
          <Icon name="error" size={18} color={colors.error} />
          <Text selectable style={{ color: colors.error, fontSize: 13, flex: 1 }}>
            {error}
          </Text>
          <Pressable onPress={retry} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>Coba lagi</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Input */}
      <ChatInput
        value={input}
        onChangeText={setInput}
        onSend={send}
        onStop={stop}
        imageGenMode={isImageGenModel}
        busy={busy}
      />

      {/* Sheets */}
      <ModelPickerModal
        visible={pickerVisible}
        models={models}
        selectedId={effectiveModelId}
        onSelect={pickModel}
        onClose={() => setPickerVisible(false)}
      />
      <PromptModal
        visible={promptVisible}
        title="System prompt"
        initial={conversation?.systemPrompt ?? draftSystemPrompt ?? ''}
        placeholder="Contoh: Jawab singkat dan padat, dalam Bahasa Indonesia."
        hint="Berlaku untuk percakapan ini saja. Kosongkan untuk memakai Custom Instructions global dari Setelan."
        onSave={savePrompt}
        onClose={() => setPromptVisible(false)}
      />
    </View>
  );
});

/** Text part of an API message's content, for token estimation. */
function textOf(content: string | ApiContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
}

/** JPEG/PNG sniffing from the base64 magic prefix, for the right file extension. */
function sniffImageExt(base64: string): 'jpg' | 'png' {
  if (base64.startsWith('/9j/')) return 'jpg';
  return 'png';
}
