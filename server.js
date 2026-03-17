import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import dotenv from "dotenv";
import Fastify from "fastify";
import Pino from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const parseInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const config = {
  port: parseInteger(process.env.PORT, 3000),
  host: process.env.HOST || "0.0.0.0",
  apiKey: process.env.API_KEY || "",
  webhookUrl: process.env.WEBHOOK_URL || "",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  rateLimitMax: parseInteger(process.env.RATE_LIMIT_MAX, 120),
  rateLimitWindow: parseInteger(process.env.RATE_LIMIT_WINDOW, 60_000),
  autoConnect: parseBoolean(process.env.AUTO_CONNECT, true),
  sessionsDir: path.resolve(process.env.SESSIONS_DIR || path.join(__dirname, "sessions")),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, "data")),
};

const paths = {
  messages: path.join(config.dataDir, "messages.json"),
  conversations: path.join(config.dataDir, "conversations.json"),
  webhook: path.join(config.dataDir, "webhook.json"),
};

const defaultWebhookSettings = {
  webhookUrl: config.webhookUrl,
  webhookSecret: config.webhookSecret,
  webhookFilterMode: "all",
  webhookGroupAllowlist: [],
  webhookIgnoreFromMe: true,
};

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
  },
});

await ensureDirectories();

const stores = {
  messages: normalizeMessagesStore(await readJson(paths.messages, { messages: [] })),
  conversations: normalizeConversationsStore(
    await readJson(paths.conversations, {
      jidToConversationId: {},
      conversations: {},
    }),
  ),
  webhook: normalizeWebhookSettings(await readJson(paths.webhook, defaultWebhookSettings)),
};

const writeMessages = createJsonWriter(paths.messages, app.log);
const writeConversations = createJsonWriter(paths.conversations, app.log);
const writeWebhook = createJsonWriter(paths.webhook, app.log);
const messageIndex = new Set(
  stores.messages.messages.map((message) => getMessageSignature(message)),
);

const persistMessages = () => writeMessages(stores.messages);
const persistConversations = () => writeConversations(stores.conversations);
const persistWebhook = () => writeWebhook(stores.webhook);

const whatsapp = createWhatsAppService({
  app,
  config,
  stores,
  messageIndex,
  persistMessages,
  persistConversations,
  persistWebhook,
});

app.register(rateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindow,
});

app.register(fastifyStatic, {
  root: path.join(__dirname, "public"),
  prefix: "/",
  decorateReply: false,
});

app.addHook("onRequest", async (request, reply) => {
  const pathname = getPathname(request.raw.url);

  if (!pathname.startsWith("/api/")) {
    return;
  }

  if (pathname === "/api/health" || pathname === "/api/bootstrap") {
    return;
  }

  if (!config.apiKey) {
    return;
  }

  const authHeader = String(request.headers.authorization || "");
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const providedApiKey =
    request.headers["x-api-key"] ||
    bearerToken ||
    request.query?.apiKey;

  if (providedApiKey !== config.apiKey) {
    return reply.code(401).send({
      error: "unauthorized",
      message: "API key invalida ou ausente.",
    });
  }
});

app.get("/api/health", async () => ({
  ok: true,
  uptimeSeconds: Math.floor(process.uptime()),
  timestamp: new Date().toISOString(),
  whatsapp: {
    status: whatsapp.getSnapshot().status,
  },
}));

app.get("/api/bootstrap", async () => ({
  appName: "API WhatsApp Coolify",
  authRequired: Boolean(config.apiKey),
}));

app.get("/api/status", async () => ({
  authRequired: Boolean(config.apiKey),
  whatsapp: whatsapp.getSnapshot(),
  stats: getDashboardStats(stores),
  webhook: stores.webhook,
}));

app.post("/api/whatsapp/connect", async () => {
  await whatsapp.connect();
  return {
    ok: true,
    whatsapp: whatsapp.getSnapshot(),
  };
});

app.post("/api/whatsapp/disconnect", async () => {
  await whatsapp.disconnect();
  return {
    ok: true,
    whatsapp: whatsapp.getSnapshot(),
  };
});

