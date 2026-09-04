// Unitized (mutual-fund style) NAV engine.
//
// Single source of truth = the raw event log (transactions, investments, splits) +
// the hourly price_history series. Everything else (unit counts, value-per-unit,
// per-member value, holdings at any point in time) is derived by replaying events
// in chronological order. Nothing derived is ever stored in the database, so there's
// no risk of stored state drifting out of sync with the ledger.
//
// Documented assumptions (ambiguous in the brief, resolved here for a working build):
//   - Investment buy-ins are funded out of the stash's Divine Orb holdings (i.e. the
//     guild is assumed to convert everything to Divine before an investment purchase).
//   - Split sale proceeds land in the stash as Divine Orb.
//   - A split only becomes an event once marked 'sold' — a 'pending' split (just an
//     asking price, no buyer yet) has no effect on holdings/units. The event fires at
//     sold_ts (when the money actually arrived), not the split's original ts, and uses
//     final_price_div if the seller entered one at sale time, else the asking price.

export const BASE_CURRENCY = "divine";

/** Build a flat, chronologically-sorted event list from the raw tables. */
export function buildEvents({ transactions, investments, splits }) {
  const events = [];

  for (const t of transactions) {
    events.push({
      ts: new Date(t.ts).getTime(),
      kind: t.type, // 'deposit' | 'withdrawal'
      memberId: t.member_id,
      currencyId: t.currency_id,
      qty: Number(t.qty),
      ref: t,
    });
  }

  for (const inv of investments) {
    events.push({
      ts: new Date(inv.ts).getTime(),
      kind: "investment_buy",
      currencyId: inv.currency_id,
      qty: Number(inv.qty),
      totalCostDiv: Number(inv.total_cost_div),
      contributions: (inv.investment_contributions || []).map((c) => ({
        memberId: c.member_id,
        amountDiv: Number(c.amount_div),
      })),
      ref: inv,
    });
  }

  for (const s of splits) {
    if (s.status !== "sold") continue;
    const effectivePrice = s.final_price_div !== null && s.final_price_div !== undefined ? Number(s.final_price_div) : Number(s.sale_price_div);
    events.push({
      ts: new Date(s.sold_ts).getTime(),
      kind: "split",
      salePriceDiv: effectivePrice,
      participantIds: (s.split_participants || []).map((p) => p.member_id),
      ref: s,
    });
  }

  events.sort((a, b) => a.ts - b.ts);
  return events;
}

/** Index price_history rows by currency for fast lookup, sorted ascending by ts. */
export function indexPriceHistory(priceHistory) {
  const byCurrency = new Map();
  for (const row of priceHistory) {
    const list = byCurrency.get(row.currency_id) || [];
    list.push({ ts: new Date(row.ts).getTime(), price: Number(row.div_price) });
    byCurrency.set(row.currency_id, list);
  }
  for (const list of byCurrency.values()) list.sort((a, b) => a.ts - b.ts);
  return byCurrency;
}

/** Price of a currency at time t (ms epoch): step-interpolated from the last known
 *  price at-or-before t, falling back to the earliest known price if t precedes all
 *  history (keeps brand-new leagues with thin history from breaking the chart). */
