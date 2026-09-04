// Inflation index, in two halves that answer different questions:
//
// 1. Divine Price — each investment currency's own Divine-denominated price
//    (poe.ninja quotes everything directly in Divine, so no ratio math needed).
//    A rising line means that currency costs more Divine than it used to. On its
//    own this is ambiguous: it could mean the currency is genuinely more sought
//    after, OR it could just mean Divine itself is inflating (more Divines
//    entering the economy over the league, same as any currency's supply
//    growing) and *everything* costs more Divine as a result.
//
// 2. vs Mirror — each currency's ratio to Mirror of Kalandra, which — because
//    Mirrors are by far the hardest currency in the game to produce — is the
//    closest thing PoE has to a supply that isn't constantly inflating. A FLAT
//    line here (holding its ratio to Mirror) means the currency is a genuine
//    store of value, even if its Divine Price line above is rising purely from
//    Divine inflation. A line drifting up means it takes more of that currency
//    to equal one Mirror — i.e. it's losing real ground, not just holding
//    steady while Divine erodes. A line drifting down means the opposite: it's
//    gaining real ground even against Mirror.
import { priceAt } from "../ledgerMath.js";
import { fmtDate, fmtPct, signClass, el } from "../format.js";

const charts = {};

const DIVINE_PRICE_METRICS = [
  {
    key: "divinePerMirror",
    label: "Divine per Mirror",
    shortLabel: "DIV / MIR",
    unitLabel: "div",
    currencyId: "mirror",
    chartColor: "#5aa9e6",
    compute: (p) => (p.mirror > 0 ? p.mirror : null),
  },
  {
    key: "divinePerHinekora",
    label: "Divine per Hinekora's Lock",
    shortLabel: "DIV / HIN",
    unitLabel: "div",
    currencyId: "hinekora",
    chartColor: "#b39ddb",
    compute: (p) => (p.hinekora > 0 ? p.hinekora : null),
  },
  {
    key: "divinePerOmenLight",
    label: "Divine per Omen of Light",
    shortLabel: "DIV / OoL",
    unitLabel: "div",
    currencyId: "omen_light",
    chartColor: "#e85d75",
    compute: (p) => (p.omenLight > 0 ? p.omenLight : null),
  },
  {
    key: "divinePerOmenWhittling",
    label: "Divine per Omen of Whittling",
    shortLabel: "DIV / OoW",
    unitLabel: "div",
    currencyId: "omen_whittling",
    chartColor: "#7fd6c0",
    compute: (p) => (p.omenWhittling > 0 ? p.omenWhittling : null),
  },
];

// compute() returns the currency's value as a FRACTION of one Mirror (its price
// divided by Mirror's price) rather than "X per Mirror" — so, same as the Divine
// Price metrics above, a rising value always means "gaining ground" and a falling
// value always means "losing ground," with color-coding staying consistent across
// both sections. displayValue() converts that fraction back to the familiar
// "X per Mirror" headline number (e.g. 3.41 locks) without affecting which
// direction counts as an improvement.
const MIRROR_RATIO_METRICS = [
  {
    key: "hinekoraVsMirror",
    label: "Hinekora's Lock vs Mirror",
    shortLabel: "HIN / MIR",
    unitLabel: "locks per mirror",
    currencyId: "hinekora",
    chartColor: "#b39ddb",
    compute: (p) => (p.mirror > 0 && p.hinekora > 0 ? p.hinekora / p.mirror : null),
    displayValue: (v) => (v > 0 ? 1 / v : null),
  },
  {
    key: "omenLightVsMirror",
    label: "Omen of Light vs Mirror",
    shortLabel: "OoL / MIR",
    unitLabel: "omens per mirror",
    currencyId: "omen_light",
    chartColor: "#e85d75",
    compute: (p) => (p.mirror > 0 && p.omenLight > 0 ? p.omenLight / p.mirror : null),
    displayValue: (v) => (v > 0 ? 1 / v : null),
  },
  {
    key: "omenWhittlingVsMirror",
    label: "Omen of Whittling vs Mirror",
    shortLabel: "OoW / MIR",
    unitLabel: "omens per mirror",
    currencyId: "omen_whittling",
    chartColor: "#7fd6c0",
    compute: (p) => (p.mirror > 0 && p.omenWhittling > 0 ? p.omenWhittling / p.mirror : null),
    displayValue: (v) => (v > 0 ? 1 / v : null),
  },
];

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    delete charts[key];
  }
}

/** Builds the {ts, value}[] series for each metric, dropping non-positive/invalid points. */
function buildSeries(metrics, rows) {
  return metrics.map((metric) => {
    const points = rows.map((r) => ({ ts: r.ts, value: metric.compute(r) })).filter((p) => p.value !== null && Number.isFinite(p.value) && p.value > 0);
    return { metric, points };
  });
}

/**
 * Renders one section: a row of stat cards (current value, 24h/all-time % change)
 * plus a line chart of every metric indexed to 100 at its first data point. Across
 * every metric in every section, rising = improving and falling = worsening, so
 * color-coding (green/red) always means the same thing regardless of what's
 * actually being measured.
 */
