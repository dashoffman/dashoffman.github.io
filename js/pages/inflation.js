// Inflation index: tracks how many units of a "cheap" currency it takes to buy a
// "expensive" one over time, using the hourly poe.ninja pulls already sitting in
// price_history (all of it div-priced already, so ratios are just division —
// see scripts/fetch-prices.sh). Items priced against the mirror don't have a
// direct mirror-quoted feed, so — per the brief — we derive that ratio from each
// item's div price divided by the mirror's div price, same as everything else here.
import { priceAt } from "../ledgerMath.js";
import { fmtDate, fmtPct, signClass, el } from "../format.js";

const charts = {};

const METRICS = [
  {
    key: "exaltsPerDivine",
    label: "Exalted per Divine",
    shortLabel: "EX / DIV",
    unitLabel: "ex",
    currencyId: "divine",
    chartColor: "#c9a961",
    compute: (p) => (p.exalted > 0 ? 1 / p.exalted : null),
  },
  {
    key: "divinesPerMirror",
    label: "Divine per Mirror",
    shortLabel: "DIV / MIR",
    unitLabel: "div",
    currencyId: "mirror",
    chartColor: "#5aa9e6",
    compute: (p) => (p.mirror > 0 ? p.mirror : null),
  },
  {
    key: "hinekoraPerMirror",
    label: "Hinekora's Lock per Mirror",
    shortLabel: "HIN / MIR",
    unitLabel: "locks",
    currencyId: "hinekora",
    chartColor: "#b39ddb",
    compute: (p) => (p.mirror > 0 && p.hinekora > 0 ? p.mirror / p.hinekora : null),
  },
  {
    key: "omenPerMirror",
    label: "Omen of Light per Mirror",
    shortLabel: "OoL / MIR",
    unitLabel: "omens",
    currencyId: "omen_light",
    chartColor: "#e85d75",
    compute: (p) => (p.mirror > 0 && p.omen > 0 ? p.mirror / p.omen : null),
  },
];

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    delete charts[key];
  }
}

export function renderInflation(container, { state }) {
  const { priceHistory, priceIndex, currencies } = state;
  const currencyById = Object.fromEntries(currencies.map((c) => [c.id, c]));

  container.appendChild(el("h1", { class: "page-title" }, "Inflation Index"));

  const times = [...new Set(priceHistory.map((r) => new Date(r.ts).getTime()))].sort((a, b) => a - b);
  const rows = times.map((t) => ({
    ts: t,
    exalted: priceAt(priceIndex, "exalted", t),
    mirror: priceAt(priceIndex, "mirror", t),
    hinekora: priceAt(priceIndex, "hinekora", t),
    omen: priceAt(priceIndex, "omen_light", t),
  }));

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const series = METRICS.map((metric) => {
    const points = rows.map((r) => ({ ts: r.ts, value: metric.compute(r) })).filter((p) => p.value !== null && Number.isFinite(p.value) && p.value > 0);
    return { metric, points };
  });

  if (series.every((s) => s.points.length === 0)) {
    container.appendChild(el("div", { class: "empty-state" }, "No price history yet — the hourly poe.ninja pull hasn't run, or these currencies aren't priced yet."));
    return;
  }

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

    statRow.appendChild(
      el("div", { class: "card", title: metric.label }, [
        el("div", { class: "stat-label" }, metric.shortLabel),
        el("div", { class: "stat-value" }, [
          el("span", { style: currency ? `color:${currency.color}` : "" }, current.toFixed(2)),
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
    el("div", { class: "panel-title" }, "Relative Inflation (indexed to 100 at first pull)"),
    el("div", { class: "chart-wrap" }, el("canvas", { id: "inflation-chart" })),
  ]);
  container.appendChild(chartPanel);

  destroyChart("inflation");
  const chartableSeries = series.filter((s) => s.points.length > 1);
  if (chartableSeries.length === 0) {
    chartPanel.appendChild(el("div", { class: "empty-state" }, "Need at least two price pulls to chart a trend — check back after the next hourly run."));
    return;
  }

  const allTimes = [...new Set(chartableSeries.flatMap((s) => s.points.map((p) => p.ts)))].sort((a, b) => a - b);
  const ctx = document.getElementById("inflation-chart");
  charts.inflation = new Chart(ctx, {
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
