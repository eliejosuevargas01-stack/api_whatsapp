import {
  apiRequest,
  formatStatus,
  getSessionById,
  loadPanelState,
  savePanelState,
} from "./shared.js?v=20260317-6";

const state = {
  sessions: [],
  selectedSessionId: "",
  refreshTimer: null,
};

const sessionForm = document.getElementById("sessionForm");
const sessionNameInput = document.getElementById("sessionNameInput");
const refreshSessionsButton = document.getElementById("refreshSessionsButton");
const sessionList = document.getElementById("sessionList");
const sessionTitle = document.getElementById("sessionTitle");
const sessionSubtitle = document.getElementById("sessionSubtitle");
const sessionStatus = document.getElementById("sessionStatus");
const sessionNote = document.getElementById("sessionNote");
const sessionAccount = document.getElementById("sessionAccount");
const sessionConversationCount = document.getElementById("sessionConversationCount");
const sessionMessageCount = document.getElementById("sessionMessageCount");
const sessionUnreadCount = document.getElementById("sessionUnreadCount");
const qrFrame = document.getElementById("qrFrame");
const connectButton = document.getElementById("connectButton");
const logoutButton = document.getElementById("logoutButton");
const deleteButton = document.getElementById("deleteButton");

loadInitialState();
bindEvents();
void bootstrap();

function loadInitialState() {
  const saved = loadPanelState();
  state.selectedSessionId = saved.selectedSessionId || "";
}

