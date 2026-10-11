import { useEffect } from 'react';
import { Link } from 'react-router';
import { formatDateTimeOf } from '@app/shared';
import { Card } from '../../components/ui.js';
import { useDisplayDateFormat } from '../../stores/preferences.js';
import type { ActivityItem, ActivityKind } from './activity.js';
import { buildActivity } from './activity.js';
import { useActivitySince, useLastSeen } from './useActivity.js';

const SHOWN = 6;

const ICON: Record<ActivityKind, string> = {
  expense: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 16h3',
  payment: 'M4 8h14m0 0-3.5-3.5M18 8l-3.5 3.5M20 16H6m0 0 3.5-3.5M6 16l3.5 3.5',
  comment: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z',
  deleted: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
};
const TONE: Record<ActivityKind, string> = {
  expense: 'bg-accent-100 text-accent-600',
  payment: 'bg-emerald-50 text-emerald-600',
  comment: 'bg-sky-50 text-sky-600',
  deleted: 'bg-red-50 text-red-600',
};

/** The group page's "New since your last visit" card. */
export function WhatsNew({
  groupId,
  items,
  onDismiss,
}: {
  groupId: string;
  items: ActivityItem[];
  onDismiss: () => void;
}) {
  const dateFormat = useDisplayDateFormat();
  if (items.length === 0) return null;
  const forMe = items.filter((item) => item.involvesMe).length;

  return (
    <Card className="space-y-3 ring-accent-300">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">New since your last visit</p>
          <p className="text-xs text-slate-500">
            {items.length} {items.length === 1 ? 'update' : 'updates'}
            {forMe > 0 && ` · ${forMe} involve${forMe === 1 ? 's' : ''} you`}
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="text-xs font-semibold text-brand-600 hover:underline">
          Got it
        </button>
      </div>
      <ul className="space-y-2">
        {items.slice(0, SHOWN).map((item) => (
          <li key={item.key}>
            <Link
              to={`/group/${groupId}/expense/${item.expenseId}`}
              className="flex gap-2 rounded-xl p-1.5 hover:bg-slate-50"
            >
              <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full ${TONE[item.kind]}`}>
                <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={ICON[item.kind]} />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${item.involvesMe ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                  {item.text}
                </span>
                <span className="block truncate text-xs text-slate-500">{item.detail}</span>
              </span>
              <span className="shrink-0 text-[11px] text-slate-400">{formatDateTimeOf(new Date(item.atMs), dateFormat)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > SHOWN && <p className="text-xs text-slate-500">…and {items.length - SHOWN} more below.</p>}
    </Card>
  );
}

/**
 * Home-page pill for one group: how many updates since you last opened it.
 * Reports its count upward so the home page can set the app-icon badge.
 */
export function NewActivityPill({
  groupId,
  uid,
  myMemberId,
  onCount,
}: {
  groupId: string;
  uid: string;
  myMemberId: string;
  onCount: (groupId: string, count: number) => void;
}) {
  const { seenMs } = useLastSeen(uid, groupId);
  const since = useActivitySince(groupId, seenMs);
  const items =
    seenMs === null
      ? []
      : buildActivity({ ...since, seenMs, uid, myMemberId, nameOfUid: () => '', nameOfMember: () => '' });
  const forMe = items.filter((item) => item.involvesMe).length;

  useEffect(() => onCount(groupId, items.length), [groupId, items.length, onCount]);

  if (items.length === 0) return null;
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        forMe > 0 ? 'bg-accent-300 text-brand-700' : 'bg-slate-100 text-slate-600'
      }`}
      aria-label={`${items.length} new updates`}
    >
      {items.length} new
    </span>
  );
}
