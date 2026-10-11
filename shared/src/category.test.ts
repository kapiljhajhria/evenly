import { describe, expect, it } from 'vitest';
import {
  CategoryError,
  categoryInfo,
  customCategoriesIn,
  MAX_CATEGORY_LENGTH,
  normalizeCategory,
  UNCATEGORIZED,
} from './category.js';

describe('normalizeCategory', () => {
  it('treats absent and blank as no category', () => {
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCategory('   ')).toBeNull();
  });

  it('keeps preset ids', () => {
    expect(normalizeCategory('fuel')).toBe('fuel');
  });

  it('maps a typed preset name onto the preset, whatever the case', () => {
    expect(normalizeCategory(' FOOD ')).toBe('food');
    expect(normalizeCategory('cabs & local')).toBe('transport');
  });

  it('tidies custom names', () => {
    expect(normalizeCategory('  🎢   Theme  park ')).toBe('🎢 Theme park');
  });

  it('rejects names that are too long or not text', () => {
    expect(() => normalizeCategory('x'.repeat(MAX_CATEGORY_LENGTH + 1))).toThrow(CategoryError);
    expect(() => normalizeCategory(42)).toThrow(CategoryError);
  });
});

describe('categoryInfo', () => {
  it('shows presets with their emoji', () => {
    expect(categoryInfo('stay')).toMatchObject({ key: 'stay', label: 'Stay', emoji: '🏨', preset: true });
  });

  it('uses a leading emoji on a custom name as its icon', () => {
    expect(categoryInfo('🎢 Rides')).toMatchObject({ label: 'Rides', emoji: '🎢', preset: false, value: '🎢 Rides' });
    expect(categoryInfo('👨‍👩‍👧 Family')).toMatchObject({ label: 'Family', emoji: '👨‍👩‍👧' });
  });

  it('gives custom names without one a tag', () => {
    expect(categoryInfo('Laundry')).toMatchObject({ label: 'Laundry', emoji: '🏷️', key: 'custom:laundry' });
  });

  it('groups custom names case-insensitively', () => {
    expect(categoryInfo('Laundry').key).toBe(categoryInfo('laundry').key);
  });

  it('reads absent or malformed values as uncategorized', () => {
    for (const value of [undefined, null, '', 7, {}]) {
      expect(categoryInfo(value).key).toBe(UNCATEGORIZED);
    }
  });
});

describe('customCategoriesIn', () => {
  it('lists custom names, most used first, without presets or duplicates', () => {
    const expenses = [
      { category: 'Laundry' },
      { category: 'food' },
      { category: '🎢 Rides' },
      { category: 'laundry' },
      {},
    ];
    expect(customCategoriesIn(expenses)).toEqual(['Laundry', '🎢 Rides']);
  });
});
