import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function fetchAll() {
  const [members, currencies, priceHistory, transactions, investments, splits] = await Promise.all([
    sb.from("members_public").select("*"),
    sb.from("currencies").select("*").order("sort_order"),
    sb.from("price_history").select("*").order("ts"),
    sb.from("transactions").select("*").order("ts"),
    sb.from("investments").select("*, investment_contributions(*)").order("ts"),
    sb.from("splits").select("*, split_participants(*)").order("ts"),
  ]);

  for (const r of [members, currencies, priceHistory, transactions, investments, splits]) {
    if (r.error) throw r.error;
  }

  return {
    members: members.data,
    currencies: currencies.data,
    priceHistory: priceHistory.data,
    transactions: transactions.data,
    investments: investments.data,
    splits: splits.data,
  };
}

export async function verifyLogin(memberId, pin) {
  const { data, error } = await sb.rpc("verify_login", { p_member_id: memberId, p_pin: pin });
  if (error) throw error;
  return data === true;
}

export async function insertTransaction({ member_id, currency_id, qty, type, note }) {
  const { error } = await sb.from("transactions").insert({ member_id, currency_id, qty, type, note: note || null });
  if (error) throw error;
}

export async function insertInvestment({ currency_id, qty, total_cost_div, note, contributions }) {
  const { data, error } = await sb
    .from("investments")
    .insert({ currency_id, qty, total_cost_div, note: note || null })
    .select()
    .single();
  if (error) throw error;

  const rows = contributions
    .filter((c) => c.amountDiv > 0)
    .map((c) => ({ investment_id: data.id, member_id: c.memberId, amount_div: c.amountDiv }));
  if (rows.length) {
    const { error: cErr } = await sb.from("investment_contributions").insert(rows);
    if (cErr) throw cErr;
  }
}

export async function insertSplit({ item_name, sale_price_div, note, participantIds }) {
  const { data, error } = await sb
    .from("splits")
    .insert({ item_name, sale_price_div, note: note || null })
    .select()
    .single();
  if (error) throw error;

  const rows = participantIds.map((memberId) => ({ split_id: data.id, member_id: memberId }));
  const { error: pErr } = await sb.from("split_participants").insert(rows);
  if (pErr) throw pErr;
}

export async function markSplitSold(splitId, finalPriceDiv) {
  const { error } = await sb
    .from("splits")
    .update({ status: "sold", sold_ts: new Date().toISOString(), final_price_div: finalPriceDiv ?? null })
    .eq("id", splitId);
  if (error) throw error;
}
