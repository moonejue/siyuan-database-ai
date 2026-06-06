"use strict";

const { Dialog, Plugin, showMessage } = require("siyuan");

const PLUGIN_NAME = "siyuan-database-ai";
const SETTINGS_KEY = `${PLUGIN_NAME}:settings`;
const SETTINGS_FILE = "settings.json";
const DATABASE_SELECTOR = '[data-type="NodeAttributeView"][data-av-id], .av[data-av-id]';
const PROVIDER_PRESETS = {
  ollama: { label: "Ollama（本机）", protocol: "ollama", endpoint: "http://127.0.0.1:11434", model: "" },
  lmstudio: { label: "LM Studio（本机）", protocol: "openai", endpoint: "http://127.0.0.1:1234", model: "" },
  openai: { label: "OpenAI", protocol: "openai", endpoint: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  deepseek: { label: "DeepSeek", protocol: "openai", endpoint: "https://api.deepseek.com", model: "deepseek-chat" },
  siliconflow: {
    label: "硅基流动 SiliconFlow",
    protocol: "openai",
    endpoint: "https://api.siliconflow.cn/v1",
    model: "",
  },
  moonshot: { label: "月之暗面 Kimi", protocol: "openai", endpoint: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  zhipu: {
    label: "智谱 GLM",
    protocol: "openai",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
  },
  dashscope: {
    label: "阿里云百炼 / 通义千问",
    protocol: "openai",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  openrouter: { label: "OpenRouter", protocol: "openai", endpoint: "https://openrouter.ai/api/v1", model: "" },
  anthropic: { label: "Anthropic Claude", protocol: "anthropic", endpoint: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
  gemini: {
    label: "Google Gemini",
    protocol: "openai",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
  },
  custom: { label: "自定义第三方 API", protocol: "openai", endpoint: "", model: "" },
};
const OPERATIONS = {
  summary: {
    title: "内容总结",
    icon: "☷",
    hint: "压缩长文本，生成清晰摘要",
    output: "AI 总结",
  },
  custom: {
    title: "自定义 AI",
    icon: "✧",
    hint: "按自定义指令处理每一行",
    output: "AI 结果",
  },
  classify: {
    title: "智能分类",
    icon: "◇",
    hint: "从候选分类中选择最匹配的一项",
    output: "AI 分类",
  },
  extract: {
    title: "智能提取",
    icon: "⌖",
    hint: "提取姓名、电话、标签等结构化信息",
    output: "AI 提取",
  },
  formula: {
    title: "公式计算",
    icon: "ƒ",
    hint: "使用类 Excel 公式自动补全数字列",
    output: "公式结果",
  },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function randomID() {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `${date}-${Math.random().toString(36).slice(2, 9).padEnd(7, "0")}`;
}

async function siyuanPost(path, data = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg || `思源接口失败: ${path}`);
  }
  return payload.data;
}

function defaultSettings() {
  return {
    preset: "ollama",
    protocol: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "",
    apiKey: "",
  };
}

function loadLegacySettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function compactEndpoint(endpoint) {
  return String(endpoint || "").replace(/\/+$/, "");
}

function isLocalEndpoint(endpoint) {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

async function apiFetch(url, { method = "GET", headers = {}, body, timeout = 120000 } = {}) {
  if (isLocalEndpoint(url)) {
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = text;
    }
    if (!response.ok) throw new Error(payload?.error?.message || payload?.error || payload?.message || `${response.status}`);
    return payload;
  }
  const result = await siyuanPost("/api/network/forwardProxy", {
    url,
    method,
    timeout,
    headers: Object.entries(headers).map(([key, value]) => ({ [key]: value })),
    payload: body || {},
  });
  let payload;
  try {
    payload = result.body ? JSON.parse(result.body) : {};
  } catch {
    payload = result.body;
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(payload?.error?.message || payload?.error || payload?.message || `HTTP ${result.status}`);
  }
  return payload;
}

function openAIBase(endpoint) {
  const base = compactEndpoint(endpoint);
  return /\/(v1|v4|openai)$/i.test(base) ? base : `${base}/v1`;
}

async function listLocalModels(settings) {
  const endpoint = compactEndpoint(settings.endpoint);
  if (!endpoint) throw new Error("请填写接口地址");
  if (settings.protocol === "ollama") {
    const payload = await apiFetch(`${endpoint}/api/tags`);
    return (payload.models || []).map((item) => item.name);
  }
  if (settings.protocol === "anthropic") {
    throw new Error("Anthropic 不提供模型列表，请手动填写模型名称");
  }
  const payload = await apiFetch(`${openAIBase(endpoint)}/models`, {
    headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
  });
  return (payload.data || []).map((item) => item.id);
}

async function callLocalModel(settings, prompt) {
  const endpoint = compactEndpoint(settings.endpoint);
  if (!endpoint) throw new Error("请先填写 API 接口地址");
  if (!settings.model) throw new Error("请先在设置中选择或填写本地模型名称");
  if (settings.protocol === "ollama") {
    const payload = await apiFetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        model: settings.model,
        stream: false,
        messages: [{ role: "user", content: prompt }],
      },
    });
    return String(payload.message?.content || "").trim();
  }
  if (settings.protocol === "anthropic") {
    const payload = await apiFetch(`${endpoint}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: { model: settings.model, max_tokens: 2048, messages: [{ role: "user", content: prompt }] },
    });
    return String(payload.content?.map((item) => item.text || "").join("") || "").trim();
  }
  const payload = await apiFetch(`${openAIBase(endpoint)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: {
      model: settings.model,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    },
  });
  return String(payload.choices?.[0]?.message?.content || "").trim();
}

function valueToText(value) {
  if (!value) return "";
  if (value.block) return String(value.block.content || "").trim();
  if (value.text) return String(value.text.content || "").trim();
  if (value.number?.isNotEmpty) return String(value.number.content);
  if (value.date?.isNotEmpty) return String(value.date.formattedContent || value.date.content || "");
  if (value.checkbox) return value.checkbox.checked ? "是" : "否";
  if (Array.isArray(value.mSelect)) return value.mSelect.map((item) => item.content).join(", ");
  if (Array.isArray(value.mAsset)) return value.mAsset.map((item) => item.name || item.content).join(", ");
  if (value.url) return String(value.url.content || "");
  if (value.email) return String(value.email.content || "");
  if (value.phone) return String(value.phone.content || "");
  if (value.template) return String(value.template.content || "");
  if (value.relation?.contents) return value.relation.contents.map(valueToText).join(", ");
  if (value.rollup?.contents) return value.rollup.contents.map(valueToText).join(", ");
  return "";
}

function makeCellValue(type, content) {
  if (type === "number") {
    const number = Number(content);
    return {
      type: "number",
      number: {
        content: number,
        isNotEmpty: Number.isFinite(number),
        format: "",
        formattedContent: Number.isFinite(number) ? String(number) : "",
      },
    };
  }
  return { type: "text", text: { content: String(content ?? "") } };
}

function getRowObject(row, columns) {
  const byKey = new Map((row.cells || []).map((cell) => [cell.value?.keyID, cell.value]));
  const output = {};
  columns.forEach((column) => {
    output[column.name] = valueToText(byKey.get(column.id));
  });
  return output;
}

function selectOptions(columns, selected = []) {
  return columns
    .map(
      (column) =>
        `<option value="${escapeHtml(column.id)}"${selected.includes(column.id) ? " selected" : ""}>${escapeHtml(
          column.name
        )} · ${escapeHtml(column.type)}</option>`
    )
    .join("");
}

function operationPrompt(operation, rowData, sourceNames, instruction, categories) {
  const selected = {};
  sourceNames.forEach((name) => {
    selected[name] = rowData[name] ?? "";
  });
  const input = JSON.stringify(selected, null, 2);
  const base = "你正在处理数据库中的一行数据。只输出将要写入单元格的最终结果，不要解释，不要使用 Markdown。";
  if (operation === "summary") return `${base}\n请总结以下内容，保留关键事实，语言简洁：\n${input}`;
  if (operation === "classify") {
    return `${base}\n请从候选分类中只选择一个最匹配的分类。候选分类：${categories}\n数据：\n${input}`;
  }
  if (operation === "extract") return `${base}\n提取要求：${instruction || "提取最重要的信息"}\n数据：\n${input}`;
  return `${base}\n处理要求：${instruction || "整理并补全这行数据"}\n数据：\n${input}`;
}

function evaluateFormula(formula, rowData) {
  let expression = String(formula || "").trim().replace(/^=/, "");
  if (!expression) throw new Error("请输入公式");
  expression = expression.replace(/\{([^}]+)\}/g, (_, field) => {
    const raw = String(rowData[field.trim()] ?? "").replace(/,/g, "");
    const number = Number(raw);
    return Number.isFinite(number) ? String(number) : "0";
  });
  if (!/^[\d\s+\-*/%().,A-Z_a-z]+$/.test(expression)) {
    throw new Error("公式只支持数字、字段引用和基础函数");
  }
  const functions = {
    SUM: (...items) => items.reduce((sum, item) => sum + Number(item || 0), 0),
    AVG: (...items) => (items.length ? functions.SUM(...items) / items.length : 0),
    MIN: (...items) => Math.min(...items),
    MAX: (...items) => Math.max(...items),
    ROUND: (number, digits = 0) => Number(Number(number).toFixed(Number(digits))),
    ABS: Math.abs,
    COUNT: (...items) => items.filter((item) => item !== "" && item !== null && item !== undefined).length,
    POW: Math.pow,
    SQRT: Math.sqrt,
  };
  const names = Object.keys(functions);
  const unknown = expression.match(/[A-Za-z_]+/g) || [];
  if (unknown.some((name) => !names.includes(name.toUpperCase()))) throw new Error("公式中包含不支持的函数");
  const args = names.map((name) => functions[name]);
  const result = Function(...names, `"use strict"; return (${expression.toUpperCase()});`)(...args);
  if (!Number.isFinite(Number(result))) throw new Error("公式结果不是有效数字");
  return Number(result);
}