function renderSection(container, { series, dayAgo, currencyById, chartKey, canvasId, chartTitle, description }) {
  const statRow = el("div", { class: "stat-row" });
  for (const { metric, points } of series) {
    const currency = currencyById[metric.currencyId];
    if (points.length === 0) {
      statRow.appendChild(
        el("div", { class: "card", title: metric.label }, [
          el("div", { class: "stat-label" }, metric.shortLabel),
          el("div", { class: "stat-value" }, "—"),
        ])
      );
      continue;
    }
    const current = points[points.length - 1].value;
    const first = points[0].value;
    const allTimeChangePct = first > 0 ? ((current - first) / first) * 100 : 0;

    let valueDayAgo = current;
    for (const p of points) {
      if (p.ts <= dayAgo) valueDayAgo = p.value;
      else break;
    }
    const dayChangePct = valueDayAgo > 0 ? ((current - valueDayAgo) / valueDayAgo) * 100 : 0;
    const displayCurrent = metric.displayValue ? metric.displayValue(current) : current;

    statRow.appendChild(
      el("div", { class: "card", title: metric.label }, [
        el("div", { class: "stat-label" }, metric.shortLabel),
        el("div", { class: "stat-value" }, [
          el("span", { style: currency ? `color:${currency.color}` : "" }, displayCurrent.toFixed(2)),
          document.createTextNode(" " + metric.unitLabel),
        ]),
        el("div", { class: "muted", style: "margin-top:6px;font-size:11px;" }, [
          el("span", { class: signClass(dayChangePct) }, `${dayChangePct >= 0 ? "+" : ""}${fmtPct(dayChangePct)} 24h`),
          document.createTextNode("  ·  "),
          el("span", { class: signClass(allTimeChangePct) }, `${allTimeChangePct >= 0 ? "+" : ""}${fmtPct(allTimeChangePct)} all-time`),
        ]),
      ])
    );
  }
  container.appendChild(statRow);

  const chartPanel = el("div", { class: "panel" }, [
    el("div", { class: "panel-title" }, chartTitle),
    el("div", { class: "muted", style: "margin:-8px 0 14px;" }, description),
    el("div", { class: "chart-wrap" }, el("canvas", { id: canvasId })),
  ]);
  container.appendChild(chartPanel);

  destroyChart(chartKey);
  const chartableSeries = series.filter((s) => s.points.length > 1);
  if (chartableSeries.length === 0) {
    chartPanel.appendChild(el("div", { class: "empty-state" }, "Need at least two price pulls to chart a trend — check back after the next hourly run."));
    return;
  }

  const allTimes = [...new Set(chartableSeries.flatMap((s) => s.points.map((p) => p.ts)))].sort((a, b) => a - b);
  const ctx = document.getElementById(canvasId);
  charts[chartKey] = new Chart(ctx, {
    type: "line",
    data: {
      labels: allTimes.map((t) => fmtDate(t)),
      datasets: chartableSeries.map((s) => {
        const base = s.points[0].value;
        const byTs = new Map(s.points.map((p) => [p.ts, (p.value / base) * 100]));
        let last = null;
        return {
          label: s.metric.label,
          data: allTimes.map((t) => {
            if (byTs.has(t)) last = byTs.get(t);
            return last;
          }),
          borderColor: s.metric.chartColor,
          backgroundColor: s.metric.chartColor,
          fill: false,
          tension: 0.2,
          pointRadius: 0,
          spanGaps: true,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom", labels: { color: "#9089a8", font: { family: "JetBrains Mono" } } } },
      scales: {
        x: { ticks: { color: "#948aac", maxTicksLimit: 8, font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#1e1929" } },
        y: { ticks: { color: "#948aac", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#1e1929" } },
      },
    },
  });
}

export function renderInflation(container, { state }) {
  const { priceHistory, priceIndex, currencies } = state;
  const currencyById = Object.fromEntries(currencies.map((c) => [c.id, c]));

  container.appendChild(el("h1", { class: "page-title" }, "Inflation Index"));

  const times = [...new Set(priceHistory.map((r) => new Date(r.ts).getTime()))].sort((a, b) => a - b);
  const rows = times.map((t) => ({
    ts: t,
    mirror: priceAt(priceIndex, "mirror", t),
    hinekora: priceAt(priceIndex, "hinekora", t),
    omenLight: priceAt(priceIndex, "omen_light", t),
    omenWhittling: priceAt(priceIndex, "omen_whittling", t),
  }));

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const divineSeries = buildSeries(DIVINE_PRICE_METRICS, rows);
  const mirrorSeries = buildSeries(MIRROR_RATIO_METRICS, rows);

  if (divineSeries.every((s) => s.points.length === 0)) {
    container.appendChild(el("div", { class: "empty-state" }, "No price history yet — the hourly poe.ninja pull hasn't run, or these currencies aren't priced yet."));
    return;
  }

  container.appendChild(el("div", { class: "panel-title" }, "Divine Price"));
  renderSection(container, {
    series: divineSeries,
    dayAgo,
    currencyById,
    chartKey: "divine",
    canvasId: "inflation-chart-divine",
    chartTitle: "Divine Price (indexed to 100 at first pull)",
    description: "How many Divine each currency costs. Rising can mean it's genuinely more sought after — or just that Divine itself is inflating and everything costs more of it.",
  });

  container.appendChild(el("div", { class: "panel-title", style: "margin-top:8px;" }, "vs Mirror"));
  renderSection(container, {
    series: mirrorSeries,
    dayAgo,
    currencyById,
    chartKey: "mirror",
    canvasId: "inflation-chart-mirror",
    chartTitle: "Value vs Mirror (indexed to 100 at first pull)",
    description: "Each currency's value relative to Mirror of Kalandra — the hardest currency in the game to produce, and the closest thing to a supply that isn't constantly inflating. A flat or rising line means it's a genuine store of value, holding its own even if Divine is inflating underneath it. A falling line means it's losing real ground, not just standing still while Divine erodes.",
  });
}
