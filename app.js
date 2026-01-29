const form = document.querySelector("#debtor-form");
const list = document.querySelector("#debtors-list");
const logsContainer = document.querySelector("#logsContainer");
const pendingChip = document.querySelector(".list .chip");
const submitButton = form ? form.querySelector("button[type='submit']") : null;

const chatBubbles = document.querySelector("#chatBubbles");
const chatEmpty = document.querySelector("#chatEmpty");
const chatSummary = document.querySelector("#chatSummary");
const chatDebtorName = document.querySelector("#chatDebtorName");
const chatDebtorMeta = document.querySelector("#chatDebtorMeta");
const chatStatus = document.querySelector("#chatStatus");
const chatRecovered = document.querySelector("#chatRecovered");
const replyForm = document.querySelector("#replyForm");
const replyInput = document.querySelector("#replyInput");

const DEMO_MODE = true;
const DEMO_DATA_URL = "demo-conversations.json";

const logDebtorName = document.querySelector("#logDebtorName");
const logDebtorPhone = document.querySelector("#logDebtorPhone");
const logDebtAmount = document.querySelector("#logDebtAmount");
const logStatus = document.querySelector("#logStatus");
const statMessages = document.querySelector("#statMessages");
const statProposals = document.querySelector("#statProposals");

const WEBHOOK_URL = "https://myn8n.seommerce.shop/webhook/agente-cld-demo";
const storeProfile = {
  name: "Loja Vitoria",
  portfolio: "R$ 84.500,00",
  recoveredMonth: "R$ 18.920,00",
  responseRate: "61%",
  paymentAvg: "R$ 512,00",
  activeCampaigns: 3,
  negotiationDiscount: "20%",
  negotiationDiscountMin: "10%",
  negotiationDiscountMax: "30%",
  tone: "Profissional e cordial",
  roiLimit: "1,8x",
};

const conversations = new Map();
let activeConversationId = null;

const formatDate = (value) => {
  if (!value) {
    return "data nao informada";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("pt-BR");
};

const parseBrazilianDate = (value) => {
  if (!value) {
    return "";
  }

  const parts = value.split("/");
  if (parts.length !== 3) {
    return value;
  }

  const [day, month, year] = parts;
  if (!day || !month || !year) {
    return value;
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

const toNumber = (text) => {
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 0;
};

const formatTime = () =>
  new Date().toLocaleTimeString("pt-BR", { hour12: false });

const setText = (element, value) => {
  if (element) {
    element.textContent = value;
  }
};

let pendingCount = pendingChip ? toNumber(pendingChip.textContent) : 0;

const setPendingCount = (count) => {
  pendingCount = count;
  if (pendingChip) {
    pendingChip.textContent = `${pendingCount} em acompanhamento`;
  }
};

const addPending = () => {
  if (!pendingChip) {
    return;
  }

  pendingCount += 1;
  pendingChip.textContent = `${pendingCount} em acompanhamento`;
};

const setSubmitState = (isSubmitting) => {
  if (!submitButton) {
    return;
  }

  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? "Registrando..." : "Adicionar a carteira";
};

const ensureChatEmpty = (isEmpty) => {
  if (!chatEmpty) {
    return;
  }

  chatEmpty.style.display = isEmpty ? "grid" : "none";
};

const clearChatBubbles = () => {
  if (!chatBubbles) {
    return;
  }

  Array.from(chatBubbles.querySelectorAll(".bubble")).forEach((bubble) => {
    bubble.remove();
  });
};

const normalizeActionOptions = (options = []) =>
  options
    .map((option) => {
      if (typeof option === "string") {
        return { label: option };
      }
      if (option && typeof option === "object") {
        return {
          label: option.label || option.text || option.title || option.value || option.name,
          value: option.value || option.label || option.text || option.title || option.name,
        };
      }
      return null;
    })
    .filter((option) => option && option.label);

const getMessageActions = (message) => {
  if (!message || typeof message !== "object") {
    return null;
  }

  if (message.actions && typeof message.actions === "object") {
    const options = normalizeActionOptions(message.actions.options || []);
    if (!options.length) {
      return null;
    }
    return {
      type: message.actions.type || "buttons",
      title: message.actions.title || null,
      options,
    };
  }

  if (Array.isArray(message.actions)) {
    const options = normalizeActionOptions(message.actions);
    if (!options.length) {
      return null;
    }
    return { type: "buttons", title: null, options };
  }

  const quickReplies =
    message.quickReplies || message.quick_replies || message.buttons || message.options;
  if (Array.isArray(quickReplies) && quickReplies.length) {
    return {
      type: "buttons",
      title: message.title || null,
      options: normalizeActionOptions(quickReplies),
    };
  }

  return null;
};

const renderMessageActions = (bubble, message) => {
  const actions = getMessageActions(message);
  if (!actions || !bubble) {
    return;
  }

  const actionWrap = document.createElement("div");
  actionWrap.className = `chat-actions ${actions.type === "list" ? "list" : "buttons"}`;

  if (actions.title) {
    const title = document.createElement("p");
    title.className = "actions-title";
    title.textContent = actions.title;
    actionWrap.appendChild(title);
  }

  actions.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      if (replyInput) {
        replyInput.value = option.value || option.label;
        replyInput.focus();
      }
    });
    actionWrap.appendChild(button);
  });

  bubble.appendChild(actionWrap);
};

