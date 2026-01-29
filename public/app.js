const defaults = {
  baseUrl: 'http://localhost:3000',
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
const statusCard = document.getElementById('statusCard');
const refreshStatusButton = document.getElementById('refreshStatus');
const disconnectSessionButton = document.getElementById('disconnectSession');
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

let activeJid = null;

applyTheme(state.theme);

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

refreshStatusButton.addEventListener('click', () => fetchStatus(true));
disconnectSessionButton.addEventListener('click', () => disconnectSession());
refreshConversations.addEventListener('click', () => fetchConversations(true));

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    pages.forEach((page) => {
      if (page.dataset.page === target) {
        page.classList.add('active');
      } else {
        page.classList.remove('active');
      }
    });
  });
});

settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.baseUrl = settingsForm.baseUrl.value.trim();
  state.apiKey = settingsForm.apiKey.value.trim();
  state.refreshInterval = Number(settingsForm.refreshInterval.value) || defaults.refreshInterval;
  state.theme = settingsForm.theme.value;

  saveSettings(state);
  applyTheme(state.theme);
  settingsFeedback.textContent = 'Configuracoes salvas localmente.';
  fetchStatus(true);
  fetchConversations(true);
});

webhookForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  state.webhookUrl = webhookForm.webhookUrl.value.trim();
  state.webhookSecret = webhookForm.webhookSecret.value.trim();
  state.webhookFilterMode = webhookForm.webhookFilterMode.value;
  state.webhookGroupAllowlist = webhookForm.webhookGroupAllowlist.value;
  state.webhookIgnoreFromMe = webhookForm.webhookIgnoreFromMe.checked;
  saveSettings(state);

  webhookFeedback.textContent = 'Enviando para a API...';

  try {
    const response = await apiRequest('/webhook', {
      method: 'POST',
      body: JSON.stringify({
        webhookUrl: state.webhookUrl,
        webhookSecret: state.webhookSecret,
        webhookFilterMode: state.webhookFilterMode,
        webhookGroupAllowlist: state.webhookGroupAllowlist,
        webhookIgnoreFromMe: state.webhookIgnoreFromMe,
      }),
    });

    if (!response.ok) {
      throw new Error(response.error || 'Nao foi possivel salvar');
    }

    webhookFeedback.textContent = 'Configuracao salva no servidor.';
  } catch (error) {
    webhookFeedback.textContent = `Erro: ${error.message}`;
  }
});

webhookForm.webhookFilterMode.addEventListener('change', () => {
  toggleAllowlistField(webhookForm.webhookFilterMode.value);
});

let intervalId = null;
startAutoRefresh();
fetchStatus();
fetchConversations();

function startAutoRefresh() {
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(fetchStatus, state.refreshInterval * 1000);
}

async function fetchStatus(force) {
  if (!state.baseUrl || !state.apiKey) {
    sessionStatus.textContent = 'Configure a API Key';
    return;
  }

  if (force) {
    sessionStatus.textContent = 'Atualizando...';
  }

  try {
    const response = await apiRequest('/status');
    if (!response.ok) {
      throw new Error(response.error || 'Falha ao buscar status');
    }

    updateStatus(response.data);
  } catch (error) {
    sessionStatus.textContent = 'Offline';
    statusCard.dataset.state = 'offline';
    renderQr(null, `Erro: ${error.message}`);
  }
}

async function disconnectSession() {
  if (!state.baseUrl || !state.apiKey) {
    sessionStatus.textContent = 'Configure a API Key';
    return;
  }

  sessionStatus.textContent = 'Desconectando...';
  try {
    const response = await apiRequest('/session/disconnect', {
      method: 'POST',
      body: JSON.stringify({ reset: true }),
    });
    if (!response.ok) {
      throw new Error(response.error || 'Falha ao desconectar');
    }
    fetchStatus(true);
  } catch (error) {
    sessionStatus.textContent = 'Erro ao desconectar';
    statusCard.dataset.state = 'offline';
    renderQr(null, `Erro: ${error.message}`);
  }
}

