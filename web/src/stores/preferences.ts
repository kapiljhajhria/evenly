import { create } from 'zustand';
import type { DateFormat } from '@app/shared';
import { DEFAULT_DISPLAY_DATE_FORMAT, DEFAULT_INPUT_DATE_FORMAT, isDateFormat } from '@app/shared';
import { readLocal, writeLocal } from '../lib/storage.js';

/**
 * Per-device display preferences. Kept in localStorage, not Firestore: they
 * change how THIS phone shows things, never what is stored, and nobody else
 * in the group should see them change. A missing or unrecognised saved value
 * (private mode, an old build's key) falls back to the default.
 */
const DISPLAY_KEY = 'evenly.dateFormat.display';
const INPUT_KEY = 'evenly.dateFormat.input';

const load = (key: string, fallback: DateFormat): DateFormat => {
  const saved = readLocal(key);
  return isDateFormat(saved) ? saved : fallback;
};

interface PreferencesState {
  /** Expense list, history, comments, invites, PDF export. */
  displayDateFormat: DateFormat;
  /** The date field on the add/edit expense form. */
  inputDateFormat: DateFormat;
  setDisplayDateFormat: (format: DateFormat) => void;
  setInputDateFormat: (format: DateFormat) => void;
}

export const usePreferences = create<PreferencesState>((set) => ({
  displayDateFormat: load(DISPLAY_KEY, DEFAULT_DISPLAY_DATE_FORMAT),
  inputDateFormat: load(INPUT_KEY, DEFAULT_INPUT_DATE_FORMAT),
  setDisplayDateFormat: (format) => {
    writeLocal(DISPLAY_KEY, format);
    set({ displayDateFormat: format });
  },
  setInputDateFormat: (format) => {
    writeLocal(INPUT_KEY, format);
    set({ inputDateFormat: format });
  },
}));

// Another tab changed it: follow along rather than show two formats at once.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === DISPLAY_KEY || event.key === INPUT_KEY) {
      usePreferences.setState({
        displayDateFormat: load(DISPLAY_KEY, DEFAULT_DISPLAY_DATE_FORMAT),
        inputDateFormat: load(INPUT_KEY, DEFAULT_INPUT_DATE_FORMAT),
      });
    }
  });
}

/** The format for shown dates. Re-renders when the setting changes. */
export const useDisplayDateFormat = (): DateFormat => usePreferences((state) => state.displayDateFormat);
export const useInputDateFormat = (): DateFormat => usePreferences((state) => state.inputDateFormat);
