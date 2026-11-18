const $ = (selector) => document.querySelector(selector);
const config = {
  url: "",
  publishableKey: "",
};

const state = {
  user: null,
  profile: null,
  view: "dash",
  period: 30,
  tab: "in",
  error: "",
  conversations: [],
  messages: [],
  profiles: [],
  selectedConversation: null,
  loading: false,
};

let supabase;
let refreshTimer;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character]);
const isMaster = () => state.profile?.role === "master";
const percent = (part, total) => total ? Math.round((part / total) * 100) : 0;
const formatDate = (value) =>
  new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("on");
  setTimeout(() => element.classList.remove("on"), 3200);
}

function showError(message) {
  state.error = message;
  const element = $("#err");
  if (element) element.textContent = message;
  else toast(message);
}

function setupView() {
  $("#root").innerHTML = `<div class="auth"><div class="card">
    <div class="logo"><b>N</b>No Bullying</div>
    <h1>Conecte o banco de dados</h1>
    <p class="sub">O site está publicado, mas ainda não foi conectado ao projeto Supabase. Siga o <a href="https://github.com/Bkzin2i/python_estudos/blob/main/SUPABASE-SETUP.md">guia de configuração</a> e preencha as duas configurações neste arquivo.</p>
    <p class="note">Use somente a URL do projeto e a chave publicável (publishable/anon). Nunca coloque uma chave secreta ou service_role no site.</p>
    <a class="btn" href="./SUPABASE-SETUP.md">Abrir guia de configuração</a>
  </div></div>`;
}

function authView() {
  const registering = state.tab === "up";
  return `<div class="auth"><div class="card">
    <div class="logo"><b>N</b>No Bullying</div>
    <p class="sub">Um espaço privado para conversar com a equipe de apoio.</p>
    <div class="row">
      <button class="chip ${state.tab === "in" ? "on" : ""}" data-action="tab" data-value="in">Entrar</button>
      <button class="chip ${registering ? "on" : ""}" data-action="tab" data-value="up">Criar conta simples</button>
    </div>
    <div id="f">
      ${registering ? '<label for="name">Nome</label><input id="name" type="text" autocomplete="name" maxlength="80">' : ""}
      <label for="email">E-mail</label>
      <input id="email" type="email" autocomplete="email" autocapitalize="none" required>
      <label for="password">Senha</label>
      <input id="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" minlength="8" required>
      <p class="err" id="err">${escapeHtml(state.error)}</p>
      <button class="btn" data-action="${registering ? "signup" : "signin"}">${registering ? "Criar conta simples" : "Entrar"}</button>
    </div>
    <p class="note">As contas de mestre são autorizadas pelo administrador do projeto; não há cadastro público de mestre.</p>
  </div></div>`;
}

async function loadProfile(authUser) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, role")
    .eq("id", authUser.id)
    .single();
  if (error) throw error;
  state.user = authUser;
  state.profile = data;
  state.view = data.role === "master" ? "dash" : "chat";
  await loadData();
}

async function ensureConversation() {
  const { data: existing, error: lookupError } = await supabase
    .from("conversations")
    .select("id")
    .eq("simple_user_id", state.user.id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from("conversations")
    .insert({ simple_user_id: state.user.id })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

async function loadData() {
  if (!state.user || state.loading) return;
  state.loading = true;
  try {
    if (isMaster()) {
      const { data: conversations, error: conversationError } = await supabase
        .from("conversations")
        .select("id, simple_user_id, created_at, simple:profiles!conversations_simple_user_id_fkey(name, email)")
        .order("created_at", { ascending: false });
      if (conversationError) throw conversationError;
      state.conversations = conversations;
    } else {
      const conversation = await ensureConversation();
      state.conversations = [{
        id: conversation.id,
        simple_user_id: state.user.id,
        simple: state.profile,
      }];
    }

    const conversationIds = state.conversations.map((conversation) => conversation.id);
    if (conversationIds.length) {
      const { data: messages, error: messageError } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, sender_name, sender_role, body, created_at, read_at")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: true });
      if (messageError) throw messageError;
      state.messages = messages;
    } else {
      state.messages = [];
    }

    if (isMaster()) {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, name, email, role")
        .order("name", { ascending: true });
      if (profilesError) throw profilesError;
      state.profiles = profiles;
      if (!state.conversations.some((conversation) => conversation.id === state.selectedConversation)) {
        state.selectedConversation = state.conversations[0]?.id ?? null;
      }
      if (state.selectedConversation) {
        const unread = state.messages
          .filter((message) => message.conversation_id === state.selectedConversation
            && message.sender_role === "simples"
            && !message.read_at)
          .map((message) => message.id);
        if (unread.length) {
          const { error } = await supabase
            .from("messages")
            .update({ read_at: new Date().toISOString() })
            .in("id", unread);
          if (error) throw error;
          const readAt = new Date().toISOString();
          state.messages = state.messages.map((message) =>
            unread.includes(message.id) ? { ...message, read_at: readAt } : message);
        }
      }
    }
    render();
  } finally {
    state.loading = false;
  }
}

async function signup() {
  const name = $("#name").value.trim();
  const email = $("#email").value.trim().toLowerCase();
  const password = $("#password").value;
  if (!name) return showError("Informe seu nome.");
  if (password.length < 8) return showError("A senha precisa ter pelo menos 8 caracteres.");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  if (error) throw error;
  if (!data.session) {
    state.error = "Confira seu e-mail para confirmar a conta e depois entre.";
    state.tab = "in";
    render();
    return;
  }
  await loadProfile(data.user);
}

async function signin() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: $("#email").value.trim().toLowerCase(),
    password: $("#password").value,
  });
  if (error) throw error;
  await loadProfile(data.user);
}

