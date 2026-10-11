/**
 * What an expense was for — food, a hotel, fuel. Optional and additive:
 * expenses recorded before categories existed have no `category` and show
 * as uncategorized.
 *
 * One category per expense, not a set of tags, so the per-category totals
 * always add up to the group total.
 *
 * Stored as a string: a preset id (`food`) or a custom name typed by a member
 * (`🎢 Rides`). A custom name that starts with an emoji uses it as its icon.
 */

export interface PresetCategory {
  id: string;
  label: string;
  emoji: string;
}

export const PRESET_CATEGORIES: readonly PresetCategory[] = [
  { id: 'food', label: 'Food', emoji: '🍽️' },
  { id: 'snacks', label: 'Snacks', emoji: '🍿' },
  { id: 'groceries', label: 'Groceries', emoji: '🛒' },
  { id: 'drinks', label: 'Drinks', emoji: '🍻' },
  { id: 'stay', label: 'Stay', emoji: '🛏️' },
  { id: 'travel', label: 'Travel', emoji: '✈️' },
  { id: 'transport', label: 'Cabs & local', emoji: '🚕' },
  { id: 'fuel', label: 'Fuel', emoji: '⛽' },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { id: 'activities', label: 'Activities', emoji: '🎟️' },
  { id: 'bills', label: 'Bills', emoji: '🧾' },
];

/** Matches the length check in firestore.rules — raise both together. */
export const MAX_CATEGORY_LENGTH = 30;

/** Grouping key for expenses with no category. Never stored. */
export const UNCATEGORIZED = '_none';

const CUSTOM_EMOJI = '🏷️';
const UNCATEGORIZED_EMOJI = '📝';
const LEADING_EMOJI = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u;

const presetById = new Map(PRESET_CATEGORIES.map((preset) => [preset.id, preset]));
const presetByLabel = new Map(PRESET_CATEGORIES.map((preset) => [preset.label.toLowerCase(), preset]));

export class CategoryError extends Error {
  override name = 'CategoryError';
}

/**
 * What to store for a picked or typed category: a preset id, a tidied custom
 * name, or null for none. A custom name that matches a preset's name ("food")
 * becomes that preset, so the same thing is not counted under two headings.
 * Throws CategoryError for anything that cannot be stored.
 */
export function normalizeCategory(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new CategoryError('That category is not valid.');
  const text = value.trim().replace(/\s+/g, ' ');
  if (text === '') return null;
  if (presetById.has(text)) return text;
  const preset = presetByLabel.get(text.toLowerCase());
  if (preset) return preset.id;
  if (text.length > MAX_CATEGORY_LENGTH) {
    throw new CategoryError(`Keep the category under ${MAX_CATEGORY_LENGTH} characters.`);
  }
  return text;
}

export interface CategoryInfo {
  /** Grouping key: the preset id, `custom:<lowercased name>`, or UNCATEGORIZED. */
  key: string;
  label: string;
  emoji: string;
  /** The stored value; null for uncategorized. */
  value: string | null;
  preset: boolean;
}

/** How to show a stored category. Anything absent or malformed reads as uncategorized. */
export function categoryInfo(stored: unknown): CategoryInfo {
  if (typeof stored !== 'string' || stored.trim() === '') {
    return { key: UNCATEGORIZED, label: 'Uncategorized', emoji: UNCATEGORIZED_EMOJI, value: null, preset: false };
  }
  const preset = presetById.get(stored);
  if (preset) return { key: preset.id, label: preset.label, emoji: preset.emoji, value: preset.id, preset: true };

  const match = LEADING_EMOJI.exec(stored);
  const emoji = match?.[1] ?? CUSTOM_EMOJI;
  const label = (match ? stored.slice(match[0].length) : stored).trim() || stored;
  return { key: `custom:${stored.toLowerCase()}`, label, emoji, value: stored, preset: false };
}

/**
 * Custom categories already used in a group, most used first — offered as
 * chips next to the presets so the group converges on one spelling.
 */
export function customCategoriesIn(expenses: readonly { category?: unknown }[]): string[] {
  const counts = new Map<string, { value: string; count: number }>();
  for (const expense of expenses) {
    const info = categoryInfo(expense.category);
    if (info.preset || info.value === null) continue;
    const entry = counts.get(info.key);
    if (entry) entry.count += 1;
    else counts.set(info.key, { value: info.value, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .map((entry) => entry.value);
}
