(() => {
  "use strict";

  const cases = globalThis.JevLensEvalCases || [];
  const $ = (id) => document.getElementById(id);
  const state = { stop: false, runs: [] };

  const send = (message) => new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });

  function getPath(obj, path) {
    return path.split(".").reduce((v, k) => v?.[k], obj);
  }

  function allowed(value) {
    return Array.isArray(value) ? value : [value];
  }

  function scoreCase(testCase, actual) {
    const checks = [];
    const labels = testCase.expected?.labels || {};
    for (const [field, expected] of Object.entries(labels)) {
      const got = getPath(actual, `labels.${field}`);
      const ok = allowed(expected).includes(got);
      checks.push({ type: "label", field, ok, expected: allowed(expected), actual: got });
    }

    const risk = testCase.expected?.risk || {};
    for (const [field, rule] of Object.entries(risk)) {
      const got = Number(getPath(actual, `risk.${field}`));
      let ok = Number.isFinite(got);
      if (ok && rule.min != null) ok = ok && got >= Number(rule.min);
      if (ok && rule.max != null) ok = ok && got <= Number(rule.max);
      checks.push({ type: "risk", field, ok, expected: rule, actual: got });
    }

    return {
      pass: checks.every(c => c.ok),
      checks,
      passed: checks.filter(c => c.ok).length,
      total: checks.length
    };
  }

  function fmtPct(n) { return `${Math.round(n * 1000) / 10}%`; }

  function summarize(runs) {
    const groups = new Map();
    for (const row of runs) {
      const split = row.testCase?.split || "regression";
      const key = `${row.provider}:${split}`;
      if (!groups.has(key)) groups.set(key, {
        provider: row.provider,
        split,
        passed: 0,
        total: 0,
        casesPassed: 0,
        casesTotal: 0,
        fields: new Map()
      });
      const p = groups.get(key);
      p.casesTotal++;
      if (row.score?.pass) p.casesPassed++;
      for (const c of row.score?.checks || []) {
        p.total++;
        if (c.ok) p.passed++;
        const fieldKey = `${c.type}.${c.field}`;
        if (!p.fields.has(fieldKey)) p.fields.set(fieldKey, { passed: 0, total: 0 });
        const f = p.fields.get(fieldKey);
        f.total++;
        if (c.ok) f.passed++;
      }
    }
    return groups;
  }

  function renderSummary() {
    const summary = summarize(state.runs);
    const box = $("summary");
    box.replaceChildren();
    box.classList.toggle("hidden", state.runs.length === 0);

    for (const [, s] of summary) {
      const card = document.createElement("div");
      card.className = "metric-card";
      const acc = s.total ? s.passed / s.total : 0;
      card.innerHTML = `<span>${s.provider} · ${s.split}</span><strong>${fmtPct(acc)}</strong><small>field checks ${s.passed}/${s.total} · full cases ${s.casesPassed}/${s.casesTotal}</small>`;
      box.appendChild(card);
    }

    const tbody = $("metricsTable").querySelector("tbody");
    tbody.replaceChildren();
    for (const [, s] of summary) {
      for (const [dimension, f] of [...s.fields.entries()].sort()) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${s.provider}</td><td>${s.split}</td><td>${dimension}</td><td>${f.passed}</td><td>${f.total}</td><td>${fmtPct(f.total ? f.passed / f.total : 0)}</td>`;
        tbody.appendChild(tr);
      }
    }
  }

  function renderRows() {
    const tbody = $("casesTable").querySelector("tbody");
    tbody.replaceChildren();

    for (const row of state.runs) {
      const tr = document.createElement("tr");
      const tc = row.testCase;
      const result = row.error ? "ERROR" : row.score.pass ? "PASS" : "FAIL";
      const failed = row.score?.checks?.filter(c => !c.ok) || [];

      const caseTd = document.createElement("td");
      caseTd.innerHTML = `<div class="case-id">${tc.id}</div><div>${tc.language} · ${tc.kind}</div>`;
      const tags = document.createElement("div");
      tags.className = "tags";
      for (const tag of tc.tags || []) {
        const span = document.createElement("span");
        span.className = "tag";
        span.textContent = tag;
        tags.appendChild(span);
      }
      caseTd.appendChild(tags);

      const providerTd = document.createElement("td");
      providerTd.textContent = row.provider;

      const resultTd = document.createElement("td");
      resultTd.className = row.error || !row.score?.pass ? "fail" : "pass";
      resultTd.textContent = result;

      const expectedTd = document.createElement("td");
      const preExpected = document.createElement("pre");
      preExpected.textContent = failed.length
        ? failed.map(c => `${c.field}: got=${JSON.stringify(c.actual)} expected=${JSON.stringify(c.expected)}`).join("\n")
        : "all checked expectations matched";
      expectedTd.appendChild(preExpected);

      const detailsTd = document.createElement("td");
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = tc.note || "查看 input / output";
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify({ features: tc.features, actual: row.actual, error: row.error || null }, null, 2);
      details.append(summary, pre);
      detailsTd.appendChild(details);

      tr.append(caseTd, providerTd, resultTd, expectedTd, detailsTd);
      tbody.appendChild(tr);
    }
  }

  function setBusy(busy) {
    $("runLocal").disabled = busy;
    $("runJev").disabled = busy;
    $("runBoth").disabled = busy;
    $("stop").disabled = !busy;
  }

  function selectedCases() {
    const split = $("splitFilter").value;
    return split === "all" ? cases : cases.filter(c => (c.split || "regression") === split);
  }

  async function runProvider(provider) {
    const selected = selectedCases().filter(tc => !Array.isArray(tc.providers) || tc.providers.includes(provider));
    let index = 0;
    for (const tc of selected) {
      if (state.stop) break;
      index++;
      $("status").textContent = `${provider}: ${index}/${selected.length} · ${tc.id}`;

      const type = provider === "jev" ? "EVAL_CLASSIFY" : "EVAL_LOCAL";
      const response = await send({ type, kind: tc.kind, features: tc.features });
      let row;
      if (!response?.ok) {
        row = { provider, testCase: tc, actual: null, error: response?.error || "unknown error", score: { pass: false, checks: [], passed: 0, total: 0 } };
      } else {
        const actual = response.result;
        row = { provider, testCase: tc, actual, error: null, score: scoreCase(tc, actual) };
      }
      state.runs.push(row);
      renderRows();
      renderSummary();

      if (provider === "jev") await new Promise(r => setTimeout(r, 250));
    }
  }

  async function run(mode) {
    state.stop = false;
    state.runs = [];
    setBusy(true);
    $("download").disabled = true;
    renderRows();
    renderSummary();

    try {
      if (mode === "local" || mode === "both") await runProvider("local");
      if (!state.stop && (mode === "jev" || mode === "both")) await runProvider("jev");
    } finally {
      setBusy(false);
      $("download").disabled = state.runs.length === 0;
      $("status").textContent = state.stop ? `已停止 · ${state.runs.length} results` : `完成 · ${state.runs.length} results`;
    }
  }

  $("runLocal").onclick = () => run("local");
  $("runJev").onclick = () => run("jev");
  $("runBoth").onclick = () => run("both");
  $("stop").onclick = () => { state.stop = true; };
  $("download").onclick = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      classifier: "JevLens",
      cases: cases.length,
      results: state.runs.map(r => ({ provider: r.provider, id: r.testCase.id, score: r.score, actual: r.actual, error: r.error }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jevlens-eval-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  $("splitFilter").onchange = () => { $("status").textContent = `目前 ${selectedCases().length} 個案例`; };
  $("status").textContent = `共 ${cases.length} 個案例`;
})();
