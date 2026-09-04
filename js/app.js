import { fetchAll, verifyLogin } from "./db.js";
import { buildEvents, indexPriceHistory } from "./ledgerMath.js";
import { renderOverview } from "./pages/overview.js";
import { renderLedger } from "./pages/ledger.js";
import { renderInvestments } from "./pages/investments.js";
import { renderSplits } from "./pages/splits.js";
import { renderMyValue } from "./pages/myvalue.js";
import { renderInflation } from "./pages/inflation.js";

const LOGIN_STORAGE_KEY = "guildstash.loggedInMemberId";

const PAGES = {
  overview: renderOverview,
  ledger: renderLedger,
  investments: renderInvestments,
  splits: renderSplits,
  myvalue: renderMyValue,
  inflation: renderInflation,
};

const state = {
  members: [],
  currencies: [],
  priceHistory: [],
  transactions: [],
  investments: [],
  splits: [],
  events: [],
  priceIndex: new Map(),
  loggedInMemberId: null,
  page: "overview",
};

export function showToast(message, isError = false) {
  const root = document.getElementById("toast-root");
  const node = document.createElement("div");
  node.className = "toast" + (isError ? " error" : "");
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => node.remove(), 3500);
}

export async function reload() {
  const data = await fetchAll();
  Object.assign(state, data);
  state.events = buildEvents(data);
  state.priceIndex = indexPriceHistory(data.priceHistory);
  renderCurrentPage();
}

function renderCurrentPage() {
  const container = document.getElementById("main-content");
  container.innerHTML = "";
  document.querySelectorAll(".nav-link").forEach((n) => n.classList.toggle("active", n.dataset.page === state.page));
  const renderFn = PAGES[state.page];
  renderFn(container, { state, reload, showToast, navigate });
}

function navigate(page) {
  state.page = page;
  renderCurrentPage();
}

// ---------- Login ----------

let selectedMemberId = null;

function renderLoginMembers(members) {
  const grid = document.getElementById("member-grid");
  grid.innerHTML = "";
  for (const m of members) {
    const btn = document.createElement("button");
    btn.className = "member-btn";
    btn.dataset.memberId = m.id;
    btn.innerHTML = `<span class="avatar" style="background:${m.color}">${m.name[0]}</span><span>${m.name}</span>`;
    btn.addEventListener("click", () => selectMember(m.id, btn));
    grid.appendChild(btn);
  }
}

function selectMember(memberId, btnEl) {
  selectedMemberId = memberId;
  document.querySelectorAll(".member-btn").forEach((b) => b.classList.remove("selected"));
  btnEl.classList.add("selected");
  const pinInput = document.getElementById("pin-input");
  const loginBtn = document.getElementById("login-btn");
  pinInput.classList.remove("hidden");
  loginBtn.classList.remove("hidden");
  pinInput.value = "";
  document.getElementById("login-error").textContent = "";
  pinInput.focus();
}

async function attemptLogin() {
  const pin = document.getElementById("pin-input").value.trim();
  const errorEl = document.getElementById("login-error");
  const loginBtn = document.getElementById("login-btn");
  if (!selectedMemberId || !pin) return;

  loginBtn.disabled = true;
  errorEl.textContent = "";
  try {
    const ok = await verifyLogin(selectedMemberId, pin);
    if (!ok) {
      errorEl.textContent = "Wrong PIN.";
      loginBtn.disabled = false;
      return;
    }
    localStorage.setItem(LOGIN_STORAGE_KEY, selectedMemberId);
    enterApp(selectedMemberId);
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Couldn't reach the server. Check your connection and try again.";
    loginBtn.disabled = false;
  }
}

function enterApp(memberId) {
  state.loggedInMemberId = memberId;
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
  const me = state.members.find((m) => m.id === memberId);
  document.getElementById("who-name").textContent = me ? me.name : memberId;
  renderCurrentPage();
}

function logout() {
  localStorage.removeItem(LOGIN_STORAGE_KEY);
  state.loggedInMemberId = null;
  document.getElementById("app-screen").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("pin-input").classList.add("hidden");
  document.getElementById("login-btn").classList.add("hidden");
  document.querySelectorAll(".member-btn").forEach((b) => b.classList.remove("selected"));
  selectedMemberId = null;
}

async function init() {
  document.getElementById("login-btn").addEventListener("click", attemptLogin);
  document.getElementById("pin-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") attemptLogin();
  });
  document.getElementById("logout-btn").addEventListener("click", logout);
  document.querySelectorAll(".nav-link").forEach((n) => n.addEventListener("click", () => navigate(n.dataset.page)));

  try {
    await reload();
    renderLoginMembers(state.members);
  } catch (err) {
    console.error(err);
    document.getElementById("login-error").textContent =
      "Couldn't reach the database. Check js/config.js has your Supabase URL/key set.";
    return;
  }

  const remembered = localStorage.getItem(LOGIN_STORAGE_KEY);
  if (remembered && state.members.some((m) => m.id === remembered)) {
    enterApp(remembered);
  }
}

init();
