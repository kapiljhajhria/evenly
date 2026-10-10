import type { BalanceMap } from '@app/shared';
import { formatPaise, netFor } from '@app/shared';

/**
 * A heads-up, never a block, when a recorded payment overshoots: the payer
 * ends up owed money, or the receiver ends up owing more than before.
 * Overpaying is legitimate (rounding up, paying ahead), so the payment is
 * still allowed — this just says where the balances will land.
 *
 * Phrased with "would" so it reads right for "You" and for a name alike.
 */
export function paymentWarning(
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
