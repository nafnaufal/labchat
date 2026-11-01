import * as SQLite from 'expo-sqlite';

import type { Conversation, Message, MessageRole, ModelInfo, ModelSource } from './types';

const DB_NAME = 'labchat.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT,
          model_id TEXT,
          system_prompt TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY NOT NULL,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          image_path TEXT,
          model_id TEXT,
          input_tokens INTEGER,
          output_tokens INTEGER,
          cost REAL,
          error INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id);
        CREATE INDEX IF NOT EXISTS idx_messages_lookup ON messages (conversation_id, created_at);
        CREATE TABLE IF NOT EXISTS models (
          id TEXT PRIMARY KEY NOT NULL,
          display_name TEXT,
          input_price REAL NOT NULL DEFAULT 0,
          output_price REAL NOT NULL DEFAULT 0,
          image_price REAL NOT NULL DEFAULT 0,
          discount_pct REAL NOT NULL DEFAULT 0,
          vision INTEGER NOT NULL DEFAULT 0,
          image_gen INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'manual',
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT
        );
      `);
      // One-time cleanup: models bulk-inserted by the old "sync" flow (source 'api')
      // flood the model picker. Keep only models still referenced by a conversation,
      // a message, or the default setting; user-added models are source 'manual'.
      const pruned = await db.getFirstAsync<{ value: string | null }>(
        "SELECT value FROM app_settings WHERE key = 'pruned_bulk_synced_models'"
      );
      if (!pruned) {
        await db.runAsync(
          `DELETE FROM models WHERE source = 'api' AND id NOT IN (
             SELECT model_id FROM conversations WHERE model_id IS NOT NULL
             UNION
             SELECT model_id FROM messages WHERE model_id IS NOT NULL
             UNION
             SELECT value FROM app_settings WHERE key = 'default_model_id' AND value IS NOT NULL
           )`
        );
        await db.runAsync(
          "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pruned_bulk_synced_models', '1')"
        );
      }
      // Column additions for image support (models: capabilities + per-image price,
      // messages: attached/produced image file). Guarded so existing DBs migrate in place.
      const modelCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(models)');
      const modelColNames = new Set(modelCols.map((c) => c.name));
      if (!modelColNames.has('image_price')) {
        await db.execAsync('ALTER TABLE models ADD COLUMN image_price REAL NOT NULL DEFAULT 0');
      }
      if (!modelColNames.has('vision')) {
        await db.execAsync('ALTER TABLE models ADD COLUMN vision INTEGER NOT NULL DEFAULT 0');
      }
      if (!modelColNames.has('image_gen')) {
        await db.execAsync('ALTER TABLE models ADD COLUMN image_gen INTEGER NOT NULL DEFAULT 0');
      }
      const messageCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(messages)');
      if (!messageCols.some((c) => c.name === 'image_path')) {
        await db.execAsync('ALTER TABLE messages ADD COLUMN image_path TEXT');
      }
      return db;
    })();
  }
  return dbPromise;
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface ConversationRow {
  id: string;
  title: string | null;
  model_id: string | null;
  system_prompt: string | null;
  created_at: number;
  updated_at: number;
  last_message?: string | null;
  message_count?: number;
  total_cost?: number | null;
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    systemPrompt: row.system_prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message ?? null,
    messageCount: row.message_count ?? 0,
    totalCost: row.total_cost ?? null,
  };
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  image_path: string | null;
  model_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost: number | null;
  error: number;
  created_at: number;
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: (row.role === 'assistant' ? 'assistant' : 'user') as MessageRole,
    content: row.content,
    imagePaths: parseImagePaths(row.image_path),
    modelId: row.model_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cost: row.cost,
    error: row.error === 1,
    createdAt: row.created_at,
  };
}

/**
 * The image_path column stores a JSON array of file uris. Rows written before
 * multi-image support hold a single plain path — treat those as a one-item list.
 */
function parseImagePaths(raw: string | null): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === 'string');
      }
    } catch {
      // fall through to legacy single-path handling
    }
  }
  return [raw];
}

interface ModelRow {
  id: string;
  display_name: string | null;
  input_price: number;
  output_price: number;
  image_price: number;
  discount_pct: number;
  vision: number;
  image_gen: number;
  source: string;
  updated_at: number;
}

function mapModel(row: ModelRow): ModelInfo {
  return {
    id: row.id,
    displayName: row.display_name,
    inputPrice: row.input_price,
    outputPrice: row.output_price,
    imagePrice: row.image_price ?? 0,
    discountPct: row.discount_pct,
    vision: row.vision === 1,
    imageGen: row.image_gen === 1,
    source: (row.source === 'api' ? 'api' : 'manual') as ModelSource,
    updatedAt: row.updated_at,
  };
}

// --- Conversations ---

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ConversationRow>(`
    SELECT c.*,
      (SELECT CASE WHEN m.content != '' THEN m.content
                   WHEN m.image_path IS NOT NULL THEN '[gambar]'
                   ELSE '' END
       FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT SUM(m.cost) FROM messages m WHERE m.conversation_id = c.id) AS total_cost
    FROM conversations c
    ORDER BY c.updated_at DESC
  `);
  return rows.map(mapConversation);
}

export async function createConversation(id: string, modelId: string | null): Promise<Conversation> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    'INSERT INTO conversations (id, title, model_id, system_prompt, created_at, updated_at) VALUES (?, NULL, ?, NULL, ?, ?)',
    [id, modelId, now, now]
  );
  return { id, title: null, modelId, systemPrompt: null, createdAt: now, updatedAt: now };
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ConversationRow>(
    'SELECT * FROM conversations WHERE id = ?',
    [id]
  );
  return row ? mapConversation(row) : null;
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, 'title' | 'modelId' | 'systemPrompt'>>
): Promise<void> {
  const db = await getDb();
  const columns: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    columns.push('title = ?');
    values.push(patch.title);
  }
  if (patch.modelId !== undefined) {
    columns.push('model_id = ?');
    values.push(patch.modelId);
  }
  if (patch.systemPrompt !== undefined) {
    columns.push('system_prompt = ?');
    values.push(patch.systemPrompt);
  }
  if (columns.length === 0) return;
  columns.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);
  await db.runAsync(`UPDATE conversations SET ${columns.join(', ')} WHERE id = ?`, values);
}

export async function touchConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE conversations SET updated_at = ? WHERE id = ?', [Date.now(), id]);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM conversations WHERE id = ?', [id]);
}

// --- Messages ---

/** Cap on messages loaded into RAM per conversation — long chats page from disk. */
const MESSAGE_WINDOW = 200;

export async function listMessages(conversationId: string): Promise<Message[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MessageRow>(
    'SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?) ORDER BY created_at ASC, id ASC',
    [conversationId, MESSAGE_WINDOW]
  );
  return rows.map(mapMessage);
}

export async function insertMessage(message: Message): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO messages (id, conversation_id, role, content, image_path, model_id, input_tokens, output_tokens, cost, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.imagePaths.length > 0 ? JSON.stringify(message.imagePaths) : null,
      message.modelId,
      message.inputTokens,
      message.outputTokens,
      message.cost,
      message.error ? 1 : 0,
      message.createdAt,
    ]
  );
}

/** Removes every message of the conversation after (not including) the given one. */
export async function deleteMessagesAfter(conversationId: string, messageId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM messages WHERE conversation_id = ? AND created_at > (
       SELECT created_at FROM messages WHERE conversation_id = ? AND id = ?
     )`,
    [conversationId, conversationId, messageId]
  );
}

