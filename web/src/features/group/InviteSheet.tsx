import { useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { formatDateOf } from '@app/shared';
import { Button, Card } from '../../components/ui.js';
import { inviteUrl, whatsappShareUrl } from '../../lib/invite.js';
import { rotateInviteToken } from './api.js';

export function InviteSheet({
  groupId,
  groupName,
  token,
  expiresAt,
  isCreator,
}: {
  groupId: string;
  groupName: string;
  token: string;
  expiresAt: Timestamp;
  isCreator: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  const url = inviteUrl(groupId, token);
  const expired = expiresAt.toMillis() <= Date.now();

  const share = async () => {
    const text = `Join "${groupName}" on Evenly`;
    if (navigator.share) {
      try {
        await navigator.share({ title: groupName, text, url });
        return;
      } catch {
        // User dismissed the share sheet — fall through to copy.
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };

  return (
    <Card className="space-y-3">
      <div>
        <p className="font-semibold">Invite link</p>
        <p className="text-sm text-slate-500">
          {expired
            ? 'This link has expired. Generate a new one.'
            : `Anyone with this link can claim an open spot. Expires ${formatDateOf(expiresAt.toDate())}.`}
        </p>
      </div>

      <p className="tabular truncate rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{url}</p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void share()} disabled={expired}>
          {copied ? 'Copied' : 'Share link'}
        </Button>
        <a href={whatsappShareUrl(groupName, url)} target="_blank" rel="noreferrer">
          <Button variant="secondary" disabled={expired}>WhatsApp</Button>
        </a>
        {isCreator && (
          <Button
            variant="ghost"
            busy={rotating}
            onClick={async () => {
              setRotating(true);
              await rotateInviteToken(groupId);
              setRotating(false);
              setCopied(false);
            }}
          >
            New link
          </Button>
        )}
      </div>

      {isCreator && (
        <p className="text-xs text-slate-500">
          Generating a new link immediately kills the old one — use it if a link leaked.
        </p>
      )}
    </Card>
  );
}
