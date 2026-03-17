const defaults = {
  baseUrl: window.location.origin,
  apiKey: '',
  refreshInterval: 15,
  theme: 'sunset',
  webhookUrl: '',
  webhookSecret: '',
  webhookFilterMode: 'all',
  webhookGroupAllowlist: '',
  webhookIgnoreFromMe: true,
};

const state = {
  ...defaults,
  ...loadSettings(),
};

const qrFrame = document.getElementById('qrFrame');
const sessionStatus = document.getElementById('sessionStatus');
const sessionNote = document.getElementById('sessionNote');
const statusCard = document.getElementById('statusCard');
const connectSessionButton = document.getElementById('connectSession');
const refreshStatusButton = document.getElementById('refreshStatus');
const disconnectSessionButton = document.getElementById('disconnectSession');
const logoutSessionButton = document.getElementById('logoutSession');
const webhookForm = document.getElementById('webhookForm');
const webhookFeedback = document.getElementById('webhookFeedback');
const allowlistField = document.getElementById('allowlistField');
const settingsForm = document.getElementById('settingsForm');
const settingsFeedback = document.getElementById('settingsFeedback');
const tabs = document.querySelectorAll('.tab');
const pages = document.querySelectorAll('[data-page]');
const conversationList = document.getElementById('conversationList');
const refreshConversations = document.getElementById('refreshConversations');
const chatTitle = document.getElementById('chatTitle');
const chatMeta = document.getElementById('chatMeta');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const metricConversations = document.getElementById('metricConversations');
const metricMessages = document.getElementById('metricMessages');
const metricGroups = document.getElementById('metricGroups');
const metricWebhook = document.getElementById('metricWebhook');

let intervalId = null;
let activeConversationId = null;
let activeConversation = null;
let conversationsCache = [];
let webhookHydrated = false;

hydrateForms();
bindEvents();
applyTheme(state.theme);
startAutoRefresh();
void refreshAll();

function hydrateForms() {
  settingsForm.baseUrl.value = state.baseUrl;
  settingsForm.apiKey.value = state.apiKey;
  settingsForm.refreshInterval.value = state.refreshInterval;
  settingsForm.theme.value = state.theme;
  webhookForm.webhookUrl.value = state.webhookUrl;
  webhookForm.webhookSecret.value = state.webhookSecret;
  webhookForm.webhookFilterMode.value = state.webhookFilterMode;
  webhookForm.webhookGroupAllowlist.value = state.webhookGroupAllowlist;
  webhookForm.webhookIgnoreFromMe.checked = state.webhookIgnoreFromMe;
  toggleAllowlistField(state.webhookFilterMode);
}

function bindEvents() {
  connectSessionButton.addEventListener('click', () => runSessionAction('/api/whatsapp/connect', 'Conectando...'));
  refreshStatusButton.addEventListener('click', () => refreshAll(true));
  disconnectSessionButton.addEventListener('click', () =>
    runSessionAction('/api/whatsapp/disconnect', 'Desconectando...'),
  );
  logoutSessionButton.addEventListener('click', () =>
    runSessionAction('/api/whatsapp/logout', 'Resetando sessao...'),
  );
  refreshConversations.addEventListener('click', () => fetchConversations(true));

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      pages.forEach((page) => {
        page.classList.toggle('active', page.dataset.page === target);
      });
    });
  });

  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.baseUrl = normalizeBaseUrl(settingsForm.baseUrl.value.trim() || window.location.origin);
    state.apiKey = settingsForm.apiKey.value.trim();
    state.refreshInterval = Number(settingsForm.refreshInterval.value) || defaults.refreshInterval;
    state.theme = settingsForm.theme.value;

    saveSettings(state);
    applyTheme(state.theme);
    startAutoRefresh();
    settingsFeedback.textContent = 'Configuracoes salvas.';
    void refreshAll(true);
  });

  webhookForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    state.webhookUrl = webhookForm.webhookUrl.value.trim();
    state.webhookSecret = webhookForm.webhookSecret.value.trim();
    state.webhookFilterMode = webhookForm.webhookFilterMode.value;
    state.webhookGroupAllowlist = webhookForm.webhookGroupAllowlist.value.trim();
    state.webhookIgnoreFromMe = webhookForm.webhookIgnoreFromMe.checked;
    saveSettings(state);

    webhookFeedback.textContent = 'Salvando configuracao...';

    try {
      const response = await apiRequest('/api/webhook', {
        method: 'PUT',
        body: JSON.stringify({
          webhookUrl: state.webhookUrl,
          webhookSecret: state.webhookSecret,
          webhookFilterMode: state.webhookFilterMode,
          webhookGroupAllowlist: state.webhookGroupAllowlist,
          webhookIgnoreFromMe: state.webhookIgnoreFromMe,
        }),
      });

      if (!response.ok) {
        throw new Error(response.error || 'Nao foi possivel salvar o webhook.');
      }

      syncWebhookSettings(response.data.webhook || {});
      webhookFeedback.textContent = 'Configuracao salva no servidor.';
    } catch (error) {
      webhookFeedback.textContent = `Erro: ${error.message}`;
    }
  });

  webhookForm.webhookFilterMode.addEventListener('change', () => {
    toggleAllowlistField(webhookForm.webhookFilterMode.value);
  });

  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!activeConversation?.lastJid) {
      chatMeta.textContent = 'Selecione uma conversa primeiro.';
      return;
    }

    const input = chatForm.message;
    const text = input.value.trim();
    if (!text) {
      return;
    }

    try {
      const response = await apiRequest('/api/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          jid: activeConversation.lastJid,
          text,
        }),
      });

      if (!response.ok) {
        throw new Error(response.error || 'Falha ao enviar a mensagem.');
      }

      input.value = '';
      await openConversation(activeConversationId);
      await fetchConversations();
    } catch (error) {
      chatMeta.textContent = `Erro: ${error.message}`;
    }
  });
}

