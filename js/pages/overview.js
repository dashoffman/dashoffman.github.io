import { currentState, stashValueSeries, priceAt } from "../ledgerMath.js";
import { fmtDiv, fmtQty, fmtPct, fmtDate, signClass, el } from "../format.js";

const charts = {};

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    delete charts[key];
  }
}

export function renderOverview(container, { state }) {
  const { events, priceIndex, priceHistory, currencies, members } = state;
  const snap = currentState(events, priceIndex);
  const series = stashValueSeries(events, priceIndex, priceHistory);

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  let valueDayAgo = snap.value;
  for (const point of series) {
    if (point.ts <= dayAgo) valueDayAgo = point.value;
    else break;
  }
  const change = snap.value - valueDayAgo;
  const changePct = valueDayAgo > 0 ? (change / valueDayAgo) * 100 : 0;

  container.appendChild(
    el("h1", { class: "page-title" }, "Overview")
  );

  const statRow = el("div", { class: "stat-row" }, [
    el("div", { class: "card" }, [
      el("div", { class: "stat-label" }, "Total Stash Value"),
      el("div", { class: "stat-value" }, fmtDiv(snap.value)),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "stat-label" }, "24h Change"),
      el("div", { class: "stat-value " + signClass(change) }, `${change >= 0 ? "+" : ""}${fmtDiv(change)} (${changePct.toFixed(1)}%)`),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "stat-label" }, "Value / Unit"),
      el("div", { class: "stat-value" }, fmtDiv(snap.vpu, 4)),
    ]),
    el("div", { class: "card" }, [
      el("div", { class: "stat-label" }, "Total Units Outstanding"),
      el("div", { class: "stat-value" }, fmtQty(snap.totalUnits, 4)),
    ]),
  ]);
  container.appendChild(statRow);

  const twoCol = el("div", { class: "two-col" });
  const chartPanel = el("div", { class: "panel" }, [
    el("div", { class: "panel-title" }, "Stash Value Over Time"),
    el("div", { class: "chart-wrap" }, el("canvas", { id: "value-chart" })),
  ]);
  const piePanel = el("div", { class: "panel" }, [
    el("div", { class: "panel-title" }, "Ownership by Member"),
    el("div", { class: "chart-wrap small" }, el("canvas", { id: "ownership-chart" })),
  ]);
  twoCol.appendChild(chartPanel);
  twoCol.appendChild(piePanel);
  container.appendChild(twoCol);

  const holdingsPanel = el("div", { class: "panel" }, [
    el("div", { class: "panel-title" }, "Current Holdings"),
  ]);
  const table = el("table");
  table.appendChild(
    el("thead", {}, el("tr", {}, [el("th", {}, "Currency"), el("th", {}, "Qty"), el("th", {}, "Value"), el("th", {}, "% of Stash")]))
  );
  const tbody = el("tbody");
  const sortedCurrencies = [...currencies].filter((c) => (snap.holdings[c.id] || 0) > 0.0001);
  if (sortedCurrencies.length === 0) {
    holdingsPanel.appendChild(el("div", { class: "empty-state" }, "No holdings yet — record a deposit on the Ledger page."));
  } else {
    for (const c of sortedCurrencies) {
      const qty = snap.holdings[c.id] || 0;
      const value = qty * priceAt(priceIndex, c.id, now);
      const pct = snap.value > 0 ? (value / snap.value) * 100 : 0;
      const nameTd = el("td");
      const glyphSpan = el("span", { class: "glyph" }, c.glyph);
      glyphSpan.style.color = c.color;
      nameTd.appendChild(glyphSpan);
      nameTd.appendChild(document.createTextNode(" " + c.name));

      tbody.appendChild(
        el("tr", {}, [nameTd, el("td", {}, fmtQty(qty)), el("td", {}, fmtDiv(value)), el("td", {}, fmtPct(pct))])
      );
    }
    table.appendChild(tbody);
    holdingsPanel.appendChild(table);
  }
  container.appendChild(holdingsPanel);

  // Charts
  destroyChart("value");
  destroyChart("ownership");

  const ctxValue = document.getElementById("value-chart");
  if (series.length > 0) {
    charts.value = new Chart(ctxValue, {
      type: "line",
      data: {
        labels: series.map((p) => fmtDate(p.ts)),
        datasets: [
          {
            label: "Stash Value (div)",
            data: series.map((p) => p.value),
            borderColor: "#c9a961",
            backgroundColor: "rgba(201,169,97,0.12)",
            fill: true,
            tension: 0.25,
            pointRadius: 0,
          },
        ],
      },
      options: chartOptions(),
    });
  }

  const ctxPie = document.getElementById("ownership-chart");
  const memberEntries = members.map((m) => ({ m, units: snap.units[m.id] || 0 })).filter((e) => e.units > 0.0001);
  if (memberEntries.length > 0) {
    charts.ownership = new Chart(ctxPie, {
      type: "doughnut",
      data: {
        labels: memberEntries.map((e) => e.m.name),
        datasets: [
          {
            data: memberEntries.map((e) => e.units),
            backgroundColor: memberEntries.map((e) => e.m.color),
            borderColor: "#15111f",
            borderWidth: 2,
          },
        ],
      },
      options: {
        plugins: { legend: { position: "bottom", labels: { color: "#9089a8", font: { family: "JetBrains Mono" } } } },
      },
    });
  } else {
    piePanel.appendChild(el("div", { class: "empty-state" }, "No units issued yet."));
  }
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: "#675e7d", maxTicksLimit: 8, font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#1e1929" } },
      y: { ticks: { color: "#675e7d", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#1e1929" } },
    },
  };
}