function getVisibleDatabases() {
  const found = new Map();
  document.querySelectorAll(DATABASE_SELECTOR).forEach((element) => {
    const avID = element.dataset.avId;
    if (avID) found.set(avID, element);
  });
  return [...found.entries()].map(([avID, element]) => ({ avID, element }));
}

class DatabaseAIPlugin extends Plugin {
  onload() {
    this.decorateDatabases = this.decorateDatabases.bind(this);
    this.handleDocumentClick = this.handleDocumentClick.bind(this);
    this.addTopBar({
      icon: "iconDatabase",
      title: "数据库 AI 应用",
      position: "right",
      callback: () => this.openFromToolbar(),
    });
    document.addEventListener("click", this.handleDocumentClick, true);
    this.observer = new MutationObserver(this.decorateDatabases);
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.decorateDatabases();
  }

  onunload() {
    document.removeEventListener("click", this.handleDocumentClick, true);
    this.observer?.disconnect();
    document.querySelectorAll(".moon-db-ai-launcher").forEach((element) => element.remove());
  }

  async uninstall() {
    try {
      await this.removeData(SETTINGS_FILE);
    } catch (error) {
      console.warn(`[${PLUGIN_NAME}] remove settings failed`, error);
    }
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch (error) {
      console.warn(`[${PLUGIN_NAME}] remove legacy settings failed`, error);
    }
  }