function conversations() {
  return state.conversations.map((conversation) => {
    const messages = state.messages.filter((message) => message.conversation_id === conversation.id);
    const last = messages[messages.length - 1];
    return {
      ...conversation,
      messages,
      last,
      name: conversation.simple?.name || "Usuário",
      unread: messages.filter((message) => message.sender_role === "simples" && !message.read_at).length,
      waiting: last?.sender_role === "simples",
    };
  }).sort((left, right) => new Date(right.last?.created_at || right.created_at)
    - new Date(left.last?.created_at || left.created_at));
}

function dashboard() {
  const limit = state.period ? Date.now() - state.period * 864e5 : 0;
  const messages = state.messages.filter((message) => new Date(message.created_at).getTime() >= limit);
  const simpleCount = messages.filter((message) => message.sender_role === "simples").length;
  const total = messages.length;
  const userPercent = percent(simpleCount, total);
  const masterPercent = total ? 100 - userPercent : 0;
  const items = conversations();
  const waiting = items.filter((conversation) => conversation.waiting).length;
  const answered = items.length - waiting;
  const unread = items.reduce((sum, conversation) => sum + conversation.unread, 0);
  const circumference = 2 * Math.PI * 52;
  const answeredArc = items.length ? answered / items.length * circumference : 0;
  const days = [...Array(7)].map((_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - 6 + index);
    const start = date.getTime();
    const today = state.messages.filter((message) => {
      const timestamp = new Date(message.created_at).getTime();
      return timestamp >= start && timestamp < start + 864e5;
    });
    return {
      label: date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
      simple: today.filter((message) => message.sender_role === "simples").length,
      master: today.filter((message) => message.sender_role === "master").length,
    };
  });
  const maxDay = Math.max(1, ...days.map((day) => day.simple + day.master));

  return `<h1>Painel</h1><p class="sub">Acompanhe as conversas e as mensagens que aguardam resposta.</p>
    <div class="row">${[[7, "7 dias"], [30, "30 dias"], [0, "Tudo"]].map(([value, label]) =>
    `<button class="chip ${state.period === value ? "on" : ""}" data-action="period" data-value="${value}">${label}</button>`).join("")}</div>
    <div class="card" style="margin-bottom:14px"><h2>Quem escreve nas conversas</h2>
      <div class="ribbon" role="img" aria-label="Usuários ${userPercent}%, mestre ${masterPercent}%">${total
    ? `<span class="s" style="flex-basis:${userPercent}%;flex-shrink:1">${userPercent ? `${userPercent}%` : ""}</span><span class="w" style="flex-basis:${masterPercent}%;flex-grow:1;flex-shrink:1">${masterPercent ? `${masterPercent}%` : ""}</span>`
    : '<span style="background:var(--line);flex:1;color:var(--muted);font-size:16px">Sem mensagens neste período</span>'}</div>
      <div class="leg"><span><i class="dot" style="background:#3b6fd4"></i> Usuários simples: ${simpleCount}</span><span><i class="dot" style="background:#0e8f8a"></i> Mestre: ${total - simpleCount}</span></div></div>
    <div class="grid k4" style="margin-bottom:14px">
      <div class="card kpi"><small>Mensagens</small><strong>${total}</strong></div>
      <div class="card kpi"><small>Conversas ativas</small><strong>${items.length}</strong></div>
      <div class="card kpi"><small>Taxa de resposta</small><strong>${percent(answered, items.length)}%</strong><div class="bar"><i style="width:${percent(answered, items.length)}%"></i></div></div>
      <div class="card kpi"><small>Mensagens não lidas</small><strong>${unread}</strong></div></div>
    <div class="grid k2"><div class="card"><h2>Situação das conversas</h2><div class="donut">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Respondidas ${percent(answered, items.length)}%">
        <circle r="52" cx="70" cy="70" fill="none" stroke="${items.length ? "#f2b632" : "var(--line)"}" stroke-width="22"/>
        ${items.length ? `<circle r="52" cx="70" cy="70" fill="none" stroke="#0e8f8a" stroke-width="22" stroke-dasharray="${answeredArc} ${circumference - answeredArc}" transform="rotate(-90 70 70)"/>` : ""}
        <text x="70" y="76" text-anchor="middle" font-size="22" font-weight="800" fill="currentColor">${percent(answered, items.length)}%</text></svg>
      <div class="leg" style="flex-direction:column;margin:0"><span>Respondidas: ${answered}</span><span>Aguardando resposta: ${waiting}</span></div></div></div>
      <div class="card"><h2>Mensagens nos últimos 7 dias</h2><div class="days">${days.map((day) =>
    `<div class="day" title="${day.simple} de usuários, ${day.master} do mestre"><div class="stack" style="height:${(day.simple + day.master) / maxDay * 120}px"><i style="background:#3b6fd4;flex:${day.simple}"></i><i style="background:#0e8f8a;flex:${day.master}"></i></div>${escapeHtml(day.label)}</div>`).join("")}</div></div></div>`;
}

