import type { BalanceMap, PairDebt } from '@app/shared';
import { formatPaise, netFor } from '@app/shared';

export interface PaymentContext {
  balances: BalanceMap;
  /** Who owes whom directly. */
  debts: readonly PairDebt[];
  /** The group's "fewest payments" setting. */
  simplify: boolean;
}

/**
 * A heads-up, never a block, when a recorded payment overshoots. Overpaying
 * is legitimate (rounding up, paying ahead), so the payment is still allowed —
 * this just says where things will land.
 *
 * With direct debts (the default) "too much" means more than the payer owes
 * that person: afterwards the receiver would owe the payer the difference.
 * With fewest payments on, a payment is compared to the overall balances
 * instead, since the plan itself sends money to people the payer never owed.
 */
export function paymentWarning(
  context: PaymentContext,
  from: string,
  to: string,
  amountPaise: number,
  nameOf: (memberId: string) => string,
): string | null {
  if (context.simplify) return overallWarning(context.balances, from, to, amountPaise, nameOf);

  const owed =
    (context.debts.find((d) => d.from === from && d.to === to)?.amountPaise ?? 0) -
    (context.debts.find((d) => d.from === to && d.to === from)?.amountPaise ?? 0);
  if (amountPaise <= owed) return null;

  const extra = amountPaise - owed;
  // "You owe" / "Bilal owes": nameOf returns "You" for the viewer.
  const owes = (id: string) => (nameOf(id) === 'You' ? 'owe' : 'owes');
  const standing =
    owed > 0
      ? `${nameOf(from)} ${owes(from)} ${nameOf(to)} ${formatPaise(owed)}, so this is ${formatPaise(extra)} more`
      : owed === 0
        ? `${nameOf(from)} ${owes(from)} ${nameOf(to)} nothing`
        : `it is ${nameOf(to)} who ${owes(to)} ${nameOf(from)} ${formatPaise(-owed)}, not the other way round`;
  return `Heads-up: ${standing}. Afterwards ${nameOf(to)} would owe ${nameOf(from)} ${formatPaise(extra)}.`;
}

/** Phrased with "would" so it reads right for "You" and for a name alike. */
function overallWarning(
  balances: BalanceMap,
  from: string,
  to: string,
  amountPaise: number,
  nameOf: (memberId: string) => string,
): string | null {
  const payerAfter = netFor(balances, from) + amountPaise;
  const receiverBefore = netFor(balances, to);
  const receiverAfter = receiverBefore - amountPaise;

  const notes: string[] = [];
  if (payerAfter > 0) notes.push(`${nameOf(from)} would be owed ${formatPaise(payerAfter)} overall`);
  if (receiverAfter < 0 && receiverAfter < Math.min(0, receiverBefore)) {
    notes.push(`${nameOf(to)} would owe ${formatPaise(-receiverAfter)} overall`);
  }
  return notes.length > 0 ? `Heads-up: after this, ${notes.join(', and ')}.` : null;
}