  decorateDatabases() {
    getVisibleDatabases().forEach(({ avID, element }) => {
      const root = element.matches('[data-type="NodeAttributeView"]')
        ? element
        : element.closest('[data-type="NodeAttributeView"]') || element;
      if (root.querySelector(":scope > .moon-db-ai-launcher")) return;
      root.classList.add("moon-db-ai-host");
      const button = document.createElement("button");
      button.className = "moon-db-ai-launcher b3-button b3-button--outline";
      button.type = "button";
      button.dataset.avId = avID;
      button.title = "打开数据库 AI 应用";
      button.innerHTML = `<span class="moon-db-ai-launcher__spark">✧</span><span>AI 应用</span>`;
      root.appendChild(button);
    });
  }

  handleDocumentClick(event) {
    const button = event.target.closest(".moon-db-ai-launcher");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    this.openPanel(button.dataset.avId);
  }

  openFromToolbar() {
    const databases = getVisibleDatabases();
    if (!databases.length) {
      showMessage("请先打开包含数据库的文档，再点击数据库 AI 应用");
      return;
    }
    if (databases.length === 1) {
      this.openPanel(databases[0].avID);
      return;
    }
    this.openDatabasePicker(databases);
  }

  openDatabasePicker(databases) {
    const dialog = new Dialog({
      title: "选择数据库",
      width: "520px",
      content: `<div class="b3-dialog__content moon-db-ai-picker">
        ${databases
          .map(
            ({ avID }) =>
              `<button class="b3-button b3-button--outline fn__block" data-av-id="${escapeHtml(avID)}">${escapeHtml(
                avID
              )}</button>`
          )
          .join("")}
      </div>`,
    });
    dialog.element.querySelectorAll("[data-av-id]").forEach((button) => {
      button.addEventListener("click", () => {
        dialog.destroy();
        this.openPanel(button.dataset.avId);
      });
    });
  }