function chatView() {
  const master = isMaster();
  return `<h1>${master ? "Conversas" : "Mensagem ao mestre"}</h1>
    <p class="sub">${master ? "Responda aos usuários. Cada conversa é privada entre um usuário e a equipe de mestres." : "Escreva para a equipe de apoio. Só você e os mestres autorizados podem ler esta conversa."}</p>
    <div class="chat ${master ? "two" : ""}">${master ? '<div class="card" id="lst"></div>' : ""}
      <div class="card"><div id="thr" class="thr"></div><div class="cmp">
        <textarea id="tx" rows="2" maxlength="500" placeholder="Escreva sua mensagem" aria-label="Mensagem"></textarea>
        <button class="btn" data-action="send">Enviar</button></div></div></div>`;
}

function usersView() {
  return `<h1>Usuários</h1><p class="sub">Autorize ou remova contas de mestre no painel do Supabase. Contas simples são criadas pelos próprios usuários.</p>
    <div class="card tw">${state.profiles.length ? `<table><thead><tr><th>Nome</th><th>E-mail</th><th>Tipo</th></tr></thead><tbody>
      ${state.profiles.map((profile) => `<tr><td>${escapeHtml(profile.name)}</td><td>${escapeHtml(profile.email)}</td>
      <td><span class="pill" style="background:${profile.role === "simples" ? "#3b6fd4" : "#0e8f8a"}">${profile.role === "simples" ? "Simples" : "Mestre"}</span></td></tr>`).join("")}
    </tbody></table>` : '<div class="empty">Nenhum usuário cadastrado.</div>'}</div>`;
}

function fillChat() {
  const items = conversations();
  const selected = items.find((conversation) => conversation.id === state.selectedConversation);
  const list = $("#lst");
  if (list) {
    list.innerHTML = `<h2>Usuários</h2>${items.length ? items.map((conversation) =>
      `<button class="cv ${conversation.id === state.selectedConversation ? "on" : ""}" data-action="conversation" data-value="${escapeHtml(conversation.id)}">
        <b>${escapeHtml(conversation.name)}</b>${conversation.unread ? `<span class="pill" style="background:var(--coral)">${conversation.unread}</span>` : ""}
        <small>${escapeHtml(conversation.last?.body || "Ainda sem mensagens")}</small></button>`).join("")
      : '<div class="empty">Nenhuma conversa ainda. Quando um usuário simples escrever, ela aparece aqui.</div>'}`;
  }
  const thread = $("#thr");
  if (!thread) return;
  const messages = isMaster()
    ? selected?.messages || []
    : state.messages;
  thread.innerHTML = `${isMaster() && selected ? `<h2>${escapeHtml(selected.name)}</h2>` : ""}
    ${messages.length ? messages.map((message) =>
    `<div class="msg ${(message.sender_role === "master") === isMaster() ? "me" : ""}">
      <span>${escapeHtml(message.sender_name)}, ${formatDate(message.created_at)}</span>
      <p>${escapeHtml(message.body)}</p></div>`).join("")
    : `<div class="empty">${isMaster() ? "Escolha uma conversa na lista." : "Nenhuma mensagem ainda. Escreva a primeira abaixo."}</div>`}`;
  thread.scrollTop = thread.scrollHeight;
}