// --- Models ---
// The models table is a cache of reference prices for models actually used in chats.

export async function listModels(): Promise<ModelInfo[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ModelRow>(
    'SELECT * FROM models ORDER BY updated_at DESC'
  );
  return rows.map(mapModel);
}

export async function getModel(id: string): Promise<ModelInfo | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ModelRow>('SELECT * FROM models WHERE id = ?', [id]);
  return row ? mapModel(row) : null;
}

export async function removeModel(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM models WHERE id = ?', [id]);
}

/**
 * Upserts models with reference prices and capabilities from the public catalog:
 * fills/refreshes prices, display names, vision/image-gen flags, but never
 * overwrites existing rows beyond that. Returns how many models were newly added.
 */
export async function upsertModels(models: ModelInfo[]): Promise<number> {
  const db = await getDb();
  let added = 0;
  for (const model of models) {
    // Insert new rows as-is; existing rows keep their data.
    const insertResult = await db.runAsync(
      `INSERT OR IGNORE INTO models (id, display_name, input_price, output_price, image_price, discount_pct, vision, image_gen, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        model.id,
        model.displayName,
        model.inputPrice,
        model.outputPrice,
        model.imagePrice,
        model.discountPct,
        model.vision ? 1 : 0,
        model.imageGen ? 1 : 0,
        model.source,
        model.updatedAt,
      ]
    );
    if (insertResult.changes > 0) {
      added += 1;
      continue;
    }
    // Existing row: refresh reference prices, display name, and capabilities only.
    await db.runAsync(
      `UPDATE models SET
         display_name = COALESCE(?, display_name),
         input_price = CASE WHEN ? > 0 THEN ? ELSE input_price END,
         output_price = CASE WHEN ? > 0 THEN ? ELSE output_price END,
         image_price = CASE WHEN ? > 0 THEN ? ELSE image_price END,
         vision = MAX(vision, ?),
         image_gen = MAX(image_gen, ?),
         updated_at = ?
       WHERE id = ?`,
      [
        model.displayName,
        model.inputPrice,
        model.inputPrice,
        model.outputPrice,
        model.outputPrice,
        model.imagePrice,
        model.imagePrice,
        model.vision ? 1 : 0,
        model.imageGen ? 1 : 0,
        model.updatedAt,
        model.id,
      ]
    );
  }
  return added;
}

// --- Key-value settings ---

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  if (value === null) {
    await db.runAsync('DELETE FROM app_settings WHERE key = ?', [key]);
    return;
  }
  await db.runAsync(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

// --- Storage management ---

export interface StorageStats {
  conversations: number;
  messages: number;
  models: number;
}

export async function getStorageStats(): Promise<StorageStats> {
  const db = await getDb();
  const conversations = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM conversations'
  );
  const messages = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM messages'
  );
  const models = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM models');
  return {
    conversations: conversations?.count ?? 0,
    messages: messages?.count ?? 0,
    models: models?.count ?? 0,
  };
}

export async function deleteAllConversations(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM conversations');
}

export async function resetAllData(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM conversations');
  await db.runAsync('DELETE FROM models');
  await db.runAsync('DELETE FROM app_settings');
}