  async openPanel(avID) {
    try {
      const database = await siyuanPost("/api/av/renderAttributeView", { id: avID, pageSize: -1 });
      const settings = await this.loadSettings();
      const columns = database.view.columns || [];
      const firstColumn = columns[0]?.id || "";
      const presetOptions = Object.entries(PROVIDER_PRESETS)
        .map(
          ([id, preset]) =>
            `<option value="${escapeHtml(id)}"${settings.preset === id ? " selected" : ""}>${escapeHtml(
              preset.label
            )}</option>`
        )
        .join("");
      const sourceCheckboxes = columns
        .map(
          (column) => `<label class="moon-db-ai-source">
            <input type="checkbox" data-source-id="${escapeHtml(column.id)}"${column.id === firstColumn ? " checked" : ""}>
            <span>${escapeHtml(column.name)}</span>
            <small>${escapeHtml(column.type)}</small>
          </label>`
        )
        .join("");
      const operationCards = Object.entries(OPERATIONS)
        .map(
          ([id, operation]) => `<button class="moon-db-ai-card${id === "summary" ? " active" : ""}" data-operation="${id}">
            <span class="moon-db-ai-card__icon">${operation.icon}</span>
            <span class="moon-db-ai-card__body"><strong>${operation.title}</strong><small>${operation.hint}</small></span>
            <span class="moon-db-ai-badge">AI</span>
          </button>`
        )
        .join("");
      const dialog = new Dialog({
        title: "数据库 AI 应用",
        width: "880px",
        content: `<div class="b3-dialog__content moon-db-ai">
          <div class="moon-db-ai-toolbar">
            <div><strong>${escapeHtml(database.name || "未命名数据库")}</strong><small>${escapeHtml(avID)} · ${
          database.view.rows?.length || 0
        } 行</small></div>
            <button class="b3-button b3-button--outline" data-action="toggle-settings">AI 模型设置</button>
          </div>
          <section class="moon-db-ai-settings fn__none">
            <label>服务商预设<select class="b3-select fn__block" data-field="preset">${presetOptions}</select></label>
            <label>接口协议<select class="b3-select fn__block" data-field="protocol">
              <option value="ollama"${settings.protocol === "ollama" ? " selected" : ""}>Ollama</option>
              <option value="openai"${settings.protocol === "openai" ? " selected" : ""}>OpenAI 兼容</option>
              <option value="anthropic"${settings.protocol === "anthropic" ? " selected" : ""}>Anthropic</option>
            </select></label>
            <label>接口地址<input class="b3-text-field fn__block" data-field="endpoint" value="${escapeHtml(
              settings.endpoint
            )}"></label>
            <label>模型名称<input class="b3-text-field fn__block" data-field="model" value="${escapeHtml(
              settings.model
            )}" placeholder="例如 qwen3:8b"></label>
            <label>API Key（可选）<input class="b3-text-field fn__block" data-field="apiKey" type="password" value="${escapeHtml(
              settings.apiKey
            )}"></label>
            <div class="moon-db-ai-settings__actions">
              <button class="b3-button b3-button--outline" data-action="detect-models">检测可用模型</button>
              <button class="b3-button b3-button--text" data-action="save-settings">保存设置</button>
              <span data-role="model-status"></span>
            </div>
            <p class="moon-db-ai-settings__notice">隐私提示：使用第三方 API 时，选中的数据库内容会发送到对应服务商。API Key 仅保存在当前思源客户端。</p>
          </section>
          <div class="moon-db-ai-layout">
            <section>
              <h3>AI 应用类型</h3>
              <div class="moon-db-ai-cards">${operationCards}</div>
            </section>
            <section class="moon-db-ai-form">
              <h3 data-role="operation-title">内容总结</h3>
              <div class="moon-db-ai-source-wrap">
                <div class="moon-db-ai-source-header">
                  <span>输入字段 <small data-role="source-hint">可选择当前数据库的任意字段</small></span>
                  <span>
                    <button class="b3-button b3-button--outline" data-action="select-all-sources">全选</button>
                    <button class="b3-button b3-button--outline" data-action="clear-sources">清空</button>
                  </span>
                </div>
                <div class="moon-db-ai-sources" data-role="sources">${sourceCheckboxes}</div>
              </div>
              <label data-role="instruction-wrap" class="fn__none">处理要求<textarea class="b3-text-field fn__block" data-field="instruction" rows="3" placeholder="例如：提取手机号；或将内容整理成一句话"></textarea></label>
              <label data-role="categories-wrap" class="fn__none">候选分类<input class="b3-text-field fn__block" data-field="categories" placeholder="例如：工作, 生活, 学习, 其他"></label>
              <label data-role="formula-wrap" class="fn__none">公式<input class="b3-text-field fn__block" data-field="formula" placeholder="例如：={单价}*{数量} 或 ROUND(AVG({语文},{数学}), 1)">
                <small>支持 SUM、AVG、MIN、MAX、ROUND、ABS、COUNT、POW、SQRT。字段请写成 {字段名}。</small>
              </label>
              <div data-role="formula-assist-wrap" class="moon-db-ai-formula-assist fn__none">
                <input class="b3-text-field fn__block" data-field="formula-request" placeholder="用自然语言描述公式，例如：单价乘数量后保留两位小数">
                <button class="b3-button b3-button--outline" data-action="complete-formula">AI 补全公式</button>
              </div>
              <label>输出字段<select class="b3-select fn__block" data-field="target"><option value="__new__">+ 新建输出字段</option>${selectOptions(
                columns
              )}</select></label>
              <label>新字段名称<input class="b3-text-field fn__block" data-field="target-name" value="AI 总结"></label>
              <label class="moon-db-ai-checkbox"><input type="checkbox" data-field="overwrite"> 覆盖已有内容</label>
              <div class="moon-db-ai-actions">
                <button class="b3-button b3-button--outline" data-action="preview">预览前 3 行</button>
                <button class="b3-button b3-button--text" data-action="run">整列应用</button>
              </div>
              <div class="moon-db-ai-progress" data-role="progress"></div>
            </section>
          </div>
          <section class="moon-db-ai-preview fn__none" data-role="preview"></section>
        </div>`,
      });
      this.bindPanel(dialog, database, settings);
    } catch (error) {
      console.error(`[${PLUGIN_NAME}] open panel failed`, error);
      showMessage(`打开数据库失败：${error.message}`);
    }
  }

