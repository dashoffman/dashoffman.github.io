import { insertSplit, markSplitSold } from "../db.js";
import { fmtDiv, fmtDate, el } from "../format.js";

let openSellRowId = null;

export function renderSplits(container, { state, reload, showToast }) {
  const { members, splits } = state;

  container.appendChild(el("h1", { class: "page-title" }, "Splits"));

  // ---- New split form ----
  const form = el("div", { class: "panel" });
  form.appendChild(el("div", { class: "panel-title" }, "New Split"));
  form.appendChild(
    el("div", { class: "muted", style: "margin-bottom:14px;" }, "Records the item as pending — it won't count toward the guild stash until you mark it sold.")
  );

  const itemInput = el("input", { type: "text", placeholder: "e.g. Headhunter" });
  const priceInput = el("input", { type: "number", min: "0", step: "any", placeholder: "asking price (div-equivalent)" });
  const noteInput = el("input", { type: "text", placeholder: "optional" });

  form.appendChild(
    el("div", { class: "form-grid" }, [
      el("div", { class: "field" }, [el("label", {}, "Item Name"), itemInput]),
      el("div", { class: "field" }, [el("label", {}, "Asking Price (div)"), priceInput]),
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

  const submitBtn = el("button", { class: "btn btn-sm" }, "Record Pending Split");
  submitBtn.addEventListener("click", async () => {
    const price = parseFloat(priceInput.value);
    const participantIds = members.filter((m) => checkboxes[m.id].checked).map((m) => m.id);

    if (!itemInput.value.trim()) {
      showToast("Enter an item name.", true);
      return;
    }
    if (!price || price <= 0) {
      showToast("Enter an asking price greater than 0.", true);
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
      showToast("Split recorded as pending.");
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
      el(
        "thead",
        {},
        el("tr", {}, [
          el("th", {}, "Date"),
          el("th", {}, "Item"),
          el("th", {}, "Status"),
          el("th", {}, "Price"),
          el("th", {}, "Participants"),
          el("th", {}, "Per-Person Share"),
          el("th", {}, ""),
        ])
      )
    );
    const tbody = el("tbody");
    const sorted = [...splits].sort((a, b) => new Date(b.ts) - new Date(a.ts));

    for (const s of sorted) {
      const participants = s.split_participants || [];
      const isSold = s.status === "sold";
      const effectivePrice = isSold && s.final_price_div !== null && s.final_price_div !== undefined ? Number(s.final_price_div) : Number(s.sale_price_div);
      const share = isSold && participants.length > 0 ? effectivePrice / participants.length : 0;
      const namesCell = el("td", {}, participants.map((p) => memberById[p.member_id]?.name || p.member_id).join(", "));

      const actionsTd = el("td");
      if (!isSold) {
        const sellBtn = el("button", { class: "btn btn-ghost btn-sm" }, "Mark Sold");
        sellBtn.addEventListener("click", () => {
          openSellRowId = openSellRowId === s.id ? null : s.id;
          renderList();
        });
        actionsTd.appendChild(sellBtn);
      }

      tbody.appendChild(
        el("tr", {}, [
          el("td", {}, fmtDate(new Date(s.ts).getTime())),
          el("td", {}, s.item_name),
          el("td", {}, el("span", { class: "pill " + (isSold ? "sold" : "pending") }, isSold ? "sold" : "pending")),
          el("td", {}, isSold ? fmtDiv(effectivePrice) : `${fmtDiv(Number(s.sale_price_div))} (asking)`),
          namesCell,
          el("td", {}, isSold ? fmtDiv(share) : "—"),
          actionsTd,
        ])
      );

      if (!isSold && openSellRowId === s.id) {
        const sellRow = el("tr");
        const sellTd = el("td", { colspan: "7" });
        const wrap = el("div", { style: "display:flex;align-items:flex-end;gap:10px;padding:8px 0;" });
        const overrideInput = el("input", {
          type: "number",
          min: "0",
          step: "any",
          placeholder: `leave blank for ${Number(s.sale_price_div)} div`,
          style: "width:220px;",
        });
        const confirmBtn = el("button", { class: "btn btn-sm" }, "Confirm Sale");
        const cancelBtn = el("button", { class: "btn btn-ghost btn-sm" }, "Cancel");
        confirmBtn.addEventListener("click", async () => {
          const override = overrideInput.value.trim();
          const finalPrice = override === "" ? null : parseFloat(override);
          if (override !== "" && (Number.isNaN(finalPrice) || finalPrice <= 0)) {
            showToast("Enter a valid sale price, or leave blank.", true);
            return;
          }
          confirmBtn.disabled = true;
          try {
            await markSplitSold(s.id, finalPrice);
            openSellRowId = null;
            showToast(`${s.item_name} marked sold.`);
            await reload();
          } catch (err) {
            console.error(err);
            showToast("Failed to mark split sold.", true);
            confirmBtn.disabled = false;
          }
        });
        cancelBtn.addEventListener("click", () => {
          openSellRowId = null;
          renderList();
        });
        wrap.appendChild(el("div", { class: "field", style: "margin-bottom:0;" }, [el("label", {}, "Final sale price (div), if different"), overrideInput]));
        wrap.appendChild(confirmBtn);
        wrap.appendChild(cancelBtn);
        sellTd.appendChild(wrap);
        sellRow.appendChild(sellTd);
        tbody.appendChild(sellRow);
      }
    }
    table.appendChild(tbody);
    listPanel.appendChild(table);
  }
  container.appendChild(listPanel);

  function renderList() {
    container.innerHTML = "";
    renderSplits(container, { state, reload, showToast });
  }
}