async function fetchConversations(force) {
  if (!state.baseUrl || !state.apiKey) return;

  if (force) {
    conversationList.innerHTML = '<p class="small">Atualizando...</p>';
  }

  try {
    const response = await apiRequest('/conversations');
    if (!response.ok) {
      throw new Error(response.error || 'Falha ao buscar conversas');
    }
    renderConversations(response.data.conversations || []);
    if (activeJid) {
      await fetchMessages(activeJid);
    }
  } catch (error) {
    conversationList.innerHTML = `<p class="small">Erro: ${error.message}</p>`;
  }
}

async function fetchMessages(jid) {
  const response = await apiRequest(`/conversations/${encodeURIComponent(jid)}/messages`);
  if (!response.ok) {
    throw new Error(response.error || 'Falha ao buscar mensagens');
  }
  renderMessages(jid, response.data.messages || []);
}

function renderConversations(conversations) {
  if (!conversations.length) {
    conversationList.innerHTML = '<p class="small">Nenhuma conversa ainda.</p>';
    return;
  }

  conversationList.innerHTML = '';
  conversations.forEach((item) => {
    const row = document.createElement('div');
    row.className = `conversation${item.jid === activeJid ? ' active' : ''}`;
    row.innerHTML = `
      <strong>${item.lastMessage || 'Sem texto'}</strong>
      <span class="jid">${item.jid}</span>
    `;
    row.addEventListener('click', async () => {
      activeJid = item.jid;
      renderConversations(conversations);
      await fetchMessages(item.jid);
    });
    conversationList.appendChild(row);
  });
}

function renderMessages(jid, messages) {
  chatTitle.textContent = jid;
  chatMeta.textContent = `${messages.length} mensagens`;

  if (!messages.length) {
    chatMessages.innerHTML = '<p class="empty">Sem mensagens para mostrar.</p>';
    return;
  }

  chatMessages.innerHTML = '';
  messages.forEach((message) => {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${message.fromMe ? 'out' : 'in'}`;
    wrapper.textContent = message.text || '';
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = new Date(message.timestamp * 1000).toLocaleString();
    wrapper.appendChild(meta);
    chatMessages.appendChild(wrapper);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeJid) {
    chatMeta.textContent = 'Selecione uma conversa primeiro.';
    return;
  }

  const input = chatForm.message;
  const text = input.value.trim();
  if (!text) return;

  try {
    const response = await apiRequest('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ to: activeJid, message: text }),
    });
    if (!response.ok) {
      throw new Error(response.error || 'Falha ao enviar');
    }
    input.value = '';
    await fetchMessages(activeJid);
  } catch (error) {
    chatMeta.textContent = `Erro: ${error.message}`;
  }
});
function updateStatus(data) {
  const status = data.status || 'desconhecido';
  sessionStatus.textContent = status;
  statusCard.dataset.state = status;

  if (data.qr) {
    renderQr(data.qr);
  } else {
    renderQr(null, status === 'connected' ? 'Sessao conectada' : 'Sem QR disponivel');
  }
}

function renderQr(qrText, fallback) {
  qrFrame.innerHTML = '';

  if (!qrText) {
    const placeholder = document.createElement('span');
    placeholder.className = 'qr-placeholder';
    placeholder.textContent = fallback || 'Aguardando QR Code...';
    qrFrame.appendChild(placeholder);
    return;
  }

  const image = document.createElement('img');
  image.alt = 'QR Code';
  image.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrText)}`;
  qrFrame.appendChild(image);
}

function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${state.apiKey}`,
    ...(options.headers || {}),
  };

  return fetch(`${state.baseUrl}${path}`, {
    ...options,
    headers,
  })
    .then(async (response) => {
      const data = await safeJson(response);
      return { ok: response.ok, data, error: data?.error };
    });
}

function safeJson(response) {
  return response.json().catch(() => ({}));
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('waPanelSettings') || '{}');
  } catch (error) {
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
  if (mode === 'groups_allowlist') {
    allowlistField.classList.remove('hidden');
  } else {
    allowlistField.classList.add('hidden');
  }
}
