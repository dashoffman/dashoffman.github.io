import { insertTransaction } from "../db.js";
import { fmtQty, fmtDate, el } from "../format.js";

export function renderLedger(container, { state, reload, showToast }) {
  const { currencies, members, transactions, loggedInMemberId } = state;

  container.appendChild(el("h1", { class: "page-title" }, "Ledger"));

  // ---- New transaction form ----
  const form = el("div", { class: "panel" });
  form.appendChild(el("div", { class: "panel-title" }, "Record Deposit / Withdrawal"));

  const currencySelect = el("select", {}, currencies.map((c) => el("option", { value: c.id }, c.name)));
  const typeSelect = el("select", {}, [el("option", { value: "deposit" }, "Deposit"), el("option", { value: "withdrawal" }, "Withdrawal")]);
  const qtyInput = el("input", { type: "number", min: "0", step: "any", placeholder: "0.00" });
  const noteInput = el("input", { type: "text", placeholder: "optional" });

  const grid = el("div", { class: "form-grid" }, [
    el("div", { class: "field" }, [el("label", {}, "Currency"), currencySelect]),
    el("div", { class: "field" }, [el("label", {}, "Type"), typeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Quantity"), qtyInput]),
    el("div", { class: "field" }, [el("label", {}, "Note"), noteInput]),
  ]);
  form.appendChild(grid);

  const submitBtn = el("button", { class: "btn btn-sm" }, "Add Entry");
  submitBtn.addEventListener("click", async () => {
    const qty = parseFloat(qtyInput.value);
    if (!qty || qty <= 0) {
      showToast("Enter a quantity greater than 0.", true);
      return;
    }
    submitBtn.disabled = true;
    try {
      await insertTransaction({
        member_id: loggedInMemberId,
        currency_id: currencySelect.value,
        qty,
        type: typeSelect.value,
        note: noteInput.value,
      });
      qtyInput.value = "";
      noteInput.value = "";
      showToast("Entry recorded.");
      await reload();
    } catch (err) {
      console.error(err);
      showToast("Failed to save entry.", true);
      submitBtn.disabled = false;
    }
  });
  form.appendChild(submitBtn);
  container.appendChild(form);

  // ---- History + filters ----
  const historyPanel = el("div", { class: "panel" });
  historyPanel.appendChild(el("div", { class: "panel-title" }, "Transaction History"));

  const memberFilter = el("select", {}, [
    el("option", { value: "all" }, "All members"),
    ...members.map((m) => el("option", { value: m.id }, m.name)),
  ]);
  const currencyFilter = el("select", {}, [
    el("option", { value: "all" }, "All currencies"),
    ...currencies.map((c) => el("option", { value: c.id }, c.name)),
  ]);
  const typeFilter = el("select", {}, [
    el("option", { value: "all" }, "All types"),
    el("option", { value: "deposit" }, "Deposits"),
    el("option", { value: "withdrawal" }, "Withdrawals"),
  ]);
  const filters = el("div", { class: "filters" }, [memberFilter, currencyFilter, typeFilter]);
  historyPanel.appendChild(filters);

  const tableWrap = el("div");
  historyPanel.appendChild(tableWrap);
  container.appendChild(historyPanel);

  function renderTable() {
    tableWrap.innerHTML = "";
    const memberById = Object.fromEntries(members.map((m) => [m.id, m]));
    const currencyById = Object.fromEntries(currencies.map((c) => [c.id, c]));

    const rows = transactions
      .filter((t) => memberFilter.value === "all" || t.member_id === memberFilter.value)
      .filter((t) => currencyFilter.value === "all" || t.currency_id === currencyFilter.value)
      .filter((t) => typeFilter.value === "all" || t.type === typeFilter.value)
      .sort((a, b) => new Date(b.ts) - new Date(a.ts));

    if (rows.length === 0) {
      tableWrap.appendChild(el("div", { class: "empty-state" }, "No transactions match these filters."));
      return;
    }

    const table = el("table");
    table.appendChild(
      el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Member"), el("th", {}, "Currency"), el("th", {}, "Qty"), el("th", {}, "Type"), el("th", {}, "Note")]))
    );
    const tbody = el("tbody");
    for (const t of rows) {
      const member = memberById[t.member_id];
      const currency = currencyById[t.currency_id];
      tbody.appendChild(
        el("tr", {}, [
          el("td", {}, fmtDate(new Date(t.ts).getTime())),
          el("td", {}, member ? member.name : t.member_id),
          el("td", {}, currency ? currency.name : t.currency_id),
          el("td", {}, fmtQty(Number(t.qty))),
          el("td", {}, el("span", { class: "pill " + t.type }, t.type)),
          el("td", {}, t.note || ""),
        ])
      );
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  [memberFilter, currencyFilter, typeFilter].forEach((f) => f.addEventListener("change", renderTable));
  renderTable();
}