function bindEvents() {
  sessionForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = sessionNameInput.value.trim();
    if (!name) {
      sessionNameInput.focus();
      return;
    }

    const response = await apiRequest("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      sessionNote.textContent = response.error || "Nao foi possivel criar a sessao.";
      return;
    }

    sessionNameInput.value = "";
    state.selectedSessionId = response.data.session.id;
    persistSelection();
    sessionNote.textContent = "Sessao criada. Clique em conectar para gerar o QR.";
    await refreshSessions(true);
  });

  refreshSessionsButton.addEventListener("click", async () => {
    await refreshSessions(true);
  });

  connectButton.addEventListener("click", async () => {
    await runSessionAction("connect", "Solicitacao de conexao enviada.");
  });

  logoutButton.addEventListener("click", async () => {
    if (!state.selectedSessionId) {
      return;
    }

    const confirmed = window.confirm(
      "Isso vai limpar a autenticacao da sessao. Deseja continuar?",
    );

    if (!confirmed) {
      return;
    }

    await runSessionAction("logout", "Sessao resetada.");
  });

  deleteButton.addEventListener("click", async () => {
    if (!state.selectedSessionId) {
      return;
    }

    const confirmed = window.confirm(
      "Isso vai excluir a sessao e remover o historico local desta sessao. Deseja continuar?",
    );

    if (!confirmed) {
      return;
    }

    const response = await apiRequest(
      `/api/sessions/${encodeURIComponent(state.selectedSessionId)}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      sessionNote.textContent = response.error || "Nao foi possivel excluir a sessao.";
      return;
    }

    state.selectedSessionId = "";
    persistSelection();
    sessionNote.textContent = "Sessao excluida.";
    await refreshSessions(true);
  });
}

async function bootstrap() {
  startAutoRefresh();
  await refreshSessions(true);
}

function startAutoRefresh() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
  }

  state.refreshTimer = window.setInterval(() => {
    void refreshSessions();
  }, 8000);
}

async function refreshSessions(force = false) {
  if (force) {
    sessionList.innerHTML = '<p class="empty">Atualizando sessoes...</p>';
  }

  const response = await apiRequest("/api/sessions");
  if (!response.ok) {
    sessionList.innerHTML = `<p class="empty">${response.error || "Falha ao carregar sessoes."}</p>`;
    return;
  }

  state.sessions = response.data.sessions || [];

  if (state.selectedSessionId) {
    const stillExists = state.sessions.some((session) => session.id === state.selectedSessionId);
    if (!stillExists) {
      state.selectedSessionId = "";
    }
  }

  if (!state.selectedSessionId && state.sessions.length) {
    state.selectedSessionId = state.sessions[0].id;
  }

  persistSelection();
  renderSessions();
  renderSelectedSession();
}

function renderSessions() {
  if (!state.sessions.length) {
    sessionList.innerHTML = '<p class="empty">Nenhuma sessao criada ainda.</p>';
    return;
  }

  sessionList.innerHTML = "";

  state.sessions.forEach((session) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `session-card${session.id === state.selectedSessionId ? " active" : ""}`;
    button.addEventListener("click", () => {
      state.selectedSessionId = session.id;
      persistSelection();
      renderSessions();
      renderSelectedSession();
    });

    const top = document.createElement("div");
    top.className = "session-top";

    const title = document.createElement("strong");
    title.textContent = session.name;

    const badge = document.createElement("span");
    badge.className = `status-pill status-${session.snapshot.status || "idle"}`;
    badge.textContent = formatStatus(session.snapshot.status || "idle");

    const account = document.createElement("p");
    account.className = "card-meta";
    account.textContent = session.snapshot.accountId || "Sem dispositivo conectado";

    const stats = document.createElement("p");
    stats.className = "card-meta";
    stats.textContent =
      `${session.stats.conversationCount} conversas • ${session.stats.messageCount} mensagens`;

    top.append(title, badge);
    button.append(top, account, stats);
    sessionList.appendChild(button);
  });
}

function renderSelectedSession() {
  const session = getSelectedSession();

  if (!session) {
    sessionTitle.textContent = "Nenhuma sessao selecionada";
    sessionSubtitle.textContent = "Crie uma sessao para conectar um novo dispositivo.";
    sessionStatus.className = "status-pill status-idle";
    sessionStatus.textContent = "inativa";
    sessionAccount.textContent = "-";
    sessionConversationCount.textContent = "0";
    sessionMessageCount.textContent = "0";
    sessionUnreadCount.textContent = "0";
    sessionNote.textContent = "O QR aparece aqui somente quando voce clicar em conectar.";
    qrFrame.innerHTML = '<p class="empty">O QR aparece aqui somente quando voce clicar em conectar.</p>';
    setButtonsDisabled(true);
    return;
  }

  setButtonsDisabled(false);
  sessionTitle.textContent = session.name;
  sessionSubtitle.textContent = `ID da sessao: ${session.id}`;
  sessionStatus.className = `status-pill status-${session.snapshot.status || "idle"}`;
  sessionStatus.textContent = formatStatus(session.snapshot.status || "idle");
  sessionAccount.textContent = session.snapshot.accountId || "-";
  sessionConversationCount.textContent = String(session.stats.conversationCount || 0);
  sessionMessageCount.textContent = String(session.stats.messageCount || 0);
  sessionUnreadCount.textContent = String(session.stats.unreadCount || 0);
  sessionNote.textContent = buildSessionNote(session);
  renderQr(session.snapshot.qrDataUrl);
}

function renderQr(dataUrl) {
  qrFrame.innerHTML = "";

  if (!dataUrl) {
    qrFrame.innerHTML = '<p class="empty">Sem QR disponivel no momento.</p>';
    return;
  }

  const image = document.createElement("img");
  image.src = dataUrl;
  image.alt = "QR Code do WhatsApp";
  qrFrame.appendChild(image);
}

function buildSessionNote(session) {
  const status = session.snapshot.status || "idle";

  if (status === "connected") {
    return "Dispositivo conectado. O chat principal fica na pagina de conversas.";
  }

  if (status === "qr") {
    return "Escaneie o QR Code com o WhatsApp para finalizar a conexao.";
  }

  if (status === "connecting") {
    return "A sessao esta abrindo. O QR aparece assim que o WhatsApp responder.";
  }

  if (session.snapshot.lastError) {
    return `Ultimo erro: ${session.snapshot.lastError}`;
  }

  return "Clique em Conectar / gerar QR para iniciar a sessao.";
}

function setButtonsDisabled(disabled) {
  connectButton.disabled = disabled;
  logoutButton.disabled = disabled;
  deleteButton.disabled = disabled;
}

async function runSessionAction(action, successMessage) {
  if (!state.selectedSessionId) {
    return;
  }

  const response = await apiRequest(
    `/api/sessions/${encodeURIComponent(state.selectedSessionId)}/${action}`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    sessionNote.textContent = response.error || "Falha ao executar a acao.";
    return;
  }

  sessionNote.textContent = successMessage;
  await refreshSessions(true);
}

function getSelectedSession() {
  return getSessionById(state.sessions, state.selectedSessionId);
}

function persistSelection() {
  savePanelState({
    selectedSessionId: state.selectedSessionId,
  });
}
