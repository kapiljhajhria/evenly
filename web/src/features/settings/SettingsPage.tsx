import type { DateFormat } from '@app/shared';
import { DATE_FORMATS, DEFAULT_DISPLAY_DATE_FORMAT, DEFAULT_INPUT_DATE_FORMAT, formatDate } from '@app/shared';
import { AppShell } from '../../components/Layout.js';
import { Card } from '../../components/ui.js';
import { usePreferences } from '../../stores/preferences.js';
import { NotificationsCard } from '../notifications/NotificationsCard.js';
import { InstallSettings } from '../install/InstallCard.js';

/** A fixed sample, so every option shows the same day and is easy to compare. */
const SAMPLE = '2026-08-15';

export function SettingsPage() {
  const { displayDateFormat, inputDateFormat, setDisplayDateFormat, setInputDateFormat } = usePreferences();

  return (
    <AppShell title="Settings" back="/">
      <InstallSettings />
      <NotificationsCard />

      <Card className="space-y-4">
        <div>
          <p className="font-semibold">Dates</p>
          <p className="text-sm text-slate-500">
            Only changes how dates look on this device. What is saved, and what everyone else sees, stays the same.
          </p>
        </div>

        <FormatChoice
          legend="In lists, history, comments and PDF exports"
          name="display-date"
          value={displayDateFormat}
          defaultValue={DEFAULT_DISPLAY_DATE_FORMAT}
          onChange={setDisplayDateFormat}
        />
        <FormatChoice
          legend="In the date box when adding an expense"
          name="input-date"
          value={inputDateFormat}
          defaultValue={DEFAULT_INPUT_DATE_FORMAT}
          onChange={setInputDateFormat}
        />
      </Card>
    </AppShell>
  );
}

function FormatChoice({
  legend,
  name,
  value,
  defaultValue,
  onChange,
}: {
  legend: string;
  name: string;
  value: DateFormat;
  defaultValue: DateFormat;
  onChange: (format: DateFormat) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium text-slate-700">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        {DATE_FORMATS.map((format) => (
          <label
            key={format}
            className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-sm ring-1 transition ${
              value === format ? 'bg-brand-50 ring-2 ring-brand-500' : 'bg-white ring-slate-200 hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={format}
              checked={value === format}
              onChange={() => onChange(format)}
              className="accent-brand-600"
            />
            <span className="tabular min-w-0">
              {formatDate(SAMPLE, format)}
              {format === defaultValue && <span className="block text-[11px] text-slate-400">default</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
