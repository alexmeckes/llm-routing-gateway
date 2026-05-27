const API_KEY_HEADER = "Otari-Key";

const state = {
  key: sessionStorage.getItem("gateway-admin-master-key") || "",
  policies: [],
  projects: [],
  budgets: [],
  alerts: [],
  traces: [],
  usageEntries: [],
  usage: null,
  traceSummary: null,
  resolverResult: null
};

const $ = (id) => document.getElementById(id);

const money = (value) => Number(value || 0).toLocaleString(undefined, {
  currency: "USD",
  maximumFractionDigits: 6,
  style: "currency"
});

const number = (value) => Number(value || 0).toLocaleString();
const percent = (value) => `${Number(value || 0).toFixed(1)}%`;
const safe = (value) => String(value ?? "");

function escapeHtml(value) {
  return safe(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function compactDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safe(value);
  return date.toLocaleString();
}

function statusPill(value) {
  const status = safe(value || "unknown");
  let cls = "";
  if (["active", "success", "healthy", "delivered"].includes(status)) cls = "ok";
  if (["draft", "pending", "retrying"].includes(status)) cls = "warn";
  if (["archived", "error", "blocked", "dead_letter", "failed"].includes(status)) cls = "bad";
  return `<span class="pill ${cls}">${escapeHtml(status)}</span>`;
}

function jsonBlock(value) {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function setConnection(message, connected = false) {
  $("connection-state").textContent = message;
  $("connection-state").className = connected ? "ok-text" : "";
}

function setUpdated() {
  $("last-updated").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

let toastTimer = null;

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove("visible"), 2600);
}

function query(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

function authHeaders(extra = {}) {
  return { ...extra, [API_KEY_HEADER]: `Bearer ${state.key}` };
}

async function api(path, options = {}) {
  if (!state.key) throw new Error("Master key is required");
  const response = await fetch(path, {
    ...options,
    headers: authHeaders(options.headers || {})
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const detail = payload && payload.detail ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}

function table(headers, rows) {
  if (!rows.length) return `<div class="empty">No rows</div>`;
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function metric(label, value, detail = "") {
  return `
    <article class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<small class="muted">${escapeHtml(detail)}</small>` : ""}
    </article>
  `;
}

function barList(items, valueKey = "count", label = "count") {
  const max = Math.max(1, ...items.map((item) => Number(item[valueKey] || 0)));
  if (!items.length) return `<div class="empty">No activity yet</div>`;
  return `
    <div class="bar-list">
      ${items.slice(0, 8).map((item) => {
        const value = Number(item[valueKey] || 0);
        const width = Math.max(4, (value / max) * 100);
        return `
          <div class="bar-row">
            <div class="bar-meta">
              <span>${escapeHtml(item.key)}</span>
              <span class="muted">${escapeHtml(number(value))} ${escapeHtml(label)}</span>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width: ${width}%"></div></div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function selectedValue(id) {
  const element = $(id);
  return element ? element.value : "";
}

function setSelectOptions(id, options, firstLabel) {
  const element = $(id);
  const current = element.value;
  element.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>${options.map((option) => `
    <option value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</option>
  `).join("")}`;
  if (options.some((option) => option.value === current)) element.value = current;
}

function renderFilters() {
  const projectOptions = state.projects.map((project) => ({
    value: project.project_id,
    label: project.name ? `${project.name} (${project.project_id})` : project.project_id
  }));
  const policyOptions = state.policies.map((policy) => ({
    value: policy.policy_id,
    label: `${policy.name} (${policy.policy_id})`
  }));
  setSelectOptions("trace-project-filter", projectOptions, "All projects");
  setSelectOptions("usage-project-filter", projectOptions, "All projects");
  setSelectOptions("trace-policy-filter", policyOptions, "All policies");
}

function renderOverview() {
  const usage = state.usage || {};
  const traceSummary = state.traceSummary || {};
  const totalTraces = Number(traceSummary.total_count || 0);
  const successRate = totalTraces ? (Number(traceSummary.success_count || 0) / totalTraces) * 100 : 0;
  const activePolicies = state.policies.filter((policy) => policy.status === "active").length;
  const defaultPolicy = state.policies.find((policy) => policy.is_default);
  $("overview-metrics").innerHTML = [
    metric("Policies", state.policies.length, `${activePolicies} active`),
    metric("Projects", state.projects.length),
    metric("Trace success", percent(successRate), `${number(totalTraces)} traced requests`),
    metric("Usage cost", money(usage.cost || 0), `${number(usage.total_tokens || 0)} tokens`),
    metric("Budget alerts", state.alerts.length),
    metric("Budgets", state.budgets.length),
    metric("Errors", number((usage.error_count || 0) + (traceSummary.error_count || 0))),
    metric("Providers", new Set((usage.by_provider || []).map((bucket) => bucket.key)).size)
  ].join("");

  $("default-policy").innerHTML = defaultPolicy ? `
    <div class="stack">
      <div><strong>${escapeHtml(defaultPolicy.name)}</strong></div>
      <div class="mono muted">${escapeHtml(defaultPolicy.policy_id)}</div>
      <div class="row">
        ${statusPill(defaultPolicy.status)}
        <span class="pill">${escapeHtml(defaultPolicy.strategy)}</span>
        <span class="pill">rev ${escapeHtml(defaultPolicy.revision)}</span>
      </div>
      <button type="button" data-action="policy-json" data-id="${escapeAttr(defaultPolicy.policy_id)}">Open policy</button>
    </div>
  ` : `<div class="empty">No default policy is configured</div>`;

  $("routing-mix").innerHTML = barList(traceSummary.by_provider || [], "count", "routes");
}

function renderPolicies() {
  const statusFilter = selectedValue("policy-status-filter");
  const policies = statusFilter
    ? state.policies.filter((policy) => policy.status === statusFilter)
    : state.policies;
  const rows = policies.map((policy) => `
    <tr>
      <td>
        <strong>${escapeHtml(policy.name)}</strong>
        <div class="mono muted">${escapeHtml(policy.policy_id)}</div>
      </td>
      <td>${statusPill(policy.status)}</td>
      <td>${policy.is_default ? '<span class="pill ok">default</span>' : '<span class="muted">no</span>'}</td>
      <td>${escapeHtml(policy.strategy)}</td>
      <td>${escapeHtml(policy.revision)}</td>
      <td>${compactDate(policy.updated_at)}</td>
      <td>
        <div class="row">
          <button type="button" data-action="policy-json" data-id="${escapeAttr(policy.policy_id)}">Details</button>
          <button type="button" data-action="edit-policy" data-id="${escapeAttr(policy.policy_id)}">Edit</button>
          <button type="button" data-action="policy-revisions" data-id="${escapeAttr(policy.policy_id)}">Revisions</button>
          <button type="button" data-action="clone-policy" data-id="${escapeAttr(policy.policy_id)}">Clone</button>
          ${policy.is_default ? "" : `<button type="button" data-action="promote-policy" data-id="${escapeAttr(policy.policy_id)}">Make default</button>`}
          <button class="warn" type="button" data-action="toggle-policy-status" data-id="${escapeAttr(policy.policy_id)}">
            ${policy.status === "archived" ? "Activate" : "Archive"}
          </button>
          <button class="danger" type="button" data-action="delete-policy" data-id="${escapeAttr(policy.policy_id)}">Delete</button>
        </div>
      </td>
    </tr>
  `);
  $("policies-table").innerHTML = table(["Policy", "Status", "Default", "Strategy", "Rev", "Updated", ""], rows);
}

function renderProjects() {
  const rows = state.projects.map((project) => `
    <tr>
      <td>
        <strong>${escapeHtml(project.name || project.project_id)}</strong>
        <div class="mono muted">${escapeHtml(project.project_id)}</div>
      </td>
      <td>${project.is_active ? statusPill("active") : statusPill("archived")}</td>
      <td>${project.blocked ? statusPill("blocked") : '<span class="pill ok">allowed</span>'}</td>
      <td><span class="mono">${escapeHtml(project.routing_policy_id || "default")}</span></td>
      <td>${money(project.spend || 0)}</td>
      <td>
        <div class="row">
          <button type="button" data-action="project-json" data-id="${escapeAttr(project.project_id)}">Details</button>
          <button type="button" data-action="edit-project" data-id="${escapeAttr(project.project_id)}">Edit</button>
        </div>
      </td>
    </tr>
  `);
  $("projects-table").innerHTML = table(["Project", "State", "Traffic", "Policy", "Spend", ""], rows);
}

function renderTraces() {
  const rows = state.traces.map((trace) => `
    <tr>
      <td>
        <span class="mono">${escapeHtml(trace.trace_id)}</span>
        <div class="muted">${compactDate(trace.timestamp)}</div>
      </td>
      <td>${statusPill(trace.status)}</td>
      <td>${escapeHtml(trace.selected_model || "")}</td>
      <td>${escapeHtml(trace.policy_source || "")}</td>
      <td>${money(trace.estimated_cost || 0)}</td>
      <td><button type="button" data-action="trace-json" data-id="${escapeAttr(trace.trace_id)}">Open</button></td>
    </tr>
  `);
  $("traces-table").innerHTML = table(["Trace", "Status", "Selected model", "Source", "Cost", ""], rows);
}

function bucketSection(title, buckets, valueKey = "cost", valueFormatter = money) {
  const rows = (buckets || []).slice(0, 8).map((bucket) => `
    <tr>
      <td>${escapeHtml(bucket.key)}</td>
      <td>${number(bucket.count)}</td>
      <td>${escapeHtml(valueFormatter(bucket[valueKey] || 0))}</td>
    </tr>
  `);
  return `
    <div class="stack">
      <h3>${escapeHtml(title)}</h3>
      ${table(["Key", "Count", valueKey === "cost" ? "Cost" : "Value"], rows)}
    </div>
  `;
}

function renderUsage() {
  const usage = state.usage || {};
  $("usage-metrics").innerHTML = [
    metric("Requests", number(usage.total_count || 0)),
    metric("Tokens", number(usage.total_tokens || 0)),
    metric("Cost", money(usage.cost || 0)),
    metric("Errors", number(usage.error_count || 0))
  ].join("");
  $("usage-breakdown").innerHTML = `
    <div class="stack">
      ${bucketSection("By project", usage.by_project || [])}
      ${bucketSection("By provider", usage.by_provider || [])}
      ${bucketSection("By tag", usage.by_tag || [])}
    </div>
  `;
  const rows = state.usageEntries.map((entry) => `
    <tr>
      <td>
        <span class="mono">${escapeHtml(entry.id)}</span>
        <div class="muted">${compactDate(entry.timestamp)}</div>
      </td>
      <td>${statusPill(entry.status)}</td>
      <td>${escapeHtml(entry.model)}</td>
      <td>${escapeHtml(entry.project_id || "")}</td>
      <td>${number(entry.total_tokens || 0)}</td>
      <td>${money(entry.cost || 0)}</td>
    </tr>
  `);
  $("usage-table").innerHTML = table(["Request", "Status", "Model", "Project", "Tokens", "Cost"], rows);
}

function renderBudgets() {
  const budgetRows = state.budgets.map((budget) => `
    <tr>
      <td><span class="mono">${escapeHtml(budget.budget_id)}</span></td>
      <td>${statusPill(budget.scope_type)}</td>
      <td>${money(budget.spend || 0)} / ${budget.max_budget === null ? "unlimited" : money(budget.max_budget)}</td>
      <td>${budget.is_active ? statusPill("active") : statusPill("archived")}</td>
      <td>${budget.blocked ? statusPill("blocked") : '<span class="pill ok">allowed</span>'}</td>
      <td><button type="button" data-action="budget-json" data-id="${escapeAttr(budget.budget_id)}">Details</button></td>
    </tr>
  `);
  $("budgets-table").innerHTML = table(["Budget", "Scope", "Spend", "State", "Traffic", ""], budgetRows);

  const alertRows = state.alerts.map((alert) => `
    <tr>
      <td><span class="mono">${escapeHtml(alert.id)}</span></td>
      <td>${escapeHtml(alert.scope_type)}:${escapeHtml(alert.scope_id || "")}</td>
      <td>${statusPill(alert.delivery_status)}</td>
      <td>${money(alert.spend || 0)}</td>
      <td>${compactDate(alert.created_at)}</td>
      <td>
        <div class="row">
          <button type="button" data-action="alert-json" data-id="${escapeAttr(alert.id)}">Details</button>
          <button type="button" data-action="retry-alert" data-id="${escapeAttr(alert.id)}">Retry</button>
        </div>
      </td>
    </tr>
  `);
  $("alerts-table").innerHTML = table(["Alert", "Scope", "Delivery", "Spend", "Created", ""], alertRows);
}

function renderResolver() {
  const result = state.resolverResult;
  if (!result) {
    $("resolver-result").innerHTML = `<div class="empty">Run a dry route resolution to inspect policy decisions</div>`;
    return;
  }
  const candidateRows = (result.candidates || []).map((candidate) => `
    <tr>
      <td>${escapeHtml(candidate.model)}</td>
      <td>${escapeHtml(candidate.provider)}</td>
      <td>${money(candidate.estimated_cost || 0)}</td>
      <td>${candidate.routing_score === null ? "" : escapeHtml(Number(candidate.routing_score).toFixed(4))}</td>
      <td>${escapeHtml(candidate.provider_health ? candidate.provider_health.status : "")}</td>
    </tr>
  `);
  const rejectedRows = (result.rejected_candidates || []).map((candidate) => `
    <tr>
      <td>${escapeHtml(candidate.model)}</td>
      <td>${escapeHtml(candidate.provider)}</td>
      <td>${escapeHtml(candidate.reason)}</td>
    </tr>
  `);
  $("resolver-result").innerHTML = `
    <div class="stack">
      <div class="row">
        <span class="pill ok">selected</span>
        <strong>${escapeHtml(result.selected_model)}</strong>
        <span class="muted">${escapeHtml(result.reason || "")}</span>
      </div>
      <div class="row">
        <span class="pill">${escapeHtml(result.strategy)}</span>
        <span class="pill">${escapeHtml(result.policy_name)}</span>
        <span class="pill">${money(result.estimated_cost || 0)}</span>
      </div>
      <h3>Candidates</h3>
      ${table(["Model", "Provider", "Cost", "Score", "Health"], candidateRows)}
      <h3>Rejected candidates</h3>
      ${table(["Model", "Provider", "Reason"], rejectedRows)}
      <button type="button" data-action="resolver-json">Open JSON</button>
    </div>
  `;
}

function renderAll() {
  renderFilters();
  renderOverview();
  renderPolicies();
  renderProjects();
  renderTraces();
  renderUsage();
  renderBudgets();
  renderResolver();
}

function showModal(title, body, actions = "") {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = body;
  $("modal-actions").innerHTML = actions;
  $("modal").showModal();
}

function closeModal() {
  $("modal").close();
  $("modal-actions").innerHTML = "";
}

function showJson(title, value) {
  showModal(title, jsonBlock(value));
}

function showJsonEditor({ title, value, submitLabel, onSubmit }) {
  showModal(
    title,
    `<textarea class="json-editor" id="json-editor" spellcheck="false">${escapeHtml(JSON.stringify(value, null, 2))}</textarea>`,
    `<button type="button" id="modal-submit" class="primary">${escapeHtml(submitLabel)}</button>`
  );
  $("modal-submit").addEventListener("click", async () => {
    try {
      const payload = JSON.parse($("json-editor").value);
      await onSubmit(payload);
      closeModal();
      toast(`${submitLabel} complete`);
    } catch (error) {
      toast(error.message);
    }
  });
}

async function loadPolicies() {
  state.policies = await api("/v1/routing-policies?limit=200");
}

async function loadProjects() {
  state.projects = await api("/v1/projects?limit=200");
}

async function loadBudgets() {
  state.budgets = await api("/v1/budgets?limit=200");
}

async function loadAlerts() {
  state.alerts = await api("/v1/budgets/alerts?limit=100");
}

function traceFilterParams(limit) {
  return {
    limit,
    project_id: selectedValue("trace-project-filter"),
    policy_id: selectedValue("trace-policy-filter"),
    status: selectedValue("trace-status-filter")
  };
}

async function loadTraces() {
  state.traces = await api(`/v1/route-traces${query(traceFilterParams(50))}`);
  state.traceSummary = await api(`/v1/route-traces/summary${query(traceFilterParams(1000))}`);
}

function usageFilterParams(limit) {
  return {
    limit,
    project_id: selectedValue("usage-project-filter")
  };
}

async function loadUsage() {
  state.usage = await api(`/v1/usage/summary${query(usageFilterParams(1000))}`);
  state.usageEntries = await api(`/v1/usage${query(usageFilterParams(50))}`);
}

async function refreshAll() {
  state.key = $("master-key").value.trim();
  sessionStorage.setItem("gateway-admin-master-key", state.key);
  setConnection("Loading...");
  try {
    await Promise.all([loadPolicies(), loadProjects(), loadBudgets(), loadAlerts()]);
    renderFilters();
    await Promise.all([loadTraces(), loadUsage()]);
    renderAll();
    setConnection("Connected", true);
    setUpdated();
  } catch (error) {
    setConnection("Disconnected");
    toast(error.message);
  }
}

function currentPolicy(id) {
  return state.policies.find((policy) => policy.policy_id === id);
}

function currentProject(id) {
  return state.projects.find((project) => project.project_id === id);
}

function currentBudget(id) {
  return state.budgets.find((budget) => budget.budget_id === id);
}

function currentAlert(id) {
  return state.alerts.find((alert) => String(alert.id) === String(id));
}

async function reloadAndRender() {
  await Promise.all([loadPolicies(), loadProjects(), loadBudgets(), loadAlerts()]);
  renderFilters();
  await Promise.all([loadTraces(), loadUsage()]);
  renderAll();
  setUpdated();
}

function createPolicyEditor() {
  showJsonEditor({
    title: "Create routing policy",
    submitLabel: "Create policy",
    value: {
      name: "Production router",
      is_default: false,
      status: "draft",
      default_strategy: {
        type: "fallback",
        providers: [{ provider: "openai", model: "gpt-4o-mini", priority: 1 }]
      },
      change_note: "Created from admin dashboard"
    },
    onSubmit: async (payload) => {
      await api("/v1/routing-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await reloadAndRender();
    }
  });
}

function editPolicy(policy) {
  showJsonEditor({
    title: `Edit ${policy.name}`,
    submitLabel: "Update policy",
    value: {
      name: policy.name,
      status: policy.status,
      is_default: policy.is_default,
      strategy: policy.strategy,
      config: policy.config,
      change_note: "Updated from admin dashboard"
    },
    onSubmit: async (payload) => {
      await api(`/v1/routing-policies/${encodeURIComponent(policy.policy_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await reloadAndRender();
    }
  });
}

async function showRevisions(policyId) {
  const revisions = await api(`/v1/routing-policies/${encodeURIComponent(policyId)}/revisions?limit=50`);
  const rows = revisions.map((revision) => `
    <tr>
      <td>${escapeHtml(revision.revision)}</td>
      <td>${escapeHtml(revision.action)}</td>
      <td>${statusPill(revision.status)}</td>
      <td>${escapeHtml(revision.change_note || "")}</td>
      <td>
        <div class="row">
          <button type="button" data-action="revision-json" data-policy-id="${escapeAttr(policyId)}" data-revision="${escapeAttr(revision.revision)}">JSON</button>
          <button class="warn" type="button" data-action="apply-revision" data-policy-id="${escapeAttr(policyId)}" data-revision="${escapeAttr(revision.revision)}">Apply</button>
        </div>
      </td>
    </tr>
  `);
  showModal("Policy revisions", table(["Rev", "Action", "Status", "Note", ""], rows));
}

function createProjectEditor() {
  showJsonEditor({
    title: "Create project",
    submitLabel: "Create project",
    value: {
      project_id: "prod-chat",
      name: "Production chat",
      routing_policy_id: null,
      budget_id: null,
      blocked: false,
      is_active: true,
      metadata: {}
    },
    onSubmit: async (payload) => {
      await api("/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await reloadAndRender();
    }
  });
}

function editProject(project) {
  showJsonEditor({
    title: `Edit ${project.project_id}`,
    submitLabel: "Update project",
    value: {
      name: project.name,
      routing_policy_id: project.routing_policy_id,
      budget_id: project.budget_id,
      blocked: project.blocked,
      is_active: project.is_active,
      metadata: project.metadata
    },
    onSubmit: async (payload) => {
      await api(`/v1/projects/${encodeURIComponent(project.project_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await reloadAndRender();
    }
  });
}

function createBudgetEditor() {
  showJsonEditor({
    title: "Create budget",
    submitLabel: "Create budget",
    value: {
      max_budget: 1000,
      budget_duration_sec: 2592000,
      scope_type: "tag",
      match_tags: { team: "platform" },
      alert_thresholds: [0.5, 0.8, 0.95],
      alert_webhook_url: null,
      blocked: false,
      is_active: true
    },
    onSubmit: async (payload) => {
      await api("/v1/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await reloadAndRender();
    }
  });
}

async function runResolver() {
  try {
    const payload = JSON.parse($("resolver-payload").value);
    state.resolverResult = await api("/v1/routing/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    renderResolver();
    toast("Route resolved");
  } catch (error) {
    toast(error.message);
  }
}

async function handleAction(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;

  try {
    if (action === "create-policy") createPolicyEditor();
    if (action === "policy-json") showJson("Policy JSON", currentPolicy(id));
    if (action === "edit-policy") editPolicy(currentPolicy(id));
    if (action === "policy-revisions") await showRevisions(id);
    if (action === "clone-policy") {
      await api(`/v1/routing-policies/${encodeURIComponent(id)}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change_note: "Cloned from admin dashboard" })
      });
      await reloadAndRender();
      toast("Policy cloned");
    }
    if (action === "promote-policy") {
      await api(`/v1/routing-policies/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active", is_default: true, change_note: "Promoted from admin dashboard" })
      });
      await reloadAndRender();
      toast("Default policy updated");
    }
    if (action === "toggle-policy-status") {
      const policy = currentPolicy(id);
      const nextStatus = policy.status === "archived" ? "active" : "archived";
      await api(`/v1/routing-policies/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, change_note: `${nextStatus} from admin dashboard` })
      });
      await reloadAndRender();
      toast("Policy status updated");
    }
    if (action === "delete-policy") {
      if (!window.confirm("Delete this routing policy?")) return;
      await api(`/v1/routing-policies/${encodeURIComponent(id)}${query({ change_note: "Deleted from admin dashboard" })}`, {
        method: "DELETE"
      });
      await reloadAndRender();
      toast("Policy deleted");
    }
    if (action === "revision-json") {
      const revision = await api(`/v1/routing-policies/${encodeURIComponent(target.dataset.policyId)}/revisions/${target.dataset.revision}`);
      showJson("Policy revision JSON", revision);
    }
    if (action === "apply-revision") {
      await api(`/v1/routing-policies/${encodeURIComponent(target.dataset.policyId)}/revisions/${target.dataset.revision}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change_note: `Applied revision ${target.dataset.revision} from admin dashboard` })
      });
      closeModal();
      await reloadAndRender();
      toast("Revision applied");
    }
    if (action === "create-project") createProjectEditor();
    if (action === "project-json") showJson("Project JSON", currentProject(id));
    if (action === "edit-project") editProject(currentProject(id));
    if (action === "trace-json") showJson("Route trace", await api(`/v1/route-traces/${encodeURIComponent(id)}`));
    if (action === "resolver-json") showJson("Resolved route JSON", state.resolverResult);
    if (action === "create-budget") createBudgetEditor();
    if (action === "budget-json") showJson("Budget JSON", currentBudget(id));
    if (action === "alert-json") showJson("Budget alert JSON", currentAlert(id));
    if (action === "retry-alert") {
      await api(`/v1/budgets/alerts/${encodeURIComponent(id)}/deliver`, { method: "POST" });
      await loadAlerts();
      renderBudgets();
      renderOverview();
      toast("Alert delivery retried");
    }
  } catch (error) {
    toast(error.message);
  }
}

function activateTab(view) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".view").forEach((panel) => panel.classList.toggle("active", panel.id === `view-${view}`));
}

function initResolverPayload() {
  $("resolver-payload").value = JSON.stringify({
    model: "default_routing",
    project_id: null,
    tags: { surface: "chat" },
    messages: [{ role: "user", content: "Compare the cost and latency tradeoffs for this request." }]
  }, null, 2);
}

function init() {
  $("master-key").value = state.key;
  initResolverPayload();
  renderAll();
  if (state.key) setConnection("Key loaded");

  $("auth-form").addEventListener("submit", (event) => {
    event.preventDefault();
    refreshAll();
  });
  $("refresh-all").addEventListener("click", refreshAll);
  $("tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-view]");
    if (tab) activateTab(tab.dataset.view);
  });
  $("policy-status-filter").addEventListener("change", async () => {
    await loadPolicies();
    renderPolicies();
    renderOverview();
  });
  $("reload-traces").addEventListener("click", async () => {
    await loadTraces();
    renderTraces();
    renderOverview();
    setUpdated();
  });
  ["trace-project-filter", "trace-policy-filter", "trace-status-filter"].forEach((id) => {
    $(id).addEventListener("change", async () => {
      await loadTraces();
      renderTraces();
      renderOverview();
      setUpdated();
    });
  });
  $("reload-usage").addEventListener("click", async () => {
    await loadUsage();
    renderUsage();
    renderOverview();
    setUpdated();
  });
  $("usage-project-filter").addEventListener("change", async () => {
    await loadUsage();
    renderUsage();
    renderOverview();
    setUpdated();
  });
  $("run-resolver").addEventListener("click", runResolver);
  $("modal-close").addEventListener("click", closeModal);
  document.body.addEventListener("click", handleAction);
}

document.addEventListener("DOMContentLoaded", init);