async function refreshAll(force = false) {
  await fetchStatus(force);
  await fetchConversations(force);
}

function startAutoRefresh() {
  if (intervalId) {
    clearInterval(intervalId);
  }

  intervalId = window.setInterval(() => {
    void fetchStatus();
    void fetchConversations();
  }, state.refreshInterval * 1000);
}

async function fetchStatus(force = false) {
  if (force) {
    sessionStatus.textContent = 'Atualizando...';
  }

  try {
    const response = await apiRequest('/api/status');
    if (!response.ok) {
      throw new Error(response.error || 'Falha ao buscar status.');
    }

    updateStatus(response.data);
    updateMetrics(response.data.stats || {});
    if (!webhookHydrated) {
      syncWebhookSettings(response.data.webhook || {});
    }
  } catch (error) {
    sessionStatus.textContent = 'Offline';
    sessionNote.textContent = error.message;
    statusCard.dataset.state = 'offline';
    renderQr(null, `Erro: ${error.message}`);
  }
}

async function runSessionAction(path, pendingLabel) {
  sessionStatus.textContent = pendingLabel;

  try {
    const response = await apiRequest(path, { method: 'POST' });
    if (!response.ok) {
      throw new Error(response.error || 'Falha ao executar acao.');
    }

    updateStatus(response.data);
    await fetchConversations();
  } catch (error) {
    sessionStatus.textContent = 'Erro';
    sessionNote.textContent = error.message;
    statusCard.dataset.state = 'offline';
  }
}

async function fetchConversations(force = false) {
  if (force) {
    conversationList.innerHTML = '<p class="small">Atualizando conversas...</p>';
  }

  try {
    const response = await apiRequest('/api/conversations');
    if (!response.ok) {
      throw new Error(response.error || 'Falha ao buscar conversas.');
    }

    conversationsCache = response.data.conversations || [];
    renderConversations(conversationsCache);

    if (activeConversationId) {
      const stillExists = conversationsCache.some((conversation) => conversation.id === activeConversationId);
      if (stillExists) {
        await openConversation(activeConversationId, { preserveSelection: true });
      } else {
        activeConversationId = null;
        activeConversation = null;
        renderMessages([], null);
      }
    }
  } catch (error) {
    conversationList.innerHTML = `<p class="small">Erro: ${error.message}</p>`;
  }
}

async function openConversation(conversationId, options = {}) {
  if (!conversationId) {
    return;
  }

  const response = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}`);
  if (!response.ok) {
    throw new Error(response.error || 'Falha ao abrir a conversa.');
  }

  activeConversationId = conversationId;
  activeConversation = response.data.conversation || null;
  renderConversations(conversationsCache);
  renderMessages(response.data.messages || [], activeConversation);

  if (!options.preserveSelection) {
    await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: 'POST',
    });
  }
}

function renderConversations(conversations) {
  if (!conversations.length) {
    conversationList.innerHTML = '<p class="small">Nenhuma conversa ainda.</p>';
    return;
  }

  conversationList.innerHTML = '';

  conversations.forEach((conversation) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `conversation${conversation.id === activeConversationId ? ' active' : ''}`;

    const top = document.createElement('div');
    top.className = 'conversation-top';

    const title = document.createElement('strong');
    title.textContent = conversation.title || conversation.lastJid || 'Conversa';

    const unread = document.createElement('span');
    unread.className = 'conversation-badge';
    unread.textContent = conversation.unreadCount ? String(conversation.unreadCount) : '';
    unread.hidden = !conversation.unreadCount;

    top.append(title, unread);

    const jid = document.createElement('span');
    jid.className = 'jid';
    jid.textContent = conversation.lastJid || '-';

    const preview = document.createElement('span');
    preview.className = 'preview';
    preview.textContent = conversation.lastMessagePreview || 'Sem mensagens ainda.';

    row.append(top, jid, preview);
    row.addEventListener('click', async () => {
      try {
        await openConversation(conversation.id);
      } catch (error) {
        chatMeta.textContent = `Erro: ${error.message}`;
      }
    });

    conversationList.appendChild(row);
  });
}

function renderMessages(messages, conversation) {
  chatTitle.textContent = conversation?.title || 'Selecione uma conversa';
  chatMeta.textContent = conversation
    ? `${messages.length} mensagens${conversation.lastJid ? ` • ${conversation.lastJid}` : ''}`
    : 'Sem conversa selecionada.';

  if (!messages.length) {
    chatMessages.innerHTML = '<p class="empty">Sem mensagens para mostrar.</p>';
    return;
  }

  chatMessages.innerHTML = '';

  messages.forEach((message) => {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${message.fromMe ? 'out' : 'in'}`;

    const text = document.createElement('div');
    text.textContent = message.text || `[${message.type || 'mensagem'}]`;

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = formatDateTime(message.timestamp);

    wrapper.append(text, meta);
    chatMessages.appendChild(wrapper);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateStatus(data) {
  const snapshot = data.whatsapp || {};
  const status = snapshot.status || 'idle';
  const accountId = snapshot.me?.id || snapshot.me?.name || snapshot.me?.verifiedName || '';

  sessionStatus.textContent = formatStatus(status);
  sessionNote.textContent = accountId
    ? `Conta conectada: ${accountId}`
    : snapshot.lastError
      ? `Ultimo erro: ${snapshot.lastError}`
      : status === 'qr'
        ? 'Escaneie o QR Code com o WhatsApp.'
        : 'API e painel ativos no mesmo deploy.';
  statusCard.dataset.state = status;

  renderQr(
    snapshot.qrDataUrl || null,
    status === 'connected'
      ? 'Sessao conectada.'
      : status === 'connecting'
        ? 'Abrindo sessao no WhatsApp...'
        : 'Sem QR disponivel no momento.',
  );
}