  async loadSettings() {
    const defaults = defaultSettings();
    let stored = {};
    try {
      stored = (await this.loadData(SETTINGS_FILE)) || {};
    } catch (error) {
      console.warn(`[${PLUGIN_NAME}] load settings failed`, error);
    }
    const legacy = loadLegacySettings();
    const settings = { ...defaults, ...legacy, ...stored };
    if (Object.keys(legacy).length && !Object.keys(stored).length) {
      await this.saveSettings(settings);
    }
    return settings;
  }

  async saveSettings(settings) {
    const normalized = { ...defaultSettings(), ...settings };
    saveSettings(normalized);
    await this.saveData(SETTINGS_FILE, normalized);
    return normalized;
  }

  bindPanel(dialog, database, settings) {
    const root = dialog.element.querySelector(".moon-db-ai");
    const field = (name) => root.querySelector(`[data-field="${name}"]`);
    const role = (name) => root.querySelector(`[data-role="${name}"]`);
    let operation = "summary";
    let running = false;

    const readSettings = () => ({
      preset: field("preset").value,
      protocol: field("protocol").value,
      endpoint: field("endpoint").value.trim(),
      model: field("model").value.trim(),
      apiKey: field("apiKey").value.trim(),
    });

    const setProgress = (message, type = "") => {
      role("progress").className = `moon-db-ai-progress ${type}`;
      role("progress").textContent = message;
    };

    const updateOperation = (next) => {
      operation = next;
      root.querySelectorAll(".moon-db-ai-card").forEach((card) => {
        card.classList.toggle("active", card.dataset.operation === operation);
      });
      const config = OPERATIONS[operation];
      role("operation-title").textContent = config.title;
      field("target-name").value = config.output;
      role("instruction-wrap").classList.toggle("fn__none", !["custom", "extract"].includes(operation));
      role("categories-wrap").classList.toggle("fn__none", operation !== "classify");
      role("formula-wrap").classList.toggle("fn__none", operation !== "formula");
      role("formula-assist-wrap").classList.toggle("fn__none", operation !== "formula");
      role("source-hint").textContent =
        operation === "custom" ? "自定义 AI 可组合当前数据库的任意字段" : "可选择当前数据库的任意字段";
    };

    const selectedSources = () =>
      [...root.querySelectorAll("[data-source-id]:checked")].map((checkbox) => checkbox.dataset.sourceId);
    const sourceNames = () =>
      selectedSources().map((id) => database.view.columns.find((column) => column.id === id)?.name).filter(Boolean);

    const calculateRow = async (row) => {
      const rowData = getRowObject(row, database.view.columns);
      if (operation === "formula") return evaluateFormula(field("formula").value, rowData);
      const names = sourceNames();
      if (!names.length) throw new Error("请至少选择一个输入字段");
      return callLocalModel(
        readSettings(),
        operationPrompt(operation, rowData, names, field("instruction").value.trim(), field("categories").value.trim())
      );
    };

    const runPreview = async () => {
      try {
        setProgress("正在生成预览...");
        const rows = (database.view.rows || []).slice(0, 3);
        const results = [];
        for (const row of rows) results.push(await calculateRow(row));
        role("preview").innerHTML = `<h3>预览</h3>${rows
          .map(
            (row, index) =>
              `<div class="moon-db-ai-preview__row"><strong>第 ${index + 1} 行</strong><span>${escapeHtml(
                String(results[index])
              )}</span></div>`
          )
          .join("")}`;
        role("preview").classList.remove("fn__none");
        setProgress("预览完成", "success");
      } catch (error) {
        setProgress(`预览失败：${error.message}`, "error");
      }
    };

    const ensureTarget = async () => {
      if (field("target").value !== "__new__") {
        return database.view.columns.find((column) => column.id === field("target").value);
      }
      const name = field("target-name").value.trim();
      if (!name) throw new Error("请填写新字段名称");
      const keyID = randomID();
      const type = operation === "formula" ? "number" : "text";
      const previousKeyID = database.view.columns.at(-1)?.id || "";
      await siyuanPost("/api/av/addAttributeViewKey", {
        avID: database.id,
        keyID,
        keyName: name,
        keyType: type,
        keyIcon: "",
        previousKeyID,
      });
      return { id: keyID, name, type };
    };

    const runColumn = async () => {
      if (running) return;
      running = true;
      try {
        const rows = database.view.rows || [];
        if (!rows.length) throw new Error("数据库中没有可处理的行");
        const target = await ensureTarget();
        const targetValueByRow = new Map(
          rows.map((row) => {
            const cell = (row.cells || []).find((item) => item.value?.keyID === target.id);
            return [row.id, valueToText(cell?.value)];
          })
        );
        const updates = [];
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          if (!field("overwrite").checked && targetValueByRow.get(row.id)) continue;
          setProgress(`正在处理第 ${index + 1} / ${rows.length} 行...`);
          const result = await calculateRow(row);
          updates.push({ keyID: target.id, itemID: row.id, value: makeCellValue(target.type, result) });
        }
        if (!updates.length) throw new Error("没有需要写入的单元格。可勾选“覆盖已有内容”后重试");
        setProgress(`正在批量写回 ${updates.length} 个单元格...`);
        await siyuanPost("/api/av/batchSetAttributeViewBlockAttrs", { avID: database.id, values: updates });
        setProgress(`完成：已更新 ${updates.length} 个单元格`, "success");
        showMessage(`数据库 AI 应用完成：已更新 ${updates.length} 个单元格`);
      } catch (error) {
        console.error(`[${PLUGIN_NAME}] run column failed`, error);
        setProgress(`执行失败：${error.message}`, "error");
      } finally {
        running = false;
      }
    };

