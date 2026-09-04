import { insertInvestment } from "../db.js";
import { currentState, priceAt } from "../ledgerMath.js";
import { fmtDiv, fmtPct, fmtDate, el } from "../format.js";

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

  const contribWrap = el("div", { class: "form-grid" });
  const contribInputs = {};
  for (const m of members) {
    const input = el("input", { type: "number", min: "0", step: "any", placeholder: "0.00" });
    contribInputs[m.id] = input;
    const myValue = (snap.units[m.id] || 0) * snap.vpu;
    contribWrap.appendChild(
      el("div", { class: "field" }, [
        el("label", {}, [m.name + " contributes ", el("span", { class: "muted" }, `(has ${fmtDiv(myValue)})`)]),
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
    const currencyById = Object.fromEntries(currencies.map((c) => [c.id, c]));
    const memberById = Object.fromEntries(members.map((m) => [m.id, m]));
    const sorted = [...investments].sort((a, b) => new Date(b.ts) - new Date(a.ts));

    for (const inv of sorted) {
      const currency = currencyById[inv.currency_id];
      const card = el("div", { class: "card", style: "margin-bottom:12px;" });
      card.appendChild(
        el("div", { style: "display:flex;justify-content:space-between;margin-bottom:8px;" }, [
          el("div", {}, [
            el("span", { class: "glyph", style: `color:${currency ? currency.color : "#fff"}` }, currency ? currency.glyph : "?"),
            el("span", { style: "margin-left:8px;font-weight:600;" }, currency ? currency.name : inv.currency_id),
          ]),
          el("div", { class: "muted" }, `${fmtDate(new Date(inv.ts).getTime())} · ${fmtDiv(Number(inv.total_cost_div))}`),
        ])
      );
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
