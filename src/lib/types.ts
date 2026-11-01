export interface Conversation {
  id: string;
  title: string | null;
  modelId: string | null;
  systemPrompt: string | null;
  createdAt: number;
  updatedAt: number;
  /** Only filled by listConversations(). */
  lastMessage?: string | null;
  messageCount?: number;
  totalCost?: number | null;
}

export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** Local file uris of images attached to (user) or produced by (assistant) this message. */
  imagePaths: string[];
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Estimated actual cost in USD after the model's discount. */
  cost: number | null;
  error: boolean;
  createdAt: number;
}

export type ModelSource = 'manual' | 'api';

export interface ModelInfo {
  /** Model ID sent to the API, e.g. `claude-sonnet-4.6`. */
  id: string;
  displayName: string | null;
  /** Reference price in USD per 1M input tokens. */
  inputPrice: number;
  /** Reference price in USD per 1M output tokens. */
  outputPrice: number;
  /** For image-generation models: reference price in USD per generated image. */
  imagePrice: number;
  /** Discount percentage vs reference price, 0-100. */
  discountPct: number;
  /** Model accepts image input (vision) — from /v1/models capabilities. */
  vision: boolean;
  /** Model generates images via POST /v1/images/generations. */
  imageGen: boolean;
  source: ModelSource;
  updatedAt: number;
}

export interface AppSettings {
  baseUrl: string;
  defaultModelId: string | null;
  customInstructions: string;
  streaming: boolean;
  /** Minimum-discount floor the app injects as /min{N} on request URLs, 0 = off (URL segment wins). */
  minDiscount: number;
}
