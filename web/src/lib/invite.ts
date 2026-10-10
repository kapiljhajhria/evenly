const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TOKEN_LENGTH = 24;
export const INVITE_TTL_DAYS = 7;

/** Unguessable invite token — the whole anti-stranger story rests on this. */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function inviteUrl(groupId: string, token: string): string {
  return `${window.location.origin}/join/${groupId}/${token}`;
}

export function whatsappShareUrl(groupName: string, url: string): string {
  const text = `Join "${groupName}" on Evenly: ${url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
