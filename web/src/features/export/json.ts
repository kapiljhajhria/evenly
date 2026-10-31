import { isPersonal, netFor, paiseToDecimalString, pairwiseDebts, paymentPlan } from '@app/shared';
import type { ExportInput, ExportModel } from './model.js';

/**
 * The same facts as the PDF, as data: for spreadsheets, scripts and AI
 * assistants, which read JSON far more cheaply and exactly than a PDF.
 * Goes into the ZIP next to the PDF. Pure, so it is tested like the model.
 *
 * Every `*Paise` field is an integer in paise (100 paise = ₹1), exactly as
 * stored; the matching `*Rupees` field is the same amount as a decimal string
 * for reading. Names are included next to ids so nothing needs a lookup.
 */
export interface ExportJson {
  format: 'evenly-export/1';
  exportedAt: string;
  currency: 'INR';
  notes: string[];
  /** Set when this is one member's view: only their entries, balance and payments. */
  view: { memberId: string; name: string } | null;
  group: {
    name: string;
    status: 'active' | 'closed';
    /** `direct`: pay exactly who you owe. `fewest-payments`: the simplified plan. */
    settleMode: 'direct' | 'fewest-payments';
  };
  members: { id: string; name: string; joined: boolean }[];
  balances: {
    memberId: string;
    name: string;
    netPaise: number;
    netRupees: string;
    position: 'is owed' | 'owes' | 'settled';
  }[];
  /** Who owes whom from the expenses themselves, nothing re-routed. */
  directDebts: Transfer[];
  /** What Settle up asks for: the direct debts, or the fewest-payments plan when that is on. */
  suggestedPayments: Transfer[];
  totals: { spentPaise: number; spentRupees: string; personalPaise: number; expenseCount: number; paymentCount: number };
  expenses: ExpenseJson[];
}

interface Transfer {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amountPaise: number;
  amountRupees: string;
}

interface ExpenseJson {
  id: string;
  /** `expense` buys something; `settlement` is a payment between members. */
  type: 'expense' | 'settlement';
  description: string;
  note: string | null;
  /** `YYYY-MM-DD`, with `HH:mm` when recorded. */
  date: string;
  time: string | null;
  category: string | null;
  /** Where it happened, when recorded. `accuracy` is metres, null if unknown or typed by hand. */
  location: { lat: number; lng: number; name: string | null; accuracy: number | null } | null;
  amountPaise: number;
  amountRupees: string;
  paidBy: string;
  paidByName: string;
  /** Paid by one person, for themselves only — not a shared cost. */
  personal: boolean;
  unconfirmed: boolean;
  splits: { memberId: string; name: string; owedPaise: number; owedRupees: string }[];
  /** A settlement made in several transfers. */
  parts: { amountPaise: number; amountRupees: string; note: string | null }[] | null;
  /** Paths of this entry's receipts inside the ZIP. */
  receipts: string[];
  /** Set when soft-deleted: counts for nothing above, kept for the record. */
  deleted: { at: string | null; byName: string } | null;
}

export function buildExportJson(input: ExportInput, model: ExportModel, receiptNames: string[]): ExportJson {
  const rupees = (paise: number) => paiseToDecimalString(paise);
  const names = new Map(input.members.map((m) => [m.id, m.name]));
  const nameOf = (id: string) => names.get(id) ?? 'Removed member';
  const nameOfUid = (uid: string | null | undefined) => input.members.find((m) => m.uid && m.uid === uid)?.name ?? 'Someone';
  const transfer = (t: { from: string; to: string; amountPaise: number }): Transfer => ({
    from: t.from,
    fromName: nameOf(t.from),
    to: t.to,
    toName: nameOf(t.to),
    amountPaise: t.amountPaise,
    amountRupees: rupees(t.amountPaise),
  });

  const view = input.viewMemberId && names.has(input.viewMemberId) ? input.viewMemberId : null;
  const involvesView = (t: { from: string; to: string }): boolean => view === null || t.from === view || t.to === view;
  const isGone = (e: ExportInput['expenses'][number]) => Boolean(e.deletedBy) || Boolean(e.deletedAtMs);
  const live = input.expenses.filter((e) => !isGone(e));
  const debts = pairwiseDebts(live);
  const simplify = input.simplifyDebts === true;

  const receiptsByExpense = new Map<string, string[]>();
  model.receipts.forEach((receipt, index) => {
    const name = receiptNames[index];
    if (!name) return;
    receiptsByExpense.set(receipt.expenseId, [...(receiptsByExpense.get(receipt.expenseId) ?? []), name]);
  });

  return {
    format: 'evenly-export/1',
    exportedAt: input.generatedAt.toISOString(),
    currency: 'INR',
    notes: [
      'Every *Paise field is an integer in paise (100 paise = 1 rupee); the matching *Rupees field is the same amount as a decimal string.',
      'balances: positive means the group owes that member; negative means they owe the group. directDebts is who owes whom, from the expenses. suggestedPayments is what the app asks people to pay.',
      'Deleted entries are listed with `deleted` set and count for nothing in balances, debts or totals.',
    ],
    view: view === null ? null : { memberId: view, name: nameOf(view) },
    group: { name: input.groupName, status: input.closed ? 'closed' : 'active', settleMode: simplify ? 'fewest-payments' : 'direct' },
    members: input.members.map((m) => ({ id: m.id, name: m.name, joined: Boolean(m.uid) })),
    balances: input.members.filter((m) => view === null || m.id === view).map((m) => {
      const net = netFor(input.balances, m.id);
      return {
        memberId: m.id,
        name: m.name,
        netPaise: net,
        netRupees: rupees(net),
        position: net > 0 ? 'is owed' : net < 0 ? 'owes' : 'settled',
      };
    }),
    directDebts: debts.filter(involvesView).map(transfer),
    suggestedPayments: paymentPlan({ balances: input.balances, debts, simplify }).filter(involvesView).map(transfer),
    totals: {
      spentPaise: model.totals.spentPaise,
      spentRupees: rupees(model.totals.spentPaise),
      personalPaise: model.totals.personalPaise,
      expenseCount: model.totals.expenseCount,
      paymentCount: model.totals.settlementCount,
    },
    expenses: input.expenses.map((e) => ({
      id: e.id,
      type: e.type,
      description: e.description,
      note: e.note ?? null,
      date: e.date,
      time: e.time ?? null,
      category: typeof e.category === 'string' ? e.category : null,
      location: e.location
        ? { lat: e.location.lat, lng: e.location.lng, name: e.location.name ?? null, accuracy: e.location.accuracy ?? null }
        : null,
      amountPaise: e.amountPaise,
      amountRupees: rupees(e.amountPaise),
      paidBy: e.paidBy,
      paidByName: nameOf(e.paidBy),
      personal: isPersonal(e),
      unconfirmed: e.unconfirmed === true,
      splits: e.splits.map((s) => ({
        memberId: s.memberId,
        name: nameOf(s.memberId),
        owedPaise: s.owedPaise,
        owedRupees: rupees(s.owedPaise),
      })),
      parts: e.parts?.map((p) => ({ amountPaise: p.amountPaise, amountRupees: rupees(p.amountPaise), note: p.note ?? null })) ?? null,
      receipts: receiptsByExpense.get(e.id) ?? [],
      deleted: isGone(e)
        ? { at: e.deletedAtMs ? new Date(e.deletedAtMs).toISOString() : null, byName: nameOfUid(e.deletedBy) }
        : null,
    })),
  };
}