app.post("/api/whatsapp/logout", async () => {
  await whatsapp.logout();
  return {
    ok: true,
    whatsapp: whatsapp.getSnapshot(),
  };
});

app.get("/api/conversations", async (request) => {
  const limit = Math.min(parseInteger(request.query?.limit, 100), 500);
  const search = String(request.query?.search || "").trim().toLowerCase();

  const conversations = Object.entries(stores.conversations.conversations)
    .map(([id, conversation]) => buildConversationSummary(id, conversation, stores))
    .filter((conversation) => {
      if (!search) {
        return true;
      }

      return [
        conversation.title,
        conversation.lastJid,
        conversation.lastMessagePreview,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);

  return {
    conversations,
  };
});

app.get("/api/conversations/:id", async (request, reply) => {
  const conversation = stores.conversations.conversations[request.params.id];

  if (!conversation) {
    return reply.code(404).send({
      error: "not_found",
      message: "Conversa nao encontrada.",
    });
  }

  return {
    conversation: buildConversationSummary(request.params.id, conversation, stores),
    messages: getConversationMessages(request.params.id, stores).slice(-200),
  };
});

app.get("/api/conversations/:id/messages", async (request, reply) => {
  const conversation = stores.conversations.conversations[request.params.id];

  if (!conversation) {
    return reply.code(404).send({
      error: "not_found",
      message: "Conversa nao encontrada.",
    });
  }

  const limit = Math.min(parseInteger(request.query?.limit, 200), 500);
  return {
    messages: getConversationMessages(request.params.id, stores).slice(-limit),
  };
});

app.post("/api/conversations/:id/read", async (request, reply) => {
  const conversation = stores.conversations.conversations[request.params.id];

  if (!conversation) {
    return reply.code(404).send({
      error: "not_found",
      message: "Conversa nao encontrada.",
    });
  }

  conversation.unreadCount = 0;
  await persistConversations();

  return {
    ok: true,
    conversation: buildConversationSummary(request.params.id, conversation, stores),
  };
});

app.post("/api/messages/send", async (request, reply) => {
  const jid = String(request.body?.jid || "").trim();
  const text = String(request.body?.text || "").trim();

  if (!jid || !text) {
    return reply.code(400).send({
      error: "bad_request",
      message: "Informe jid e text.",
    });
  }

  const message = await whatsapp.sendText(jid, text);

  return {
    ok: true,
    message,
  };
});

app.get("/api/webhook", async () => ({
  webhook: stores.webhook,
}));

app.put("/api/webhook", async (request) => {
  stores.webhook = normalizeWebhookSettings({
    ...stores.webhook,
    ...request.body,
  });

  await persistWebhook();

  return {
    ok: true,
    webhook: stores.webhook,
  };
});

app.post("/api/webhook/test", async (request, reply) => {
  if (!stores.webhook.webhookUrl) {
    return reply.code(400).send({
      error: "bad_request",
      message: "Defina WEBHOOK_URL antes de testar.",
    });
  }

  const payload = {
    event: "webhook.test",
    timestamp: new Date().toISOString(),
    whatsapp: whatsapp.getSnapshot(),
    message: {
      id: `test_${Date.now()}`,
      jid: "5511999999999@s.whatsapp.net",
      fromMe: false,
      text: "Mensagem de teste enviada pela API.",
      timestamp: Math.floor(Date.now() / 1000),
      type: "text",
    },
  };

  const result = await postWebhook(stores.webhook, payload);

  return {
    ok: true,
    result,
  };
});

app.setNotFoundHandler(async (request, reply) => {
  if (getPathname(request.raw.url).startsWith("/api/")) {
    return reply.code(404).send({
      error: "not_found",
    });
  }

  if (request.raw.method !== "GET") {
    return reply.code(404).send({
      error: "not_found",
    });
  }

  return reply.sendFile("index.html");
});

try {
  await app.listen({
    host: config.host,
    port: config.port,
  });

  app.log.info(`Servidor disponivel em http://${config.host}:${config.port}`);

  if (config.autoConnect) {
    void whatsapp.connect().catch((error) => {
      app.log.error({ error }, "Falha no auto connect do WhatsApp.");
    });
  }
} catch (error) {
  app.log.error({ error }, "Falha ao iniciar o servidor.");
  process.exit(1);
}

const shutdown = async (signal) => {
  app.log.info({ signal }, "Encerrando aplicacao.");
  await whatsapp.disconnect();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

function createWhatsAppService({
  app,
  config,
  stores,
  messageIndex,
  persistMessages,
  persistConversations,
}) {
  const logger = Pino({ level: "silent" });
  const state = {
    socket: null,
    connectPromise: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    manualDisconnect: false,
    qrCode: null,
    qrDataUrl: null,
    status: "idle",
    me: null,
    connectedAt: null,
    lastDisconnectAt: null,
    lastError: null,
  };

  const clearReconnectTimer = () => {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (state.manualDisconnect || state.reconnectTimer) {
      return;
    }

    const delayMs = Math.min(5_000 * (state.reconnectAttempts + 1), 30_000);
    state.reconnectAttempts += 1;

    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      void connect().catch((error) => {
        app.log.error({ error }, "Falha ao reconectar o WhatsApp.");
      });
    }, delayMs);
  };

  const getSnapshot = () => ({
    status: state.status,
    qrAvailable: Boolean(state.qrDataUrl),
    qrDataUrl: state.qrDataUrl,
    me: state.me,
    connectedAt: state.connectedAt,
    lastDisconnectAt: state.lastDisconnectAt,
    lastError: state.lastError,
    reconnectAttempts: state.reconnectAttempts,
  });

  const updateConversationFromRecord = (record) => {
    const conversationId = ensureConversation(record.jid, stores, record);
    const conversation = stores.conversations.conversations[conversationId];

    conversation.lastJid = record.jid;
    conversation.kind = getConversationKind(record.jid);
    conversation.updatedAt = record.timestamp * 1000;
    conversation.title =
      conversation.title || record.pushName || formatJidForDisplay(record.jid);
    conversation.preview = getMessagePreview(record);
    conversation.unreadCount = record.fromMe ? 0 : (conversation.unreadCount || 0) + 1;

    if (!conversation.jids.includes(record.jid)) {
      conversation.jids.push(record.jid);
    }

    record.conversationId = conversationId;
    return conversationId;
  };

  const recordMessage = (record) => {
    const signature = getMessageSignature(record);
    if (messageIndex.has(signature)) {
      return record;
    }

    updateConversationFromRecord(record);
    messageIndex.add(signature);
    stores.messages.messages.push(record);

    if (stores.messages.messages.length > 5_000) {
      const removed = stores.messages.messages.splice(
        0,
        stores.messages.messages.length - 5_000,
      );

      removed.forEach((message) => {
        messageIndex.delete(getMessageSignature(message));
      });
    }

    void persistMessages();
    void persistConversations();

    if (shouldForwardToWebhook(record, stores.webhook)) {
      const payload = {
        event: "message.received",
        timestamp: new Date().toISOString(),
        message: record,
        conversation: buildConversationSummary(record.conversationId, stores.conversations.conversations[record.conversationId], stores),
      };

      void postWebhook(stores.webhook, payload).catch((error) => {
        app.log.warn({ error }, "Falha ao enviar webhook de mensagem.");
      });
    }

    return record;
  };

  const handleConnectionUpdate = async (update) => {
    if (update.qr) {
      state.status = "qr";
      state.qrCode = update.qr;
      state.qrDataUrl = await QRCode.toDataURL(update.qr, {
        margin: 1,
        width: 320,
      });
    }

    if (update.connection === "open") {
      clearReconnectTimer();
      state.reconnectAttempts = 0;
      state.status = "connected";
      state.qrCode = null;
      state.qrDataUrl = null;
      state.connectedAt = Date.now();
      state.lastError = null;
      state.me = state.socket?.user || null;
      app.log.info("WhatsApp conectado.");
      return;
    }

    if (update.connection === "close") {
      const statusCode = update.lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      state.socket = null;
      state.me = null;
      state.connectedAt = null;
      state.lastDisconnectAt = Date.now();
      state.lastError = errorToMessage(update.lastDisconnect?.error);
      state.status = loggedOut ? "logged_out" : "disconnected";
      state.qrCode = null;
      state.qrDataUrl = null;

      if (!loggedOut) {
        scheduleReconnect();
      }
    }
  };

  const handleMessagesUpsert = async (event) => {
    for (const message of event.messages || []) {
      const normalized = normalizeIncomingMessage(message);
      if (!normalized) {
        continue;
      }

      recordMessage(normalized);
    }
  };

  const connect = async () => {
    if (state.connectPromise) {
      return state.connectPromise;
    }

    if (state.socket && state.status === "connected") {
      return getSnapshot();
    }

    clearReconnectTimer();
    state.manualDisconnect = false;
    state.status = "connecting";
    state.lastError = null;

    state.connectPromise = (async () => {
      const { state: authState, saveCreds } = await useMultiFileAuthState(config.sessionsDir);
      const { version } = await fetchLatestBaileysVersion();

      const socket = makeWASocket({
        version,
        auth: {
          creds: authState.creds,
          keys: makeCacheableSignalKeyStore(authState.keys, logger),
        },
        browser: Browsers.ubuntu("Coolify Chrome"),
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        logger,
      });

      state.socket = socket;
      state.me = socket.user || null;

      socket.ev.on("creds.update", saveCreds);
      socket.ev.on("connection.update", (update) => {
        void handleConnectionUpdate(update);
      });
      socket.ev.on("messages.upsert", (event) => {
        void handleMessagesUpsert(event);
      });

      return getSnapshot();
    })().finally(() => {
      state.connectPromise = null;
    });

    return state.connectPromise;
  };

  const disconnect = async () => {
    state.manualDisconnect = true;
    clearReconnectTimer();

    if (state.socket?.ws?.close) {
      try {
        state.socket.ws.close();
      } catch (error) {
        app.log.warn({ error }, "Falha ao fechar websocket do WhatsApp.");
      }
    }

    state.socket = null;
    state.me = null;
    state.status = "disconnected";
    state.qrCode = null;
    state.qrDataUrl = null;
    state.connectedAt = null;

    return getSnapshot();
  };

  const logout = async () => {
    state.manualDisconnect = true;
    clearReconnectTimer();

    if (state.socket) {
      try {
        await state.socket.logout();
      } catch (error) {
        app.log.warn({ error }, "Falha ao fazer logout do WhatsApp.");
      }
    }

    await fs.rm(config.sessionsDir, { recursive: true, force: true });
    await fs.mkdir(config.sessionsDir, { recursive: true });

    state.socket = null;
    state.me = null;
    state.status = "logged_out";
    state.qrCode = null;
    state.qrDataUrl = null;
    state.connectedAt = null;
    state.lastDisconnectAt = Date.now();

    return getSnapshot();
  };

  const sendText = async (jidInput, text) => {
    if (!state.socket || state.status !== "connected") {
      throw new Error("WhatsApp nao esta conectado.");
    }

    const jid = normalizeJidInput(jidInput);
    const response = await state.socket.sendMessage(jid, { text });

    const message = recordMessage({
      id: response?.key?.id || `local_${Date.now()}`,
      jid,
      fromMe: true,
      text,
      timestamp: Math.floor(Date.now() / 1000),
      type: "text",
      status: "sent",
      pushName: state.me?.name || state.me?.verifiedName || null,
      participant: null,
      conversationId: null,
    });

    return message;
  };

  return {
    connect,
    disconnect,
    logout,
    sendText,
    getSnapshot,
  };
}

function buildConversationSummary(id, conversation, stores) {
  const messages = getConversationMessages(id, stores);
  const lastMessage = messages.at(-1);

  return {
    id,
    title: conversation.title || formatJidForDisplay(conversation.lastJid || conversation.jids[0]),
    kind: conversation.kind || getConversationKind(conversation.lastJid || conversation.jids[0]),
    jids: conversation.jids || [],
    lastJid: conversation.lastJid || conversation.jids?.[0] || "",
    updatedAt: conversation.updatedAt || getMessageTimestampMs(lastMessage) || Date.now(),
    unreadCount: conversation.unreadCount || 0,
    messageCount: messages.length,
    lastMessagePreview: lastMessage ? getMessagePreview(lastMessage) : conversation.preview || "",
    lastMessageAt: getMessageTimestampMs(lastMessage) || conversation.updatedAt || Date.now(),
  };
}

function getConversationMessages(conversationId, stores) {
  return stores.messages.messages
    .filter((message) => {
      if (message.conversationId === conversationId) {
        return true;
      }

      return stores.conversations.jidToConversationId[message.jid] === conversationId;
    })
    .sort((left, right) => getMessageTimestampMs(left) - getMessageTimestampMs(right));
}

function getDashboardStats(stores) {
  const summaries = Object.entries(stores.conversations.conversations).map(([id, conversation]) =>
    buildConversationSummary(id, conversation, stores),
  );

  const groups = summaries.filter((conversation) => conversation.kind === "group").length;
  const privateChats = summaries.filter((conversation) => conversation.kind === "private").length;

  return {
    conversationCount: summaries.length,
    messageCount: stores.messages.messages.length,
    groupCount: groups,
    privateCount: privateChats,
    webhookConfigured: Boolean(stores.webhook.webhookUrl),
  };
}

function ensureConversation(jid, stores, record = {}) {
  if (stores.conversations.jidToConversationId[jid]) {
    return stores.conversations.jidToConversationId[jid];
  }

  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  stores.conversations.jidToConversationId[jid] = id;
  stores.conversations.conversations[id] = {
    jids: [jid],
    lastJid: jid,
    updatedAt: Date.now(),
    unreadCount: record.fromMe ? 0 : 1,
    title: record.pushName || formatJidForDisplay(jid),
    kind: getConversationKind(jid),
    preview: record.text || "",
  };

  return id;
}

function normalizeIncomingMessage(message) {
  const jid = message?.key?.remoteJid;

  if (!jid || !message?.message) {
    return null;
  }

  const content = unwrapMessageContent(message.message);
  const type = extractMessageType(content);
  const text = extractMessageText(content);

  if (
    ["senderKeyDistributionMessage", "messageContextInfo", "protocolMessage"].includes(type) &&
    !text
  ) {
    return null;
  }

  return {
    id: message.key.id || `incoming_${Date.now()}`,
    jid,
    fromMe: Boolean(message.key.fromMe),
    text,
    timestamp: normalizeTimestamp(message.messageTimestamp),
    type,
    status: "received",
    pushName: message.pushName || null,
    participant: message.key.participant || null,
    conversationId: null,
  };
}

function unwrapMessageContent(message) {
  if (!message) {
    return null;
  }

  if (message.ephemeralMessage?.message) {
    return unwrapMessageContent(message.ephemeralMessage.message);
  }

  if (message.viewOnceMessage?.message) {
    return unwrapMessageContent(message.viewOnceMessage.message);
  }

  if (message.viewOnceMessageV2?.message) {
    return unwrapMessageContent(message.viewOnceMessageV2.message);
  }

  if (message.viewOnceMessageV2Extension?.message) {
    return unwrapMessageContent(message.viewOnceMessageV2Extension.message);
  }

  if (message.documentWithCaptionMessage?.message) {
    return unwrapMessageContent(message.documentWithCaptionMessage.message);
  }

  return message;
}

function extractMessageType(content) {
  if (!content || typeof content !== "object") {
    return "unknown";
  }

  return Object.keys(content)[0] || "unknown";
}

function extractMessageText(content) {
  if (!content || typeof content !== "object") {
    return "";
  }

  if (typeof content.conversation === "string") {
    return content.conversation;
  }

  if (typeof content.extendedTextMessage?.text === "string") {
    return content.extendedTextMessage.text;
  }

  if (typeof content.imageMessage?.caption === "string") {
    return content.imageMessage.caption;
  }

  if (typeof content.videoMessage?.caption === "string") {
    return content.videoMessage.caption;
  }

  if (typeof content.documentMessage?.caption === "string") {
    return content.documentMessage.caption;
  }

  if (typeof content.buttonsResponseMessage?.selectedDisplayText === "string") {
    return content.buttonsResponseMessage.selectedDisplayText;
  }

  if (typeof content.listResponseMessage?.title === "string") {
    return content.listResponseMessage.title;
  }

  if (typeof content.templateButtonReplyMessage?.selectedDisplayText === "string") {
    return content.templateButtonReplyMessage.selectedDisplayText;
  }

  if (typeof content.pollCreationMessage?.name === "string") {
    return content.pollCreationMessage.name;
  }

  if (content.locationMessage) {
    return "[localizacao]";
  }

  if (content.contactMessage?.displayName) {
    return `[contato] ${content.contactMessage.displayName}`;
  }

  if (content.stickerMessage) {
    return "[sticker]";
  }

  if (content.audioMessage) {
    return "[audio]";
  }

  if (content.imageMessage) {
    return "[imagem]";
  }

  if (content.videoMessage) {
    return "[video]";
  }

  if (content.documentMessage) {
    return "[documento]";
  }

  return "";
}

function normalizeTimestamp(value) {
  const numeric = Number(value || Date.now());

  if (!Number.isFinite(numeric)) {
    return Math.floor(Date.now() / 1000);
  }

  if (numeric > 1_000_000_000_000) {
    return Math.floor(numeric / 1000);
  }

  return Math.floor(numeric);
}

function getMessageTimestampMs(message) {
  if (!message) {
    return 0;
  }

  const timestamp = normalizeTimestamp(message.timestamp);
  return timestamp * 1000;
}

function getMessagePreview(message) {
  if (!message) {
    return "";
  }

  if (message.text) {
    return message.text;
  }

  return `[${message.type || "mensagem"}]`;
}

function getMessageSignature(message) {
  return [message.id, message.jid, message.fromMe ? "1" : "0"].join(":");
}

function getConversationKind(jid = "") {
  if (jid.endsWith("@g.us")) {
    return "group";
  }

  if (jid.endsWith("@newsletter")) {
    return "newsletter";
  }

  if (jid.endsWith("@broadcast")) {
    return "broadcast";
  }

  return "private";
}

function formatJidForDisplay(jid = "") {
  if (!jid) {
    return "Conversa";
  }

  if (jid.endsWith("@g.us")) {
    return `Grupo ${jid.slice(0, 12)}`;
  }

  if (jid.endsWith("@newsletter")) {
    return `Canal ${jid.slice(0, 12)}`;
  }

  const digits = jid.replace(/\D/g, "");
  if (!digits) {
    return jid;
  }

  if (digits.length >= 12) {
    const ddi = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const prefix = digits.slice(4, digits.length - 4);
    const suffix = digits.slice(-4);
    return `+${ddi} (${ddd}) ${prefix}-${suffix}`;
  }

  return digits;
}

function normalizeJidInput(value) {
  if (String(value).includes("@")) {
    return String(value).trim();
  }

  const digits = String(value).replace(/\D/g, "");

  if (!digits) {
    throw new Error("Numero invalido.");
  }

  return `${digits}@s.whatsapp.net`;
}

function shouldForwardToWebhook(message, webhookSettings) {
  if (!webhookSettings.webhookUrl) {
    return false;
  }

  if (webhookSettings.webhookIgnoreFromMe && message.fromMe) {
    return false;
  }

  const kind = getConversationKind(message.jid);

  if (webhookSettings.webhookFilterMode === "contacts_only" && kind !== "private") {
    return false;
  }

  if (webhookSettings.webhookFilterMode === "groups_only" && kind !== "group") {
    return false;
  }

  if (webhookSettings.webhookFilterMode === "groups_allowlist") {
    if (kind !== "group") {
      return false;
    }

    if (webhookSettings.webhookGroupAllowlist.length === 0) {
      return false;
    }

    return webhookSettings.webhookGroupAllowlist.includes(message.jid);
  }

  if (
    kind === "group" &&
    webhookSettings.webhookGroupAllowlist.length > 0 &&
    !webhookSettings.webhookGroupAllowlist.includes(message.jid)
  ) {
    return false;
  }

  return true;
}

async function postWebhook(webhookSettings, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 15_000);

  const response = await fetch(webhookSettings.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": webhookSettings.webhookSecret || "",
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Webhook respondeu ${response.status}: ${body || response.statusText}`);
  }

  return {
    status: response.status,
    statusText: response.statusText,
  };
}

function normalizeMessagesStore(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.messages)) {
    return { messages: [] };
  }

  return {
    messages: input.messages.map((message) => ({
      id: message.id || `legacy_${Date.now()}`,
      jid: message.jid || "",
      fromMe: Boolean(message.fromMe),
      text: typeof message.text === "string" ? message.text : "",
      timestamp: normalizeTimestamp(message.timestamp),
      type: message.type || "text",
      status: message.status || "stored",
      pushName: message.pushName || null,
      participant: message.participant || null,
      conversationId: message.conversationId || null,
    })),
  };
}

function normalizeConversationsStore(input) {
  const store = {
    jidToConversationId: {},
    conversations: {},
  };

  if (input?.jidToConversationId && typeof input.jidToConversationId === "object") {
    store.jidToConversationId = input.jidToConversationId;
  }

  if (input?.conversations && typeof input.conversations === "object") {
    for (const [id, conversation] of Object.entries(input.conversations)) {
      store.conversations[id] = {
        jids: Array.isArray(conversation?.jids) ? conversation.jids : [],
        lastJid: conversation?.lastJid || conversation?.jids?.[0] || "",
        updatedAt: Number(conversation?.updatedAt || Date.now()),
        unreadCount: Number(conversation?.unreadCount || 0),
        title: conversation?.title || null,
        kind: conversation?.kind || null,
        preview: conversation?.preview || "",
      };
    }
  }

  return store;
}

function normalizeWebhookSettings(input) {
  const allowlist = Array.isArray(input?.webhookGroupAllowlist)
    ? input.webhookGroupAllowlist
    : String(input?.webhookGroupAllowlist || "")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);

  return {
    webhookUrl: String(input?.webhookUrl || defaultWebhookSettings.webhookUrl || "").trim(),
    webhookSecret: String(
      input?.webhookSecret || defaultWebhookSettings.webhookSecret || "",
    ).trim(),
    webhookFilterMode: ["all", "contacts_only", "groups_only", "groups_allowlist"].includes(
      input?.webhookFilterMode,
    )
      ? input.webhookFilterMode
      : defaultWebhookSettings.webhookFilterMode,
    webhookGroupAllowlist: allowlist,
    webhookIgnoreFromMe:
      typeof input?.webhookIgnoreFromMe === "boolean"
        ? input.webhookIgnoreFromMe
        : defaultWebhookSettings.webhookIgnoreFromMe,
  };
}

async function ensureDirectories() {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.mkdir(config.sessionsDir, { recursive: true });
}

async function readJson(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function createJsonWriter(filePath, logger) {
  let queue = Promise.resolve();

  return async (payload) => {
    queue = queue
      .catch(() => undefined)
      .then(() => fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8"))
      .catch((error) => {
        logger.error({ error, filePath }, "Falha ao persistir arquivo JSON.");
        throw error;
      });

    return queue;
  };
}

function getPathname(rawUrl = "/") {
  return rawUrl.split("?")[0] || "/";
}

function errorToMessage(error) {
  if (!error) {
    return null;
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || String(error);
}
