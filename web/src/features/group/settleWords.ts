import type { Shortcut, TransferPart } from '@app/shared';

/**
 * Plain-English wording for the settle-up shortcuts, shared by the app and
 * the PDF so both explain the plan the same way. `name` gives a member's
 * display name; `me` is the viewer's member id ("you"), or null for the PDF.
 */
export interface Namer {
  name: (memberId: string) => string;
  me: string | null;
}

const who = ({ name, me }: Namer, id: string, start: boolean): string =>
  id === me ? (start ? 'You' : 'you') : name(id);
const verb = ({ me }: Namer, id: string, singular: string, plural: string): string => (id === me ? plural : singular);

/**
 * "Mihir owes Prabhakar ₹2,384.34, and Prabhakar owes Kapil more than that.
 *  So Mihir pays the ₹2,384.34 straight to Kapil, and Prabhakar pays Kapil
 *  ₹2,384.34 less."
 */
export function shortcutSentence(namer: Namer, s: Shortcut, money: (paise: number) => string): string {
  const a = (start = false) => who(namer, s.from, start);
  const b = (start = false) => who(namer, s.via, start);
  const c = () => who(namer, s.to, false);
  const amount = money(s.amountPaise);
  return (
    `${a(true)} ${verb(namer, s.from, 'owes', 'owe')} ${b()} ${amount}, and ${b()} ${verb(namer, s.via, 'owes', 'owe')} ${c()}. ` +
    `So ${a()} ${verb(namer, s.from, 'pays', 'pay')} that ${amount} straight to ${c()}, ` +
    `and ${b()} ${verb(namer, s.via, 'pays', 'pay')} ${c()} ${amount} less.`
  );
}

/** One line of "how this payment adds up", from the payer's side. */
export function partLabel(namer: Namer, payer: string, receiver: string, part: TransferPart): string {
  const other = part.other ? who(namer, part.other, false) : '';
  const them = payer === namer.me ? 'you' : 'them';
  switch (part.kind) {
    case 'own':
      return part.amountPaise >= 0
        ? `Own debt to ${who(namer, receiver, false)}`
        : `${who(namer, receiver, true)} owed ${them} this`;
    case 'passedOn':
      return `Owed to ${other}, paid to ${who(namer, receiver, false)} instead`;
    case 'coveredBy':
      return `${who(namer, part.other!, true)} pays this part for ${them}`;
    case 'redirected':
      return `Paid to ${other} instead`;
  }
}
