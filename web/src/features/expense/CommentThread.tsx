import { useState, type FormEvent } from 'react';
import type { Timestamp } from 'firebase/firestore';
import type { ExpenseComment, Member, WithId } from '@app/shared';
import { formatDateTimeOf, MAX_COMMENT_LENGTH } from '@app/shared';
import { Avatar, Button } from '../../components/ui.js';
import { addComment, deleteComment } from './api.js';

/**
 * Discussion on one expense — "I think Bilal paid this?" Any member can post;
 * you can delete your own, and the group creator can delete any. No editing:
 * delete and re-post. Read-only once the group is closed.
 */
export function CommentThread({
  groupId,
  expenseId,
  comments,
  members,
  uid,
  isCreator,
  groupActive,
}: {
  groupId: string;
  expenseId: string;
  comments: WithId<ExpenseComment<Timestamp>>[];
  members: WithId<Member<Timestamp>>[];
  uid: string | undefined;
  isCreator: boolean;
  groupActive: boolean;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorOf = (authorUid: string) => members.find((m) => m.uid === authorUid);

  const post = async (event: FormEvent) => {
    event.preventDefault();
    if (!uid || text.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await addComment(groupId, expenseId, uid, text);
      setText('');
    } catch {
      setError('Could not post that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (comments.length === 0 && !groupActive) return null;

  return (
    <div className="space-y-2">
      {comments.length > 0 && (
        <ul className="space-y-2">
          {comments.map((comment) => {
            const author = authorOf(comment.uid);
            const mine = comment.uid === uid;
            return (
              <li key={comment.id} className="flex gap-2">
                <Avatar name={author?.name ?? '?'} photoURL={author?.photoURL} className="size-7" />
                <div className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{mine ? 'You' : (author?.name ?? 'Former member')}</span>
                    <span>{comment.createdAt ? formatDateTimeOf(comment.createdAt.toDate()) : 'just now'}</span>
                    {groupActive && (mine || isCreator) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('Delete this comment?')) void deleteComment(groupId, comment.id);
                        }}
                        className="ml-auto text-slate-400 hover:text-red-600"
                      >
                        delete
                      </button>
                    )}
                  </p>
                  <p className="text-sm break-words whitespace-pre-wrap text-slate-700">{comment.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {groupActive && uid && (
        <form onSubmit={post} className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_COMMENT_LENGTH}
            rows={1}
            placeholder={comments.length > 0 ? 'Reply…' : 'Add a comment…'}
            aria-label="Comment"
            className="min-h-11 flex-1 resize-y rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500"
          />
          <Button type="submit" variant="secondary" busy={busy} disabled={text.trim() === ''}>
            Post
          </Button>
        </form>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