function updateMetrics(stats) {
  metricConversations.textContent = String(stats.conversationCount || 0);
  metricMessages.textContent = String(stats.messageCount || 0);
  metricGroups.textContent = String(stats.groupCount || 0);
  metricWebhook.textContent = stats.webhookConfigured ? 'Sim' : 'Nao';
}

function syncWebhookSettings(webhook) {
  const normalizedAllowlist = Array.isArray(webhook.webhookGroupAllowlist)
    ? webhook.webhookGroupAllowlist.join('\n')
    : String(webhook.webhookGroupAllowlist || '');

  state.webhookUrl = webhook.webhookUrl || '';
  state.webhookSecret = webhook.webhookSecret || '';
  state.webhookFilterMode = webhook.webhookFilterMode || 'all';
  state.webhookGroupAllowlist = normalizedAllowlist;
  state.webhookIgnoreFromMe = webhook.webhookIgnoreFromMe !== false;

  saveSettings(state);

  webhookForm.webhookUrl.value = state.webhookUrl;
  webhookForm.webhookSecret.value = state.webhookSecret;
  webhookForm.webhookFilterMode.value = state.webhookFilterMode;
  webhookForm.webhookGroupAllowlist.value = state.webhookGroupAllowlist;
  webhookForm.webhookIgnoreFromMe.checked = state.webhookIgnoreFromMe;
  toggleAllowlistField(state.webhookFilterMode);
  webhookHydrated = true;
}

function renderQr(imageSource, fallback) {
  qrFrame.innerHTML = '';

  if (!imageSource) {
    const placeholder = document.createElement('span');
    placeholder.className = 'qr-placeholder';
    placeholder.textContent = fallback || 'Aguardando QR Code...';
    qrFrame.appendChild(placeholder);
    return;
  }

  const image = document.createElement('img');
  image.alt = 'QR Code do WhatsApp';
  image.src = imageSource;
  qrFrame.appendChild(image);
}

async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(state.apiKey ? { 'x-api-key': state.apiKey, Authorization: `Bearer ${state.apiKey}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${normalizeBaseUrl(state.baseUrl)}${path}`, {
    ...options,
    headers,
  });

  const data = await safeJson(response);
  return { ok: response.ok, data, error: data?.message || data?.error };
}

function safeJson(response) {
  return response.json().catch(() => ({}));
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('waPanelSettings') || '{}');
  } catch {
    return {};
  }
}

function saveSettings(value) {
  localStorage.setItem('waPanelSettings', JSON.stringify(value));
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
}

function toggleAllowlistField(mode) {
  allowlistField.classList.toggle('hidden', mode !== 'groups_allowlist');
}

function normalizeBaseUrl(value) {
  return String(value || window.location.origin).replace(/\/+$/, '');
}

function formatStatus(status) {
  const map = {
    idle: 'Inativo',
    connecting: 'Conectando',
    qr: 'Aguardando QR',
    connected: 'Conectado',
    disconnected: 'Desconectado',
    logged_out: 'Sessao resetada',
    offline: 'Offline',
  };

  return map[status] || status;
}

function formatDateTime(value) {
  if (!value) {
    return 'sem data';
  }

  const timestamp = Number(value) < 1_000_000_000_000 ? Number(value) * 1000 : Number(value);
  return new Date(timestamp).toLocaleString('pt-BR');
}