export function priceAt(priceIndex, currencyId, t) {
  if (currencyId === BASE_CURRENCY) return 1;
  const list = priceIndex.get(currencyId);
  if (!list || list.length === 0) return 0;
  let lo = 0,
    hi = list.length - 1,
    ans = list[0];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].ts <= t) {
      ans = list[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans.price;
}

export function stashValue(holdings, priceIndex, t) {
  let total = 0;
  for (const [currencyId, qty] of Object.entries(holdings)) {
    total += qty * priceAt(priceIndex, currencyId, t);
  }
  return total;
}

/**
 * Replay every event in order, calling onStep(state, event) after each one so callers
 * can sample intermediate state (e.g. for a time-series chart) without re-running the
 * whole simulation per data point.
 */
export function replay(events, priceIndex, onStep) {
  const holdings = {}; // currencyId -> qty
  const units = {}; // memberId -> unit count
  let totalUnits = 0;

  const addHolding = (currencyId, delta) => {
    holdings[currencyId] = (holdings[currencyId] || 0) + delta;
  };
  const creditUnits = (memberId, unitDelta) => {
    units[memberId] = (units[memberId] || 0) + unitDelta;
    totalUnits += unitDelta;
  };

  for (const ev of events) {
    const valueBefore = stashValue(holdings, priceIndex, ev.ts);
    const vpu = totalUnits > 0 ? valueBefore / totalUnits : 1;

    if (ev.kind === "deposit") {
      const value = ev.qty * priceAt(priceIndex, ev.currencyId, ev.ts);
      addHolding(ev.currencyId, ev.qty);
      creditUnits(ev.memberId, vpu > 0 ? value / vpu : value);
    } else if (ev.kind === "withdrawal") {
      const value = ev.qty * priceAt(priceIndex, ev.currencyId, ev.ts);
      addHolding(ev.currencyId, -ev.qty);
      creditUnits(ev.memberId, vpu > 0 ? -(value / vpu) : -value);
    } else if (ev.kind === "investment_buy") {
      for (const c of ev.contributions) {
        if (c.amountDiv <= 0) continue;
        creditUnits(c.memberId, vpu > 0 ? c.amountDiv / vpu : c.amountDiv);
      }
      addHolding(BASE_CURRENCY, -ev.totalCostDiv);
      addHolding(ev.currencyId, ev.qty);
    } else if (ev.kind === "split") {
      addHolding(BASE_CURRENCY, ev.salePriceDiv);
      const totalUnitsCredited = vpu > 0 ? ev.salePriceDiv / vpu : ev.salePriceDiv;
      const n = ev.participantIds.length || 1;
      const perMember = totalUnitsCredited / n;
      for (const memberId of ev.participantIds) creditUnits(memberId, perMember);
    }

    if (onStep) {
      onStep(
        {
          holdings: { ...holdings },
          units: { ...units },
          totalUnits,
          ts: ev.ts,
        },
        ev
      );
    }
  }

  return { holdings, units, totalUnits };
}

/** Current snapshot: holdings, per-member units, total units, value-per-unit "now". */
export function currentState(events, priceIndex, now = Date.now()) {
  const { holdings, units, totalUnits } = replay(events, priceIndex, null);
  const value = stashValue(holdings, priceIndex, now);
  const vpu = totalUnits > 0 ? value / totalUnits : 0;
  return { holdings, units, totalUnits, value, vpu, now };
}

/** Holdings as of a past timestamp — only events up to and including t have happened yet. */
export function holdingsAt(events, priceIndex, t) {
  return replay(
    events.filter((e) => e.ts <= t),
    priceIndex,
    null
  ).holdings;
}

/**
 * Stash value over time, sampled at every price_history timestamp (plus every event
 * timestamp, so step changes from deposits/investments/splits show immediately).
 */
export function stashValueSeries(events, priceIndex, priceHistory) {
  const sampleTimes = new Set(priceHistory.map((r) => new Date(r.ts).getTime()));
  for (const ev of events) sampleTimes.add(ev.ts);
  const times = [...sampleTimes].sort((a, b) => a - b);

  const holdings = {};
  let evIdx = 0;
  const series = [];

  for (const t of times) {
    while (evIdx < events.length && events[evIdx].ts <= t) {
      const ev = events[evIdx];
      if (ev.kind === "deposit") holdings[ev.currencyId] = (holdings[ev.currencyId] || 0) + ev.qty;
      else if (ev.kind === "withdrawal") holdings[ev.currencyId] = (holdings[ev.currencyId] || 0) - ev.qty;
      else if (ev.kind === "investment_buy") {
        holdings[BASE_CURRENCY] = (holdings[BASE_CURRENCY] || 0) - ev.totalCostDiv;
        holdings[ev.currencyId] = (holdings[ev.currencyId] || 0) + ev.qty;
      } else if (ev.kind === "split") {
        holdings[BASE_CURRENCY] = (holdings[BASE_CURRENCY] || 0) + ev.salePriceDiv;
      }
      evIdx++;
    }
    series.push({ ts: t, value: stashValue(holdings, priceIndex, t) });
  }

  return series;
}

/**
 * A member's value over time, plus a "market-only" counterfactual: unit count frozen
 * at its value on `sinceTs`, carried forward at the (global) value-per-unit — isolating
 * pure market movement from the member's own deposit/withdrawal activity.
 */
export function memberValueSeries(events, priceIndex, priceHistory, memberId, sinceTs) {
  const sampleTimes = new Set(priceHistory.map((r) => new Date(r.ts).getTime()));
  for (const ev of events) sampleTimes.add(ev.ts);
  if (sinceTs) sampleTimes.add(sinceTs);
  const times = [...sampleTimes].sort((a, b) => a - b);

  const holdings = {};
  const units = {};
  let totalUnits = 0;
  let evIdx = 0;
  let frozenUnits = null;

  const series = [];
  for (const t of times) {
    while (evIdx < events.length && events[evIdx].ts <= t) {
      const ev = events[evIdx];
      const valueBefore = stashValue(holdings, priceIndex, ev.ts);
      const vpu = totalUnits > 0 ? valueBefore / totalUnits : 1;

      if (ev.kind === "deposit") {
        const value = ev.qty * priceAt(priceIndex, ev.currencyId, ev.ts);
        holdings[ev.currencyId] = (holdings[ev.currencyId] || 0) + ev.qty;
        const d = vpu > 0 ? value / vpu : value;
        units[ev.memberId] = (units[ev.memberId] || 0) + d;
        totalUnits += d;
      } else if (ev.kind === "withdrawal") {
        const value = ev.qty * priceAt(priceIndex, ev.currencyId, ev.ts);
        holdings[ev.currencyId] = (holdings[ev.currencyId] || 0) - ev.qty;
        const d = vpu > 0 ? value / vpu : value;
        units[ev.memberId] = (units[ev.memberId] || 0) - d;
        totalUnits -= d;
      } else if (ev.kind === "investment_buy") {
        for (const c of ev.contributions) {
          if (c.amountDiv <= 0) continue;
          const d = vpu > 0 ? c.amountDiv / vpu : c.amountDiv;
          units[c.memberId] = (units[c.memberId] || 0) + d;
          totalUnits += d;
        }
        holdings[BASE_CURRENCY] = (holdings[BASE_CURRENCY] || 0) - ev.totalCostDiv;
        holdings[ev.currencyId] = (holdings[ev.currencyId] || 0) + ev.qty;
      } else if (ev.kind === "split") {
        holdings[BASE_CURRENCY] = (holdings[BASE_CURRENCY] || 0) + ev.salePriceDiv;
        const totalCredited = vpu > 0 ? ev.salePriceDiv / vpu : ev.salePriceDiv;
        const n = ev.participantIds.length || 1;
        const per = totalCredited / n;
        for (const mId of ev.participantIds) {
          units[mId] = (units[mId] || 0) + per;
          totalUnits += per;
        }
      }
      evIdx++;
    }

    const value = stashValue(holdings, priceIndex, t);
    const vpuNow = totalUnits > 0 ? value / totalUnits : 0;
    const myUnits = units[memberId] || 0;

    if (sinceTs && frozenUnits === null && t >= sinceTs) frozenUnits = myUnits;

    series.push({
      ts: t,
      actual: myUnits * vpuNow,
      marketOnly: sinceTs && frozenUnits !== null ? frozenUnits * vpuNow : null,
    });
  }

  return series;
}

/**
 * Investment performance: cost basis (total_cost_div at buy time) vs current market
 * value (qty * priceAt(now)) for every pooled buy-in, plus aggregated per currency
 * (multiple buy-ins of the same investment currency at different prices share one
 * cost-basis pool) and a portfolio-wide total.
 */
export function investmentReturns(investments, priceIndex, now = Date.now()) {
  const perInvestment = investments.map((inv) => {
    const currencyId = inv.currency_id;
    const qty = Number(inv.qty);
    const costBasis = Number(inv.total_cost_div);
    const price = priceAt(priceIndex, currencyId, now);
    const currentValue = qty * price;
    const gain = currentValue - costBasis;
    return {
      investment: inv,
      currencyId,
      qty,
      costBasis,
      price,
      currentValue,
      gain,
      returnPct: costBasis > 0 ? (gain / costBasis) * 100 : null,
      daysHeld: (now - new Date(inv.ts).getTime()) / 86400000,
    };
  });

  const byCurrency = new Map();
  for (const row of perInvestment) {
    const agg = byCurrency.get(row.currencyId) || { currencyId: row.currencyId, qty: 0, costBasis: 0, currentValue: 0 };
    agg.qty += row.qty;
    agg.costBasis += row.costBasis;
    agg.currentValue += row.currentValue;
    byCurrency.set(row.currencyId, agg);
  }
  for (const agg of byCurrency.values()) {
    agg.price = priceAt(priceIndex, agg.currencyId, now);
    agg.avgCost = agg.qty > 0 ? agg.costBasis / agg.qty : 0;
    agg.gain = agg.currentValue - agg.costBasis;
    agg.returnPct = agg.costBasis > 0 ? (agg.gain / agg.costBasis) * 100 : null;
  }

  const totalCostBasis = perInvestment.reduce((s, r) => s + r.costBasis, 0);
  const totalCurrentValue = perInvestment.reduce((s, r) => s + r.currentValue, 0);

  return {
    perInvestment,
    byCurrency: [...byCurrency.values()].sort((a, b) => b.currentValue - a.currentValue),
    totalCostBasis,
    totalCurrentValue,
    totalGain: totalCurrentValue - totalCostBasis,
    totalReturnPct: totalCostBasis > 0 ? ((totalCurrentValue - totalCostBasis) / totalCostBasis) * 100 : null,
  };
}

/**
 * Cost-basis (step function, rises at each buy-in) vs market-value time series summed
 * across every investment currency — one combined line for the whole investment
 * portfolio's performance, using each currency's own poe.ninja price history.
 * Starts at the first buy-in — there's nothing to plot before that.
 */
export function portfolioInvestmentSeries(investments, priceIndex) {
  if (investments.length === 0) return [];
  const sorted = [...investments].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const currencyIds = [...new Set(sorted.map((i) => i.currency_id))];

  const sampleTimes = new Set();
  for (const currencyId of currencyIds) {
    for (const p of priceIndex.get(currencyId) || []) sampleTimes.add(p.ts);
  }
  for (const inv of sorted) sampleTimes.add(new Date(inv.ts).getTime());
  sampleTimes.add(Date.now());
  const times = [...sampleTimes].sort((a, b) => a - b);

  const qtyByCurrency = {};
  let idx = 0,
    costBasis = 0;
  const series = [];
  for (const t of times) {
    while (idx < sorted.length && new Date(sorted[idx].ts).getTime() <= t) {
      const inv = sorted[idx];
      qtyByCurrency[inv.currency_id] = (qtyByCurrency[inv.currency_id] || 0) + Number(inv.qty);
      costBasis += Number(inv.total_cost_div);
      idx++;
    }
    if (idx === 0) continue;
    let marketValue = 0;
    for (const [currencyId, qty] of Object.entries(qtyByCurrency)) {
      marketValue += qty * priceAt(priceIndex, currencyId, t);
    }
    series.push({ ts: t, marketValue, costBasis });
  }
  return series;
}