const renderMessages = (messages) => {
  if (!chatBubbles) {
    return;
  }

  clearChatBubbles();

  if (!messages.length) {
    ensureChatEmpty(true);
    return;
  }

  ensureChatEmpty(false);

  messages.forEach((message) => {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.sender === "user" ? "user" : "agent"}`;

    const text = document.createElement("p");
    text.textContent = message.text;

    bubble.appendChild(text);
    if (message.sender !== "user") {
      renderMessageActions(bubble, message);
    }
    chatBubbles.appendChild(bubble);
  });

  chatBubbles.scrollTop = chatBubbles.scrollHeight;
};

const updateStats = (conversation) => {
  setText(statMessages, conversation.messages.length.toString());
  setText(statProposals, conversation.proposals.toString());
};

const updateDebtorPanel = (conversation) => {
  setText(logDebtorName, conversation.debtor.name || "-");
  setText(logDebtorPhone, conversation.debtor.phone || "-");
  setText(logDebtAmount, conversation.debtor.amount || "-");
  setText(logStatus, conversation.status || "Aguardando inicio");
};

const getStatusClass = (statusText) => {
  const value = statusText.toLowerCase();
  if (value.includes("falha") || value.includes("erro") || value.includes("ajuste")) {
    return "warning";
  }
  if (
    value.includes("pagou") ||
    value.includes("acordo") ||
    value.includes("confirmado") ||
    value.includes("finalizado")
  ) {
    return "success";
  }
  if (value.includes("sem acordo") || value.includes("recusa")) {
    return "warning";
  }
  if (value.includes("negociando") || value.includes("negociacao") || value.includes("proposta")) {
    return "info";
  }
  if (value.includes("em contato") || value.includes("aguardando")) {
    return "warning";
  }
  return "info";
};

const setChatStatus = (statusText) => {
  if (!chatStatus) {
    return;
  }

  chatStatus.textContent = statusText;
  chatStatus.classList.remove("success", "warning", "info");
  chatStatus.classList.add(getStatusClass(statusText));
};

const updateChatHeader = (conversation) => {
  setText(chatDebtorName, `Devedor: ${conversation.debtor.name || "-"}`);
  setText(
    chatDebtorMeta,
    conversation.debtor.amount
      ? `${conversation.debtor.amount} - vencimento ${formatDate(conversation.debtor.due)}`
      : "Aguardando inicio da negociacao"
  );
  setChatStatus(conversation.status || "pronto");
};

const updateChatSummary = (summary) => {
  setText(chatSummary, summary || "Resumo da negociacao pendente.");
};

const parseCurrencyValue = (value) => {
  if (!value) {
    return 0;
  }

  const normalized = value
    .toString()
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const getRecoveredValue = (conversation) => {
  if (conversation.recovered) {
    return conversation.recovered;
  }

  const status = (conversation.status || "").toLowerCase();
  if (status.includes("pagou") || status.includes("acordo") || status.includes("finalizado")) {
    return conversation.debtor.amount || "R$ 0,00";
  }

  if (status.includes("negociando") || status.includes("proposta")) {
    const amountValue = parseCurrencyValue(conversation.debtor.amount);
    const estimate = amountValue ? amountValue * 0.65 : 0;
    return formatCurrency(estimate) || "R$ 0,00";
  }

  return "R$ 0,00";
};

const updateRecovered = (conversation) => {
  const recoveredValue = getRecoveredValue(conversation);

  if (chatRecovered) {
    chatRecovered.textContent = recoveredValue;
  }

  if (conversation.rowRecovered) {
    conversation.rowRecovered.textContent = recoveredValue;
  }

  if (!conversation.recovered) {
    conversation.recovered = recoveredValue;
  }
};

const setActiveLogItem = (id) => {
  if (!logsContainer) {
    return;
  }

  Array.from(logsContainer.querySelectorAll(".log-item")).forEach((item) => {
    item.classList.toggle("active", item.dataset.conversationId === id);
  });
};

const setActiveRow = (id) => {
  if (!list) {
    return;
  }

  Array.from(list.querySelectorAll(".row")).forEach((row) => {
    row.classList.toggle("active", row.dataset.conversationId === id);
  });
};

const selectConversation = (id) => {
  const conversation = conversations.get(id);
  if (!conversation) {
    return;
  }

  activeConversationId = id;
  updateDebtorPanel(conversation);
  updateChatHeader(conversation);
  updateRecovered(conversation);
  updateChatSummary(conversation.summary);
  renderMessages(conversation.messages);
  updateStats(conversation);
  setActiveLogItem(id);
  setActiveRow(id);
};

const createLogItem = ({ id, message, variant }) => {
  const logItem = document.createElement("button");
  logItem.type = "button";
  logItem.className = `log-item ${variant || "info"}`;
  const time = document.createElement("div");
  time.className = "log-time";
  time.textContent = formatTime();

  const text = document.createElement("div");
  text.className = "log-message";
  text.textContent = message;

  logItem.append(time, text);

  if (id) {
    logItem.dataset.conversationId = id;
  }

  return logItem;
};

const prependLogItem = (item) => {
  if (!logsContainer) {
    return;
  }

  logsContainer.prepend(item);
};

const normalizeSender = (value) => {
  const sender = (value || "").toString().toLowerCase();
  if (["user", "cliente", "devedor", "debtor"].includes(sender)) {
    return "user";
  }
  return "agent";
};

const unwrapPayload = (value, depth = 0) => {
  if (depth > 4 || value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 1) {
      return unwrapPayload(value[0], depth + 1);
    }
    return value;
  }

  if (typeof value === "object") {
    const wrapperKeys = [
      "body",
      "data",
      "result",
      "response",
      "output",
      "json",
      "payload",
      "return",
      "retorno",
    ];
    for (const key of wrapperKeys) {
      if (value[key] !== undefined && value[key] !== null) {
        return unwrapPayload(value[key], depth + 1);
      }
    }
  }

  return value;
};

const normalizeMessageItem = (item) => {
  if (typeof item === "string") {
    return { sender: "agent", text: item };
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  const text =
    item.text ||
    item.message ||
    item.mensagem ||
    item.conteudo ||
    item.content ||
    item.body;

  if (!text) {
    return null;
  }

  return {
    sender: normalizeSender(item.sender || item.role || item.from || item.autor || item.author),
    text: text.toString(),
    actions:
      item.actions ||
      item.botoes ||
      item.buttons ||
      item.list ||
      item.quickReplies ||
      item.quick_replies ||
      item.options ||
      null,
  };
};

const findMessagesIn = (value, depth = 0) => {
  if (depth > 5 || value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    const normalized = value.map(normalizeMessageItem).filter(Boolean);
    if (normalized.length) {
      return normalized;
    }

    for (const item of value) {
      const nested = findMessagesIn(item, depth + 1);
      if (nested.length) {
        return nested;
      }
    }

    return [];
  }

  if (typeof value !== "object") {
    return [];
  }

  const direct = normalizeMessageItem(value);
  if (direct) {
    return [direct];
  }

  const messageKeys = ["messages", "mensagens", "conversation", "conversa", "chat", "history", "transcript"];
  for (const key of messageKeys) {
    if (value[key] !== undefined) {
      const nested = findMessagesIn(value[key], depth + 1);
      if (nested.length) {
        return nested;
      }
    }
  }

  for (const key of Object.keys(value)) {
    const nestedValue = value[key];
    if (nestedValue && typeof nestedValue === "object") {
      const nested = findMessagesIn(nestedValue, depth + 1);
      if (nested.length) {
        return nested;
      }
    }
  }

  return [];
};

const normalizeMessages = (data) => {
  if (!data) {
    return [];
  }

  if (typeof data === "string") {
    return [{ sender: "agent", text: data }];
  }

  const unwrapped = unwrapPayload(data);
  if (typeof unwrapped === "string") {
    return [{ sender: "agent", text: unwrapped }];
  }

  const candidates = [data, unwrapped];
  for (const candidate of candidates) {
    const messages = findMessagesIn(candidate);
    if (messages.length) {
      return messages;
    }
  }

  const fallbackMessage =
    buildMessageFromResponse(unwrapped) || buildMessageFromResponse(data);

  return fallbackMessage ? [fallbackMessage] : [];
};

const buildMessageFromResponse = (payload) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const response =
    payload.response ||
    payload.output?.response ||
    payload.result?.response ||
    payload;

  if (!response || typeof response !== "object") {
    return null;
  }

  const content =
    response.content ||
    response.message ||
    response.text ||
    response.mensagem ||
    response.conteudo;

  if (!content) {
    return null;
  }

  let text = content.toString();
  const options = response.options;

  const hasOptionLines = /\n\s*1[.)]?\s+/i.test(text) || /opcao/i.test(text);

    if (Array.isArray(options) && options.length && !hasOptionLines) {
      const optionLines = options.map((option, index) => {
      const label =
        option.description || option.label || option.title || `Opcao ${index + 1}`;
      const amount = formatCurrency(option.amount);
      const installments = option.installments
        ? `${option.installments}x`
        : null;
      const dueDate = option.due_date ? formatDate(option.due_date) : null;
      const extras = [amount, installments, dueDate && `venc. ${dueDate}`]
        .filter(Boolean)
        .join(" ");

      return extras ? `${index + 1}. ${label} - ${extras}` : `${index + 1}. ${label}`;
    });

      text += `\n\nOpcoes:\n${optionLines.join("\n")}`;
    }

    const quickReplies = response.quick_replies || response.quickReplies;
    const hasQuickReplies = /respostas? rapidas/i.test(text);
    if (Array.isArray(quickReplies) && quickReplies.length && !hasQuickReplies) {
      text += `\n\nRespostas rapidas: ${quickReplies.join(" | ")}`;
    }

  const actionOptions =
    (Array.isArray(quickReplies) && quickReplies.length && quickReplies) ||
    (Array.isArray(options) && options.length && options.map((option) => option.label || option.title || option));

  return actionOptions
    ? { sender: "agent", text, actions: { type: "buttons", title: "Escolha uma opcao", options: actionOptions } }
    : { sender: "agent", text };
};

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  if (Number.isNaN(number)) {
    return value.toString();
  }

  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
};

const getSummaryValue = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  return (
    value.summary ||
    value.resumo ||
    value.aiSummary ||
    value.insights ||
    value.observacoes ||
    value.resultado
  );
};

const extractSummary = (data, messages, debtor) => {
  const payload = unwrapPayload(data);
  const summary = getSummaryValue(payload) || getSummaryValue(data);

  if (Array.isArray(summary)) {
    return summary.join(" ");
  }

  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }

  if (messages.length) {
    const snippet = messages[0].text.slice(0, 140);
    return `Resumo da negociacao: ${snippet}${
      messages[0].text.length > 140 ? "..." : ""
    }`;
  }

  if (debtor?.name) {
    return `Aguardando interacao do devedor ${debtor.name}.`;
  }

  return "Aguardando andamento da negociacao.";
};

const extractProposalCount = (data, messages, offer) => {
  const payload = Array.isArray(data) && data.length === 1 ? data[0] : data;
  const proposals = payload?.propostas || payload?.proposals || payload?.offers;

  if (Array.isArray(proposals)) {
    return proposals.length;
  }

  if (typeof proposals === "number") {
    return proposals;
  }

  if (typeof proposals === "string" && proposals.trim()) {
    return 1;
  }

  if (offer) {
    return 1;
  }

  const combined = messages.map((message) => message.text.toLowerCase()).join(" ");
  if (combined.includes("proposta") || combined.includes("desconto") || combined.includes("parcel")) {
    return 1;
  }

  return 0;
};

const updateConversation = (conversation) => {
  conversations.set(conversation.id, conversation);
  if (conversation.rowRecovered) {
    conversation.rowRecovered.textContent = getRecoveredValue(conversation);
  }
  if (conversation.rowStatus && conversation.status) {
    conversation.rowStatus.textContent = conversation.status;
    conversation.rowStatus.classList.remove("success", "warning", "info");
    conversation.rowStatus.classList.add(getStatusClass(conversation.status));
  }
  if (activeConversationId === conversation.id) {
    selectConversation(conversation.id);
  }
};

const formatDueForDisplay = (value) => {
  if (!value) {
    return "data nao informada";
  }

  if (value.includes("/")) {
    return value;
  }

  return formatDate(value);
};

const normalizeDueValue = (value) => {
  if (!value) {
    return "";
  }

  if (value.includes("/")) {
    return parseBrazilianDate(value);
  }

  return value;
};

const buildRowFromDemo = (demo) => {
  const row = document.createElement("div");
  row.className = "row";

  const rowInfo = document.createElement("div");
  const rowName = document.createElement("p");
  rowName.className = "value";
  rowName.textContent = demo.debtor.name;

  const rowMeta = document.createElement("p");
  rowMeta.className = "meta";
  const dueDisplay = demo.debtor.dueDisplay || demo.debtor.due;
  rowMeta.textContent = `${demo.debtor.amount} - ${formatDueForDisplay(dueDisplay)}`;

  const rowRecover = document.createElement("p");
  rowRecover.className = "recover";
  const rowRecoverLabel = document.createElement("span");
  rowRecoverLabel.textContent = "Recuperado: ";
  const rowRecoverValue = document.createElement("span");
  rowRecoverValue.className = "recover-value";
  rowRecoverValue.dataset.recovered = "true";
  rowRecoverValue.textContent = demo.recovered || "R$ 0,00";
  rowRecover.append(rowRecoverLabel, rowRecoverValue);

  rowInfo.append(rowName, rowMeta, rowRecover);

  const rowStatus = document.createElement("span");
  rowStatus.className = `status ${getStatusClass(demo.status || "em contato")}`;
  rowStatus.textContent = demo.status || "em contato";

  row.append(rowInfo, rowStatus);

  return { row, rowStatus, rowRecovered: rowRecoverValue };
};

const seedDemoConversations = (demoData = []) => {
  if (!list) {
    return;
  }

  list.innerHTML = "";
  conversations.clear();
  activeConversationId = null;

  const normalized = demoData
    .map((demo) => {
      if (!demo || !demo.debtor) {
        return null;
      }

      const id = demo.id || `demo-${demo.debtor.name.toLowerCase().replace(/\s+/g, "-")}`;
      const dueRaw = demo.debtor.due || "";
      const conversation = {
        id,
        debtor: {
          ...demo.debtor,
          due: normalizeDueValue(dueRaw),
          dueDisplay: dueRaw,
        },
        messages: Array.isArray(demo.messages) ? demo.messages : [],
        summary: demo.summary || "Aguardando andamento da negociacao.",
        status: demo.status || "em contato",
        proposals: Number.isFinite(demo.proposals) ? demo.proposals : 0,
        recovered: demo.recovered || "R$ 0,00",
      };

      return conversation;
    })
    .filter(Boolean);

  normalized.forEach((conversation) => {
    const rowParts = buildRowFromDemo(conversation);
    conversation.row = rowParts.row;
    conversation.rowStatus = rowParts.rowStatus;
    conversation.rowRecovered = rowParts.rowRecovered;
    conversation.row.dataset.conversationId = conversation.id;

    list.append(conversation.row);
    conversations.set(conversation.id, conversation);
  });

  setPendingCount(normalized.length);

  if (!activeConversationId && normalized.length) {
    selectConversation(normalized[0].id);
  }
};

const loadDemoConversations = async () => {
  try {
    const response = await fetch(DEMO_DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }

    const data = await response.json();
    if (Array.isArray(data)) {
      return data;
    }

    if (data && Array.isArray(data.conversations)) {
      return data.conversations;
    }
  } catch (error) {
    return [];
  }

  return [];
};

const buildPayload = (
  debtor,
  negotiationDiscount,
  negotiationDiscountMin,
  negotiationDiscountMax,
  negotiationTone,
  roiLimit
) => ({
  lojista: {
    ...storeProfile,
    negotiationDiscount:
      negotiationDiscount || storeProfile.negotiationDiscount || null,
    negotiationDiscountMin:
      negotiationDiscountMin || storeProfile.negotiationDiscountMin || null,
    negotiationDiscountMax:
      negotiationDiscountMax || storeProfile.negotiationDiscountMax || null,
    tone: negotiationTone || storeProfile.tone || null,
    roiLimit: roiLimit || storeProfile.roiLimit || null,
  },
  devedor: debtor,
  origem: "painel-demo-cdl",
});

if (logsContainer) {
  logsContainer.addEventListener("click", (event) => {
    const logButton = event.target.closest(".log-item");
    if (!logButton || !logsContainer.contains(logButton)) {
      return;
    }

    const id = logButton.dataset.conversationId;
    if (id) {
      selectConversation(id);
    }
  });
}

if (list) {
  list.addEventListener("click", (event) => {
    const row = event.target.closest(".row");
    if (!row || !list.contains(row)) {
      return;
    }

    const id = row.dataset.conversationId;
    if (id) {
      selectConversation(id);
    }
  });
}

if (replyForm) {
  replyForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = (replyInput?.value || "").trim();
    if (!text || !activeConversationId) {
      return;
    }

    const conversation = conversations.get(activeConversationId);
    if (!conversation) {
      return;
    }

    conversation.messages.push({ sender: "user", text });
    conversation.status = "Resposta registrada";

    updateConversation(conversation);

    prependLogItem(
      createLogItem({
        id: conversation.id,
        message: `Resposta registrada para ${conversation.debtor.name}.`,
        variant: "info",
      })
    );

    if (replyInput) {
      replyInput.value = "";
    }
  });
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const name = (data.get("name") || "").toString().trim();
    const phone = (data.get("phone") || "").toString().trim();
    const amount = (data.get("amount") || "").toString().trim();
    const due = (data.get("due") || "").toString().trim();
    const offer = (data.get("offer") || "").toString().trim();
    const notes = (data.get("notes") || "").toString().trim();
    const negotiationDiscount = (data.get("discount") || "")
      .toString()
      .trim();
    const negotiationDiscountMin = (data.get("discount_min") || "")
      .toString()
      .trim();
    const negotiationDiscountMax = (data.get("discount_max") || "")
      .toString()
      .trim();
    const negotiationTone = (data.get("tone") || "").toString().trim();
    const roiLimit = (data.get("roi") || "").toString().trim();

    if (
      !name ||
      !phone ||
      !amount ||
      !due ||
      !offer ||
      !negotiationDiscount ||
      !negotiationDiscountMin ||
      !negotiationDiscountMax ||
      !negotiationTone ||
      !roiLimit
    ) {
      return;
    }

    const debtor = {
      name,
      phone,
      amount,
      due,
      dueFormatted: formatDate(due),
      offer,
      notes,
    };

    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `conv-${Date.now()}`;

    const row = document.createElement("div");
    row.className = "row new";
    row.dataset.conversationId = id;

    const rowInfo = document.createElement("div");
    const rowName = document.createElement("p");
    rowName.className = "value";
    rowName.textContent = name;

    const rowMeta = document.createElement("p");
    rowMeta.className = "meta";
    rowMeta.textContent = `${amount} - ${formatDate(due)}`;

    const rowRecover = document.createElement("p");
    rowRecover.className = "recover";
    const rowRecoverLabel = document.createElement("span");
    rowRecoverLabel.textContent = "Recuperado: ";
    const rowRecoverValue = document.createElement("span");
    rowRecoverValue.className = "recover-value";
    rowRecoverValue.dataset.recovered = "true";
    rowRecoverValue.textContent = "R$ 0,00";
    rowRecover.append(rowRecoverLabel, rowRecoverValue);

    rowInfo.append(rowName, rowMeta, rowRecover);

    const rowStatus = document.createElement("span");
    rowStatus.className = "status warning";
    rowStatus.textContent = "em contato";

    row.append(rowInfo, rowStatus);

    if (list) {
      list.prepend(row);
    }

    addPending();

    const conversation = {
      id,
      debtor,
      messages: [],
      summary: "Aguardando andamento da negociacao.",
      status: "Em contato",
      proposals: 0,
      recovered: "R$ 0,00",
      row,
      rowStatus,
      rowRecovered: rowRecoverValue,
    };

    conversations.set(id, conversation);

    const logItem = createLogItem({
      id,
      message: `Entrada registrada para ${name}.`,
      variant: "info",
    });

    prependLogItem(logItem);
    selectConversation(id);

    setSubmitState(true);

    if (DEMO_MODE) {
      conversation.messages = [
        {
          sender: "agent",
          text: `Ola ${name}, aqui e da ${storeProfile.name}. Recebemos seu registro e vamos apresentar as melhores condicoes para regularizacao.`,
          actions: {
            type: "buttons",
            title: "Escolha uma opcao",
            options: ["Ver propostas", "Pedir prazo", "Falar com atendente"],
          },
        },
        {
          sender: "agent",
          text: "Em instantes voce recebe uma proposta com desconto e parcelamento disponiveis.",
          actions: {
            type: "list",
            title: "Preferencia inicial",
            options: ["Quero desconto a vista", "Prefiro parcelar", "Quero falar depois"],
          },
        },
      ];
      conversation.summary = "Registro incluido para demonstracao. Proposta em preparacao.";
      conversation.status = "Em contato";
      conversation.proposals = 1;
      conversation.recovered = "R$ 0,00";

      updateConversation(conversation);

      prependLogItem(
        createLogItem({
          id,
          message: `Registro incluido para demonstracao: ${name}.`,
          variant: "info",
        })
      );

      setSubmitState(false);
      return;
    }

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildPayload(
            debtor,
            negotiationDiscount,
            negotiationDiscountMin,
            negotiationDiscountMax,
            negotiationTone,
            roiLimit
          )
        ),
      });

      const rawText = await response.text();
      let responseData = rawText;
      try {
        responseData = JSON.parse(rawText);
      } catch (error) {
        responseData = rawText;
      }

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }

      const normalizedMessages = normalizeMessages(responseData);
      const agentMessages = normalizedMessages.filter(
        (message) => message.sender !== "user"
      );
      const summary = extractSummary(responseData, normalizedMessages, debtor);
      let finalMessages = agentMessages.length ? agentMessages : normalizedMessages;
      if (!finalMessages.length && summary) {
        finalMessages = [{ sender: "agent", text: summary }];
      }
      conversation.messages = finalMessages;
      conversation.summary = summary;
      conversation.proposals = extractProposalCount(
        responseData,
        normalizedMessages,
        offer
      );
      conversation.status = "Negociacao em andamento";
      const amountValue = parseCurrencyValue(conversation.debtor.amount);
      const estimate = amountValue ? amountValue * 0.65 : 0;
      conversation.recovered = formatCurrency(estimate) || "R$ 0,00";

      if (conversation.rowStatus) {
        conversation.rowStatus.textContent = "negociando";
        conversation.rowStatus.classList.remove("warning", "success", "info");
        conversation.rowStatus.classList.add("info");
      }

      updateConversation(conversation);

      prependLogItem(
        createLogItem({
          id,
          message: `Retorno da negociacao recebido para ${name}.`,
          variant: "success",
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      conversation.status = "Ajuste necessario";

      if (conversation.rowStatus) {
        conversation.rowStatus.textContent = "ajuste necessario";
        conversation.rowStatus.classList.remove("success", "info");
        conversation.rowStatus.classList.add("warning");
      }

      updateConversation(conversation);

      prependLogItem(
        createLogItem({
          id,
          message: `Falha ao registrar ${name}: ${message}.`,
          variant: "warning",
        })
      );
    } finally {
      setSubmitState(false);
    }

    window.setTimeout(() => {
      row.classList.remove("new");
    }, 1500);

    form.reset();
  });
}

const initDemo = async () => {
  const demoData = await loadDemoConversations();
  seedDemoConversations(demoData);
};

initDemo();
