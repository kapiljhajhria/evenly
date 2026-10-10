import type { SettlementPart } from '@app/shared';
import { MAX_PART_NOTE_LENGTH, paiseToDecimalString, parseRupeesToPaise } from '@app/shared';

/** One editable line of the payment amount: what was typed, not yet parsed. */
export interface PartRow {
  amountRaw: string;
  note: string;
}

export const emptyRow = (): PartRow => ({ amountRaw: '', note: '' });

export interface ParsedRows {
  amountPaise: number;
  /** null = a plain single amount, no breakdown stored. */
  parts: SettlementPart[] | null;
  error: string | null;
}

/**
 * One row is a plain amount. Two or more are a breakdown whose total is the
 * payment amount. Rows left completely blank are ignored, so an extra empty
 * line never blocks saving.
 */
export function parseRows(rows: readonly PartRow[]): ParsedRows {
  if (rows.length <= 1) {
    return { amountPaise: parseRupeesToPaise(rows[0]?.amountRaw ?? '') ?? 0, parts: null, error: null };
  }

  const filled = rows
    .map((row, index) => ({ ...row, index }))
    .filter((row) => row.amountRaw.trim() !== '' || row.note.trim() !== '');

  const parts: SettlementPart[] = [];
  for (const row of filled) {
    const amountPaise = parseRupeesToPaise(row.amountRaw);
    if (amountPaise === null || amountPaise <= 0) {
      return { amountPaise: 0, parts: null, error: `Transfer ${row.index + 1} needs an amount.` };
    }
    const note = row.note.trim();
    if (note.length > MAX_PART_NOTE_LENGTH) {
      return { amountPaise: 0, parts: null, error: `The note on transfer ${row.index + 1} is too long.` };
    }
    parts.push({ amountPaise, note: note || null });
  }

  const amountPaise = parts.reduce((sum, part) => sum + part.amountPaise, 0);
  return { amountPaise, parts: parts.length >= 2 ? parts : null, error: null };
}

/** Rows to start an edit from: the breakdown if there is one, else the amount. */
export function rowsFrom(amountPaise: number | undefined, parts: readonly SettlementPart[] | null): PartRow[] {
  if (parts && parts.length >= 2) {
    return parts.map((part) => ({ amountRaw: paiseToDecimalString(part.amountPaise), note: part.note ?? '' }));
  }
  return [{ amountRaw: amountPaise !== undefined ? paiseToDecimalString(amountPaise) : '', note: '' }];
}
