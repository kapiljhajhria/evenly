import { PRESET_CATEGORIES, UNCATEGORIZED } from '@app/shared';

/**
 * Colours for the PDF's tags. The app shows a category by its emoji; the
 * PDF font has none, so the PDF gives each category a soft tint instead —
 * a pale fill with dark text of the same hue. The label always carries the
 * meaning; the colour only helps the eye find the same category again.
 */

export type Rgb = [number, number, number];

export interface TagColor {
  fill: Rgb;
  text: Rgb;
}

/** Warm ink, paper and marigold — the app's own palette, in RGB. */
export const INK: Rgb = [41, 37, 33];
export const MUTED: Rgb = [120, 113, 104];
export const FAINT: Rgb = [170, 163, 154];
export const RULE: Rgb = [228, 223, 215];
export const PAPER: Rgb = [250, 248, 244];
export const MARIGOLD: Rgb = [240, 190, 70];
export const OWED: Rgb = [5, 130, 85];
export const OWES: Rgb = [200, 40, 40];

const TINTS: Record<string, TagColor> = {
  amber: { fill: [253, 236, 200], text: [125, 75, 0] },
  orange: { fill: [255, 225, 205], text: [150, 60, 10] },
  green: { fill: [222, 242, 212], text: [40, 95, 30] },
  violet: { fill: [236, 226, 252], text: [85, 50, 145] },
  blue: { fill: [219, 234, 254], text: [30, 64, 145] },
  teal: { fill: [207, 240, 238], text: [15, 100, 95] },
  yellow: { fill: [252, 242, 190], text: [105, 80, 0] },
  red: { fill: [254, 226, 226], text: [155, 30, 30] },
  pink: { fill: [252, 228, 242], text: [150, 30, 95] },
  indigo: { fill: [224, 231, 255], text: [55, 48, 163] },
  stone: { fill: [234, 231, 226], text: [85, 78, 70] },
};

/** Fixed per preset, so Food is the same colour in every export. */
const PRESET_TINT: Record<string, keyof typeof TINTS> = {
  food: 'amber',
  snacks: 'orange',
  groceries: 'green',
  drinks: 'violet',
  stay: 'blue',
  travel: 'teal',
  transport: 'yellow',
  fuel: 'red',
  shopping: 'pink',
  activities: 'indigo',
  bills: 'stone',
};

/** Custom categories draw from these, by name, so one name keeps one colour. */
const CUSTOM_TINTS: (keyof typeof TINTS)[] = ['teal', 'violet', 'green', 'pink', 'indigo', 'amber'];

const NEUTRAL: TagColor = { fill: [240, 237, 232], text: MUTED };

/** The colour for a category key (see categoryInfo). */
export function categoryColor(key: string): TagColor {
  if (key === UNCATEGORIZED) return NEUTRAL;
  const preset = PRESET_TINT[key];
  if (preset) return TINTS[preset]!;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TINTS[CUSTOM_TINTS[Math.abs(hash) % CUSTOM_TINTS.length]!]!;
}

/** Every preset has a colour of its own. */
export const presetsCovered = (): boolean => PRESET_CATEGORIES.every((preset) => preset.id in PRESET_TINT);

/** A tag under an entry's description in the PDF ledger. */
export type LedgerTag =
  | { kind: 'category'; key: string; label: string }
  | { kind: 'personal'; label: string }
  | { kind: 'unconfirmed'; label: string };

/** How each kind of tag is drawn. `outline` tags have no fill. */
export function tagStyle(tag: LedgerTag): TagColor & { outline: boolean } {
  if (tag.kind === 'category') return { ...categoryColor(tag.key), outline: false };
  if (tag.kind === 'unconfirmed') return { fill: [254, 236, 200], text: [160, 80, 0], outline: false };
  // Personal: ink outline — reads differently from every category tint.
  return { fill: INK, text: INK, outline: true };
}