async function sendMessage() {
  const textarea = $("#tx");
  const body = textarea.value.trim();
  if (!body) return;
  const conversation = isMaster()
    ? state.conversations.find((item) => item.id === state.selectedConversation)
    : state.conversations[0];
  if (!conversation) return toast("Não foi possível encontrar sua conversa. Atualize a página.");

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversation.id,
    sender_id: state.user.id,
    body,
  });
  if (error) throw error;
  textarea.value = "";
  await loadData();
}

function render() {
  if (!state.user || !state.profile) {
    $("#root").innerHTML = authView();
    return;
  }
  const master = isMaster();
  if (!master) state.view = "chat";
  const navigation = master
    ? [["dash", "Painel"], ["chat", "Conversas"], ["users", "Usuários"]]
    : [["chat", "Enviar mensagem ao mestre"]];
  const content = state.view === "dash" && master
    ? dashboard()
    : state.view === "users" && master
      ? usersView()
      : chatView();
  $("#root").innerHTML = `<div class="app"><aside><div class="logo"><b>N</b>No Bullying</div>
    ${navigation.map(([key, label]) => `<button class="nav ${state.view === key ? "on" : ""}" data-action="view" data-value="${key}">${label}</button>`).join("")}
    <div class="who">${escapeHtml(state.profile.name)}<br><small>${master ? "Usuário mestre" : "Usuário simples"}</small><br>
      <button data-action="signout">Sair</button></div></aside><main>${content}</main></div>`;
  if (state.view === "chat") fillChat();
}

async function handleAction(action, value) {
  if (action === "tab") {
    state.tab = value;
    state.error = "";
    render();
  } else if (action === "signup") {
    await signup();
  } else if (action === "signin") {
    await signin();
  } else if (action === "signout") {
    clearInterval(refreshTimer);
    refreshTimer = null;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    state.user = null;
    state.profile = null;
    state.messages = [];
    state.conversations = [];
    state.profiles = [];
    state.tab = "in";
    state.error = "";
    render();
  } else if (action === "view") {
    state.view = value;
    render();
  } else if (action === "period") {
    state.period = Number(value);
    render();
  } else if (action === "conversation") {
    state.selectedConversation = value;
    await loadData();
  } else if (action === "send") {
    await sendMessage();
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  handleAction(button.dataset.action, button.dataset.value)
    .catch((error) => showError(error.message || "Ocorreu um erro. Tente novamente."));
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (event.target.closest("#f")) {
    event.preventDefault();
    handleAction(state.tab === "in" ? "signin" : "signup")
      .catch((error) => showError(error.message || "Ocorreu um erro. Tente novamente."));
  } else if (event.target.id === "tx" && !event.shiftKey) {
    event.preventDefault();
    sendMessage().catch((error) => showError(error.message || "Não foi possível enviar a mensagem."));
  }
});

async function start() {
  if (!config.url || !config.publishableKey) {
    setupView();
    return;
  }
  if (!window.supabase?.createClient) {
    throw new Error("Não foi possível carregar a biblioteca Supabase. Verifique a conexão e recarregue.");
  }
  supabase = window.supabase.createClient(config.url, config.publishableKey);
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session) {
    await loadProfile(data.session.user);
    refreshTimer = setInterval(() => {
      loadData().catch((refreshError) => showError(refreshError.message || "Não foi possível atualizar as conversas."));
    }, 5000);
  } else {
    render();
  }
}

start().catch((error) => {
  $("#root").innerHTML = `<div class="auth"><div class="card">
    <h1>Não foi possível iniciar o site</h1>
    <p class="err">${escapeHtml(error.message || "Erro desconhecido.")}</p>
    <button class="btn" onclick="location.reload()">Tentar novamente</button>
  </div></div>`;
});
