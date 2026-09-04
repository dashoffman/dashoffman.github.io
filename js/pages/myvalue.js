import { currentState, memberValueSeries } from "../ledgerMath.js";
import { fmtDiv, fmtPct, fmtDate, el } from "../format.js";

let chart = null;

export function renderMyValue(container, { state }) {
  const { events, priceIndex, priceHistory, currencies, members, transactions, splits, investments, loggedInMemberId } = state;
  const me = members.find((m) => m.id === loggedInMemberId);
  const snap = currentState(events, priceIndex);
  const myUnits = snap.units[loggedInMemberId] || 0;
  const myValue = myUnits * snap.vpu;

  container.appendChild(el("h1", { class: "page-title" }, `My Value — ${me ? me.name : loggedInMemberId}`));

  container.appendChild(
    el("div", { class: "stat-row" }, [
      el("div", { class: "card" }, [el("div", { class: "stat-label" }, "Current Value"), el("div", { class: "stat-value" }, fmtDiv(myValue))]),
      el("div", { class: "card" }, [
        el("div", { class: "stat-label" }, "Share of Stash"),
        el("div", { class: "stat-value" }, fmtPct(snap.totalUnits > 0 ? (myUnits / snap.totalUnits) * 100 : 0)),
      ]),
    ])
  );

  // ---- Value vs market-only chart ----
  const chartPanel = el("div", { class: "panel" });
  const header = el("div", { class: "section-actions" }, [
    el("div", { class: "panel-title", style: "margin-bottom:0;" }, "Value Over Time"),
  ]);
  const sinceLabel = el("label", { class: "muted" }, "Compare against no activity since: ");
  const sinceInput = el("input", { type: "date" });
  const defaultSince = transactions
    .filter((t) => t.member_id === loggedInMemberId)
    .concat(
      investments.flatMap((inv) => (inv.investment_contributions || []).some((c) => c.member_id === loggedInMemberId) ? [inv] : [])
    )
    .sort((a, b) => new Date(a.ts) - new Date(b.ts))[0];
  sinceInput.value = defaultSince ? new Date(defaultSince.ts).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  header.appendChild(el("div", {}, [sinceLabel, sinceInput]));
  chartPanel.appendChild(header);
  chartPanel.appendChild(el("div", { class: "chart-wrap" }, el("canvas", { id: "myvalue-chart" })));
  container.appendChild(chartPanel);

  function drawChart() {
    const sinceTs = sinceInput.value ? new Date(sinceInput.value).getTime() : null;
    const series = memberValueSeries(events, priceIndex, priceHistory, loggedInMemberId, sinceTs);
    if (chart) chart.destroy();
    const ctx = document.getElementById("myvalue-chart");
    if (series.length === 0) return;
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: series.map((p) => fmtDate(p.ts)),
        datasets: [
          { label: "Actual", data: series.map((p) => p.actual), borderColor: "#c9a961", backgroundColor: "rgba(201,169,97,0.08)", fill: false, tension: 0.25, pointRadius: 0 },
          { label: "Market-only (no activity since)", data: series.map((p) => p.marketOnly), borderColor: "#8b7fd6", borderDash: [5, 4], fill: false, tension: 0.25, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { color: "#9089a8", font: { family: "JetBrains Mono", size: 10 } } } },
        scales: {
          x: { ticks: { color: "#675e7d", maxTicksLimit: 8, font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#1e1929" } },
          y: { ticks: { color: "#675e7d", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#1e1929" } },
        },
      },
    });
  }
  sinceInput.addEventListener("change", drawChart);
  drawChart();

  // ---- Contribution history ----
  const historyPanel = el("div", { class: "panel" });
  historyPanel.appendChild(el("div", { class: "panel-title" }, "My Contribution History"));

  const currencyById = Object.fromEntries(currencies.map((c) => [c.id, c]));
  const myEvents = [];
  for (const t of transactions.filter((t) => t.member_id === loggedInMemberId)) {
    myEvents.push({ ts: new Date(t.ts).getTime(), kind: t.type, desc: `${currencyById[t.currency_id]?.name || t.currency_id} × ${t.qty}` });
  }
  for (const inv of investments) {
    const c = (inv.investment_contributions || []).find((c) => c.member_id === loggedInMemberId);
    if (c && Number(c.amount_div) > 0) {
      myEvents.push({ ts: new Date(inv.ts).getTime(), kind: "investment", desc: `${currencyById[inv.currency_id]?.name || inv.currency_id} — contributed ${fmtDiv(Number(c.amount_div))}` });
    }
  }
  for (const s of splits) {
    const participants = s.split_participants || [];
    if (participants.some((p) => p.member_id === loggedInMemberId)) {
      if (s.status === "sold") {
        const effectivePrice = s.final_price_div !== null && s.final_price_div !== undefined ? Number(s.final_price_div) : Number(s.sale_price_div);
        const share = participants.length > 0 ? effectivePrice / participants.length : 0;
        myEvents.push({ ts: new Date(s.sold_ts).getTime(), kind: "split", desc: `${s.item_name} — share ${fmtDiv(share)}` });
      } else {
        myEvents.push({ ts: new Date(s.ts).getTime(), kind: "pending", desc: `${s.item_name} — pending sale, not yet counted` });
      }
    }
  }
  myEvents.sort((a, b) => b.ts - a.ts);

  if (myEvents.length === 0) {
    historyPanel.appendChild(el("div", { class: "empty-state" }, "No activity yet."));
  } else {
    const table = el("table");
    table.appendChild(el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Type"), el("th", {}, "Detail")])));
    const tbody = el("tbody");
    for (const e of myEvents) {
      const pillClass = e.kind === "withdrawal" ? "withdrawal" : e.kind === "pending" ? "pending" : "deposit";
      tbody.appendChild(
        el("tr", {}, [el("td", {}, fmtDate(e.ts)), el("td", {}, el("span", { class: "pill " + pillClass }, e.kind)), el("td", {}, e.desc)])
      );
    }
    table.appendChild(tbody);
    historyPanel.appendChild(table);
  }
  container.appendChild(historyPanel);

  // ---- My investment stakes ----
  const stakesPanel = el("div", { class: "panel" });
  stakesPanel.appendChild(el("div", { class: "panel-title" }, "My Investment Stakes"));
  const myStakes = investments
    .map((inv) => {
      const c = (inv.investment_contributions || []).find((c) => c.member_id === loggedInMemberId);
      if (!c || Number(c.amount_div) <= 0) return null;
      const currency = currencyById[inv.currency_id];
      const pct = Number(inv.total_cost_div) > 0 ? (Number(c.amount_div) / Number(inv.total_cost_div)) * 100 : 0;
      return { currency, amount: Number(c.amount_div), pct };
    })
    .filter(Boolean);

  if (myStakes.length === 0) {
    stakesPanel.appendChild(el("div", { class: "empty-state" }, "No investment stakes yet."));
  } else {
    for (const stake of myStakes) {
      const row = el("div", { style: "display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1e1929;" }, [
        el("div", {}, [el("span", { class: "glyph", style: `color:${stake.currency?.color || "#fff"}` }, stake.currency?.glyph || "?"), el("span", { style: "margin-left:8px;" }, stake.currency?.name || "?")]),
        el("div", { class: "muted" }, `${fmtDiv(stake.amount)} · ${fmtPct(stake.pct)} ownership`),
      ]);
      stakesPanel.appendChild(row);
    }
  }
  container.appendChild(stakesPanel);
}
