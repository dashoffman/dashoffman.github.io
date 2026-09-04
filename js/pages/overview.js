import { currentState, stashValueSeries, holdingsAt, priceAt } from "../ledgerMath.js";
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

  // How much of the 24h change came from investment currencies (Mirror, Hinekora's
  // Lock, Omens) appreciating/depreciating, isolated from everything else (liquid
  // price movement, deposits/withdrawals, new buy-ins) — same qty-frozen approach as
  // memberValueSeries' "market-only" line, so a fresh buy-in doesn't get counted as gain.
  const investmentCurrencyIds = new Set(currencies.filter((c) => c.category === "investment").map((c) => c.id));
  const holdingsDayAgo = holdingsAt(events, priceIndex, dayAgo);
  let investmentChange = 0;
  for (const currencyId of investmentCurrencyIds) {
    const qtyDayAgo = holdingsDayAgo[currencyId] || 0;
    if (qtyDayAgo === 0) continue;
    investmentChange += qtyDayAgo * (priceAt(priceIndex, currencyId, now) - priceAt(priceIndex, currencyId, dayAgo));
  }
  const otherChange = change - investmentChange;

  container.appendChild(
    el("h1", { class: "page-title" }, "Overview")
  );

  const changeCardChildren = [
    el("div", { class: "stat-label" }, "24h Change"),
    el("div", { class: "stat-value " + signClass(change) }, `${change >= 0 ? "+" : ""}${fmtDiv(change)} (${changePct.toFixed(1)}%)`),
  ];
  if (investmentChange !== 0) {
    changeCardChildren.push(
      el("div", { class: "muted", style: "margin-top:6px;" }, [
        el("span", { class: signClass(investmentChange) }, `${investmentChange >= 0 ? "+" : ""}${fmtDiv(investmentChange)} investments`),
        document.createTextNode("  ·  "),
        el("span", { class: signClass(otherChange) }, `${otherChange >= 0 ? "+" : ""}${fmtDiv(otherChange)} other`),
      ])
    );
  }

  const statRow = el("div", { class: "stat-row" }, [
    el("div", { class: "card" }, [
      el("div", { class: "stat-label" }, "Total Stash Value"),
      el("div", { class: "stat-value" }, fmtDiv(snap.value)),
    ]),
    el("div", { class: "card" }, changeCardChildren),
  ]);
  container.appendChild(statRow);

  const chartPanel = el("div", { class: "panel" }, [
    el("div", { class: "panel-title" }, "Stash Value Over Time"),
    el("div", { class: "chart-wrap" }, el("canvas", { id: "value-chart" })),
  ]);
  container.appendChild(chartPanel);

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

  const ownershipPanel = el("div", { class: "panel" });
  ownershipPanel.appendChild(el("div", { class: "panel-title" }, "Ownership by Member"));
  const ownershipLayout = el("div", { style: "display:flex;gap:36px;align-items:center;flex-wrap:wrap;" });
  const pieWrap = el("div", { class: "chart-wrap", style: "height:240px;width:240px;flex-shrink:0;" }, el("canvas", { id: "ownership-chart" }));
  const memberList = el("div", { style: "flex:1;min-width:240px;" });
  ownershipLayout.appendChild(pieWrap);
  ownershipLayout.appendChild(memberList);
  ownershipPanel.appendChild(ownershipLayout);
  container.appendChild(ownershipPanel);

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
  const memberEntries = members
    .map((m) => ({ m, value: (snap.units[m.id] || 0) * snap.vpu }))
    .filter((e) => e.value > 0.0001)
    .sort((a, b) => b.value - a.value);

  if (memberEntries.length > 0) {
    charts.ownership = new Chart(ctxPie, {
      type: "doughnut",
      data: {
        labels: memberEntries.map((e) => e.m.name),
        datasets: [
          {
            data: memberEntries.map((e) => e.value),
            backgroundColor: memberEntries.map((e) => e.m.color),
            borderColor: "#15111f",
            borderWidth: 2,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtDiv(ctx.parsed)}` } },
        },
      },
    });

    for (const e of memberEntries) {
      const pct = snap.value > 0 ? (e.value / snap.value) * 100 : 0;
      memberList.appendChild(
        el("div", { style: "display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #1e1929;" }, [
          el("div", { style: "display:flex;align-items:center;gap:12px;" }, [
            el("span", { class: "chip", style: `background:${e.m.color};width:28px;height:28px;font-size:13px;` }, e.m.name[0]),
            el("span", { style: "font-weight:600;font-size:15px;" }, e.m.name),
          ]),
          el("div", { style: "text-align:right;" }, [
            el("div", { style: "font-weight:700;font-size:16px;color:var(--gold-bright);" }, fmtDiv(e.value)),
            el("div", { class: "muted" }, `${fmtPct(pct)} of stash`),
          ]),
        ])
      );
    }
    memberList.lastChild.style.borderBottom = "none";
  } else {
    ownershipLayout.remove();
    ownershipPanel.appendChild(el("div", { class: "empty-state" }, "No ownership recorded yet."));
  }
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: "#948aac", maxTicksLimit: 8, font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#1e1929" } },
      y: { ticks: { color: "#948aac", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#1e1929" } },
    },
  };
}
