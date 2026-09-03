import { insertSplit } from "../db.js";
import { fmtDiv, fmtDate, el } from "../format.js";

export function renderSplits(container, { state, reload, showToast }) {
  const { members, splits } = state;

  container.appendChild(el("h1", { class: "page-title" }, "Splits"));

  // ---- New split form ----
  const form = el("div", { class: "panel" });
  form.appendChild(el("div", { class: "panel-title" }, "New Split"));

  const itemInput = el("input", { type: "text", placeholder: "e.g. Headhunter" });
  const priceInput = el("input", { type: "number", min: "0", step: "any", placeholder: "sale price (div-equivalent)" });
  const noteInput = el("input", { type: "text", placeholder: "optional" });

  form.appendChild(
    el("div", { class: "form-grid" }, [
      el("div", { class: "field" }, [el("label", {}, "Item Name"), itemInput]),
      el("div", { class: "field" }, [el("label", {}, "Sale Price (div)"), priceInput]),
      el("div", { class: "field" }, [el("label", {}, "Note"), noteInput]),
    ])
  );

  const checkWrap = el("div", { style: "display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;" });
  const checkboxes = {};
  for (const m of members) {
    const cb = el("input", { type: "checkbox", checked: "checked" });
    checkboxes[m.id] = cb;
    const label = el("label", { style: "display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim);cursor:pointer;" }, [cb, m.name]);
    checkWrap.appendChild(label);
  }
  form.appendChild(el("div", { class: "field" }, [el("label", {}, "Present Members"), checkWrap]));

  const submitBtn = el("button", { class: "btn btn-sm" }, "Record Split");
  submitBtn.addEventListener("click", async () => {
    const price = parseFloat(priceInput.value);
    const participantIds = members.filter((m) => checkboxes[m.id].checked).map((m) => m.id);

    if (!itemInput.value.trim()) {
      showToast("Enter an item name.", true);
      return;
    }
    if (!price || price <= 0) {
      showToast("Enter a sale price greater than 0.", true);
      return;
    }
    if (participantIds.length === 0) {
      showToast("Select at least one present member.", true);
      return;
    }

    submitBtn.disabled = true;
    try {
      await insertSplit({
        item_name: itemInput.value.trim(),
        sale_price_div: price,
        note: noteInput.value,
        participantIds,
      });
      itemInput.value = "";
      priceInput.value = "";
      noteInput.value = "";
      showToast("Split recorded.");
      await reload();
    } catch (err) {
      console.error(err);
      showToast("Failed to save split.", true);
      submitBtn.disabled = false;
    }
  });
  form.appendChild(submitBtn);
  container.appendChild(form);

  // ---- History ----
  const listPanel = el("div", { class: "panel" });
  listPanel.appendChild(el("div", { class: "panel-title" }, "Split History"));

  if (splits.length === 0) {
    listPanel.appendChild(el("div", { class: "empty-state" }, "No splits recorded yet."));
  } else {
    const memberById = Object.fromEntries(members.map((m) => [m.id, m]));
    const table = el("table");
    table.appendChild(
      el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Item"), el("th", {}, "Price"), el("th", {}, "Participants"), el("th", {}, "Per-Person Share")]))
    );
    const tbody = el("tbody");
    const sorted = [...splits].sort((a, b) => new Date(b.ts) - new Date(a.ts));
    for (const s of sorted) {
      const participants = s.split_participants || [];
      const share = participants.length > 0 ? Number(s.sale_price_div) / participants.length : 0;
      const namesCell = el("td", {}, participants.map((p) => memberById[p.member_id]?.name || p.member_id).join(", "));
      tbody.appendChild(
        el("tr", {}, [
          el("td", {}, fmtDate(new Date(s.ts).getTime())),
          el("td", {}, s.item_name),
          el("td", {}, fmtDiv(Number(s.sale_price_div))),
          namesCell,
          el("td", {}, fmtDiv(share)),
        ])
      );
    }
    table.appendChild(tbody);
    listPanel.appendChild(table);
  }
  container.appendChild(listPanel);
}
