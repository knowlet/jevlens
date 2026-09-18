// Shared fixture scoring for the evaluation entry points (local heuristic baseline, Jev gate, and
// the node tests). Keeping one implementation means the two providers are always judged by the same
// rules, so their numbers stay comparable.

export function allowed(value) {
  return Array.isArray(value) ? value : [value];
}

export function scoreCase(testCase, result) {
  const checks = [];

  for (const [field, expected] of Object.entries(testCase.expected?.labels || {})) {
    const actual = result?.labels?.[field];
    checks.push({ field, ok: allowed(expected).includes(actual), actual, expected: allowed(expected) });
  }

  for (const [field, rule] of Object.entries(testCase.expected?.risk || {})) {
    const actual = Number(result?.risk?.[field]);
    let ok = Number.isFinite(actual);
    if (rule.min != null) ok = ok && actual >= Number(rule.min);
    if (rule.max != null) ok = ok && actual <= Number(rule.max);
    checks.push({ field: `risk.${field}`, ok, actual, expected: rule });
  }

  return {
    checks,
    pass: checks.every(check => check.ok),
    passed: checks.filter(check => check.ok).length,
    total: checks.length
  };
}

// Fixtures may scope themselves to one provider with `providers: ["jev"]`. Without that field a
// fixture applies to every provider.
export function casesForProvider(cases, provider, { split = "all", onlyProviderScoped = false } = {}) {
  return (cases || []).filter(testCase => {
    if (split !== "all" && (testCase.split || "regression") !== split) return false;
    const scoped = Array.isArray(testCase.providers);
    if (onlyProviderScoped) return scoped && testCase.providers.includes(provider);
    return !scoped || testCase.providers.includes(provider);
  });
}