    root.querySelector('[data-action="toggle-settings"]').addEventListener("click", () => {
      root.querySelector(".moon-db-ai-settings").classList.toggle("fn__none");
    });
    field("preset").addEventListener("change", () => {
      const preset = PROVIDER_PRESETS[field("preset").value];
      if (!preset) return;
      field("protocol").value = preset.protocol;
      field("endpoint").value = preset.endpoint;
      field("model").value = preset.model;
      role("model-status").textContent =
        field("preset").value === "custom" ? "请填写第三方接口地址、API Key 和模型名称" : `已切换到 ${preset.label}`;
    });
    root.querySelector('[data-action="save-settings"]').addEventListener("click", async () => {
      try {
        await this.saveSettings(readSettings());
        role("model-status").textContent = "设置已保存，重启后仍会保留";
      } catch (error) {
        console.error(`[${PLUGIN_NAME}] save settings failed`, error);
        role("model-status").textContent = `保存失败：${error.message}`;
      }
    });
    root.querySelector('[data-action="detect-models"]').addEventListener("click", async () => {
      role("model-status").textContent = "正在检测...";
      try {
        const models = await listLocalModels(readSettings());
        role("model-status").textContent = models.length ? `检测到：${models.join(", ")}` : "接口可用，但没有模型";
        if (!field("model").value && models[0]) field("model").value = models[0];
      } catch (error) {
        role("model-status").textContent = `连接失败：${error.message}`;
      }
    });
    root.querySelectorAll(".moon-db-ai-card").forEach((card) => {
      card.addEventListener("click", () => updateOperation(card.dataset.operation));
    });
    root.querySelector('[data-action="select-all-sources"]').addEventListener("click", () => {
      root.querySelectorAll("[data-source-id]").forEach((checkbox) => {
        checkbox.checked = true;
      });
    });
    root.querySelector('[data-action="clear-sources"]').addEventListener("click", () => {
      root.querySelectorAll("[data-source-id]").forEach((checkbox) => {
        checkbox.checked = false;
      });
    });
    root.querySelector('[data-action="preview"]').addEventListener("click", runPreview);
    root.querySelector('[data-action="run"]').addEventListener("click", runColumn);
    root.querySelector('[data-action="complete-formula"]').addEventListener("click", async () => {
      try {
        setProgress("正在让本地模型补全公式...");
        const prompt = `你是 Excel 公式助手。数据库字段为：${database.view.columns
          .map((column) => column.name)
          .join("、")}。请根据要求生成一个公式：${field("formula-request").value.trim()}。
只输出公式，不解释。字段引用必须写成 {字段名}。可用函数：SUM、AVG、MIN、MAX、ROUND、ABS、COUNT、POW、SQRT。`;
        field("formula").value = await callLocalModel(readSettings(), prompt);
        setProgress("公式已补全，请预览确认", "success");
      } catch (error) {
        setProgress(`补全失败：${error.message}`, "error");
      }
    });
  }
}

module.exports = DatabaseAIPlugin;
