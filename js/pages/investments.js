import { insertInvestment } from "../db.js";
import { currentState, priceAt, investmentReturns, portfolioInvestmentSeries } from "../ledgerMath.js";
import { fmtDiv, fmtQty, fmtPct, fmtDate, signClass, el } from "../format.js";

let perfChart = null;

export function renderInvestments(container, { state, reload, showToast }) {
  const { currencies, members, investments, events, priceIndex } = state;
  const now = Date.now();
  const snap = currentState(events, priceIndex);

  container.appendChild(el("h1", { class: "page-title" }, "Investments"));

  // ---- Affordability tracker ----
  const liquidCurrencies = currencies.filter((c) => c.category === "liquid");
  const investmentCurrencies = currencies.filter((c) => c.category === "investment");
  const liquidValue = liquidCurrencies.reduce((sum, c) => sum + (snap.holdings[c.id] || 0) * priceAt(priceIndex, c.id, now), 0);

  const affordPanel = el("div", { class: "panel" });
  affordPanel.appendChild(el("div", { class: "panel-title" }, `Affordability Tracker — ${fmtDiv(liquidValue)} liquid on hand`));
  for (const c of investmentCurrencies) {
    const price = priceAt(priceIndex, c.id, now);
    const row = el("div", { style: "margin-bottom:12px;" });
    if (price <= 0) {
      row.appendChild(
        el("div", { style: "display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim);" }, [
          el("span", {}, c.name),
          el("span", { class: "muted" }, "no live price yet"),
        ])
      );
    } else {
      const pct = Math.min(100, (liquidValue / price) * 100);
      row.appendChild(
        el("div", { style: "display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim);" }, [
          el("span", {}, `${c.name} (live price ${fmtDiv(price)})`),
          el("span", {}, fmtPct(pct)),
        ])
      );
      row.appendChild(el("div", { class: "progress-track" }, el("div", { class: "progress-fill", style: `width:${pct}%` })));
    }
    affordPanel.appendChild(row);
  }
  container.appendChild(affordPanel);

  // ---- Performance tracker: cost basis vs current market value ----
  const currencyById = Object.fromEntries(currencies.map((c) => [c.id, c]));
  const returns = investmentReturns(investments, priceIndex, now);

  const perfPanel = el("div", { class: "panel" });
  perfPanel.appendChild(el("div", { class: "panel-title" }, "Investment Performance"));

  if (investments.length === 0) {
    perfPanel.appendChild(el("div", { class: "empty-state" }, "No investments yet — performance shows up once a buy-in is recorded."));
  } else {
    perfPanel.appendChild(
      el("div", { class: "stat-row" }, [
        el("div", { class: "card" }, [el("div", { class: "stat-label" }, "Total Invested"), el("div", { class: "stat-value" }, fmtDiv(returns.totalCostBasis))]),
        el("div", { class: "card" }, [el("div", { class: "stat-label" }, "Current Value"), el("div", { class: "stat-value" }, fmtDiv(returns.totalCurrentValue))]),
        el("div", { class: "card" }, [
          el("div", { class: "stat-label" }, "Total Gain / Loss"),
          el("div", { class: "stat-value " + signClass(returns.totalGain) }, `${returns.totalGain >= 0 ? "+" : ""}${fmtDiv(returns.totalGain)}`),
          el("div", { class: "muted " + signClass(returns.totalGain), style: "margin-top:4px;" }, returns.totalReturnPct === null ? "—" : `${returns.totalReturnPct >= 0 ? "+" : ""}${fmtPct(returns.totalReturnPct)}`),
        ]),
      ])
    );

    const table = el("table");
    table.appendChild(
      el("thead", {}, el("tr", {}, [el("th", {}, "Item"), el("th", {}, "Qty"), el("th", {}, "Avg Cost"), el("th", {}, "Live Price"), el("th", {}, "Cost Basis"), el("th", {}, "Value Now"), el("th", {}, "Gain / Loss"), el("th", {}, "Return")]))
    );
    const tbody = el("tbody");
    for (const agg of returns.byCurrency) {
      const currency = currencyById[agg.currencyId];
      tbody.appendChild(
        el("tr", {}, [
          el("td", {}, [el("span", { class: "glyph", style: `color:${currency ? currency.color : "#fff"}` }, currency ? currency.glyph : "?"), el("span", { style: "margin-left:6px;" }, currency ? currency.name : agg.currencyId)]),
          el("td", {}, fmtQty(agg.qty)),
          el("td", {}, fmtDiv(agg.avgCost)),
          el("td", {}, agg.price > 0 ? fmtDiv(agg.price) : "no live price yet"),
          el("td", {}, fmtDiv(agg.costBasis)),
          el("td", {}, fmtDiv(agg.currentValue)),
          el("td", { class: signClass(agg.gain) }, `${agg.gain >= 0 ? "+" : ""}${fmtDiv(agg.gain)}`),
          el("td", { class: signClass(agg.gain) }, agg.returnPct === null ? "—" : `${agg.returnPct >= 0 ? "+" : ""}${fmtPct(agg.returnPct)}`),
        ])
      );
    }
    table.appendChild(tbody);
    perfPanel.appendChild(table);

    // ---- Cost basis vs market value chart, combined across all investment currencies ----
    const portfolioSeries = portfolioInvestmentSeries(investments, priceIndex);
    if (perfChart) {
      perfChart.destroy();
      perfChart = null;
    }
    if (portfolioSeries.length > 0) {
      perfPanel.appendChild(el("div", { class: "panel-title" }, "Cost Basis vs Market Value (All Investments)"));
      const canvas = el("canvas");
      perfPanel.appendChild(el("div", { class: "chart-wrap" }, canvas));

      perfChart = new Chart(canvas, {
        type: "line",
        data: {
          labels: portfolioSeries.map((p) => fmtDate(p.ts)),
          datasets: [
            { label: "Market Value", data: portfolioSeries.map((p) => p.marketValue), borderColor: "#c9a961", backgroundColor: "rgba(201,169,97,0.08)", fill: true, tension: 0.2, pointRadius: 0 },
            { label: "Cost Basis", data: portfolioSeries.map((p) => p.costBasis), borderColor: "#8b7fd6", borderDash: [5, 4], fill: false, tension: 0, pointRadius: 0, stepped: true },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { color: "#9089a8", font: { family: "JetBrains Mono", size: 10 } } } },
          scales: {
            x: { ticks: { color: "#948aac", maxTicksLimit: 8, font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#1e1929" } },
            y: { ticks: { color: "#948aac", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#1e1929" } },
          },
        },
      });
    }
  }
  container.appendChild(perfPanel);

  // ---- New investment form ----
  const formPanel = el("div", { class: "panel" });
  formPanel.appendChild(el("div", { class: "panel-title" }, "New Investment"));

  const currencySelect = el("select", {}, investmentCurrencies.map((c) => el("option", { value: c.id }, c.name)));
  const qtyInput = el("input", { type: "number", min: "0", step: "any", value: "1" });
  const costInput = el("input", { type: "number", min: "0", step: "any", placeholder: "total div cost" });
  const noteInput = el("input", { type: "text", placeholder: "optional" });

  formPanel.appendChild(
    el("div", { class: "form-grid" }, [
      el("div", { class: "field" }, [el("label", {}, "Item"), currencySelect]),
      el("div", { class: "field" }, [el("label", {}, "Qty"), qtyInput]),
      el("div", { class: "field" }, [el("label", {}, "Total Cost (div)"), costInput]),
      el("div", { class: "field" }, [el("label", {}, "Note"), noteInput]),
    ])
  );

  const contribWrap = el("div", { class: "form-grid", style: "grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));" });
  const contribInputs = {};
  for (const m of members) {
    const input = el("input", { type: "number", min: "0", step: "any", placeholder: "0.00" });
    contribInputs[m.id] = input;
    const myValue = (snap.units[m.id] || 0) * snap.vpu;
    contribWrap.appendChild(
      el("div", { class: "field" }, [
        el("label", {}, m.name + " contributes"),
        el("div", { class: "muted", style: "text-transform:none;letter-spacing:normal;margin:-4px 0 6px;" }, `has ${fmtDiv(myValue)}`),
        input,
      ])
    );
  }
  formPanel.appendChild(contribWrap);

  const sumHint = el("div", { class: "muted", style: "margin-bottom:12px;" });
  formPanel.appendChild(sumHint);

  function updateSumHint() {
    const total = parseFloat(costInput.value) || 0;
    const sum = Object.values(contribInputs).reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
    sumHint.textContent = `Contributions sum to ${fmtDiv(sum)} of ${fmtDiv(total)} total.`;
    sumHint.className = "muted " + (Math.abs(sum - total) < 0.0001 && total > 0 ? "pos" : "");
  }
  costInput.addEventListener("input", updateSumHint);
  Object.values(contribInputs).forEach((i) => i.addEventListener("input", updateSumHint));
  updateSumHint();

  const submitBtn = el("button", { class: "btn btn-sm" }, "Record Investment");
  submitBtn.addEventListener("click", async () => {
    const total = parseFloat(costInput.value);
    const qty = parseFloat(qtyInput.value) || 1;
    const contributions = members.map((m) => ({ memberId: m.id, amountDiv: parseFloat(contribInputs[m.id].value) || 0 }));
    const sum = contributions.reduce((s, c) => s + c.amountDiv, 0);

    if (!total || total <= 0) {
      showToast("Enter a total cost greater than 0.", true);
      return;
    }
    if (Math.abs(sum - total) > 0.01) {
      showToast("Contributions must sum to the total cost.", true);
      return;
    }

    submitBtn.disabled = true;
    try {
      await insertInvestment({
        currency_id: currencySelect.value,
        qty,
        total_cost_div: total,
        note: noteInput.value,
        contributions,
      });
      costInput.value = "";
      Object.values(contribInputs).forEach((i) => (i.value = ""));
      showToast("Investment recorded.");
      await reload();
    } catch (err) {
      console.error(err);
      showToast("Failed to save investment.", true);
      submitBtn.disabled = false;
    }
  });
  formPanel.appendChild(submitBtn);
  container.appendChild(formPanel);

  // ---- Existing investments list ----
  const listPanel = el("div", { class: "panel" });
  listPanel.appendChild(el("div", { class: "panel-title" }, "Pooled Buy-Ins"));

  if (investments.length === 0) {
    listPanel.appendChild(el("div", { class: "empty-state" }, "No investments yet."));
  } else {
    const memberById = Object.fromEntries(members.map((m) => [m.id, m]));
    const returnByInvestmentId = new Map(returns.perInvestment.map((r) => [r.investment.id, r]));
    const sorted = [...investments].sort((a, b) => new Date(b.ts) - new Date(a.ts));

    for (const inv of sorted) {
      const currency = currencyById[inv.currency_id];
      const perf = returnByInvestmentId.get(inv.id);
      const card = el("div", { class: "card", style: "margin-bottom:12px;" });
      card.appendChild(
        el("div", { style: "display:flex;justify-content:space-between;margin-bottom:8px;" }, [
          el("div", {}, [
            el("span", { class: "glyph", style: `color:${currency ? currency.color : "#fff"}` }, currency ? currency.glyph : "?"),
            el("span", { style: "margin-left:8px;font-weight:600;" }, `${currency ? currency.name : inv.currency_id} × ${fmtQty(Number(inv.qty))}`),
          ]),
          el("div", { class: "muted" }, `${fmtDate(new Date(inv.ts).getTime())} · ${fmtDiv(Number(inv.total_cost_div))}`),
        ])
      );
      if (perf && perf.price > 0) {
        card.appendChild(
          el("div", { class: "muted " + signClass(perf.gain), style: "margin-bottom:8px;font-size:12px;" }, `Now worth ${fmtDiv(perf.currentValue)} — ${perf.gain >= 0 ? "+" : ""}${fmtDiv(perf.gain)} (${perf.returnPct >= 0 ? "+" : ""}${fmtPct(perf.returnPct)})`)
        );
      }
      for (const c of inv.investment_contributions || []) {
        const member = memberById[c.member_id];
        const pct = Number(inv.total_cost_div) > 0 ? (Number(c.amount_div) / Number(inv.total_cost_div)) * 100 : 0;
        const row = el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;" });
        row.appendChild(el("span", { class: "chip", style: `background:${member ? member.color : "#888"}` }, member ? member.name[0] : "?"));
        row.appendChild(el("span", { style: "width:70px;" }, member ? member.name : c.member_id));
        row.appendChild(el("div", { class: "contrib-bar-track", style: "flex:1;" }, el("div", { style: `width:${pct}%;background:${member ? member.color : "#888"};` })));
        row.appendChild(el("span", { class: "muted" }, `${fmtDiv(Number(c.amount_div))} (${fmtPct(pct)})`));
        card.appendChild(row);
      }
      if (inv.note) card.appendChild(el("div", { class: "muted", style: "margin-top:6px;" }, inv.note));
      listPanel.appendChild(card);
    }
  }
  container.appendChild(listPanel);
}
