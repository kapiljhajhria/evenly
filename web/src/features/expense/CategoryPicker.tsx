import { useState } from 'react';
import { categoryInfo, MAX_CATEGORY_LENGTH, normalizeCategory, PRESET_CATEGORIES } from '@app/shared';
import { Button, Input } from '../../components/ui.js';

/**
 * One category per expense: tap a chip to pick it, tap it again to clear.
 * Custom names already used in the group sit after the presets, so everyone
 * reuses one spelling; "Custom" adds a new one. Optional throughout.
 */
export function CategoryPicker({
  value,
  onChange,
  custom,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Custom categories used in this group, most used first. */
  custom: readonly string[];
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selected = categoryInfo(value);
  const customValues = [...custom];
  // An edit of an expense whose custom category no longer shows up elsewhere.
  if (value && !selected.preset && !customValues.some((c) => categoryInfo(c).key === selected.key)) {
    customValues.unshift(value);
  }
  const chips = [
    ...PRESET_CATEGORIES.map((preset) => categoryInfo(preset.id)),
    ...customValues.map((c) => categoryInfo(c)),
  ];

  const addCustom = () => {
    try {
      const next = normalizeCategory(draft);
      if (next) onChange(next);
      setDraft('');
      setAdding(false);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">
        Category <span className="font-normal text-slate-400">· optional</span>
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const on = chip.key === selected.key;
          return (
            <button
              key={chip.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? null : chip.value)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm transition active:scale-[0.97] ${
                on
                  ? 'bg-brand-600 font-medium text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-300/80 hover:bg-slate-50 hover:ring-slate-400'
              }`}
            >
              <span aria-hidden className="text-base leading-none">
                {chip.emoji}
              </span>
              {chip.label}
            </button>
          );
        })}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-sm text-slate-500 ring-1 ring-slate-300 ring-dashed transition hover:bg-slate-50 hover:text-slate-800"
          >
            <span aria-hidden>＋</span> Custom
          </button>
        )}
      </div>

      {adding && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter adds the category rather than submitting the whole form.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustom();
                }
              }}
              maxLength={MAX_CATEGORY_LENGTH}
              placeholder="🎢 Rides"
              aria-label="New category"
              enterKeyHint="done"
              autoFocus
            />
            <Button type="button" variant="secondary" onClick={addCustom} disabled={draft.trim() === ''}>
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label="Cancel"
              onClick={() => {
                setAdding(false);
                setDraft('');
                setError(null);
              }}
            >
              ✕
            </Button>
          </div>
          <p className={`text-xs ${error ? 'text-red-600' : 'text-slate-500'}`}>
            {error ?? 'Start it with an emoji to give it an icon.'}
          </p>
        </div>
      )}
    </fieldset>
  );
}
