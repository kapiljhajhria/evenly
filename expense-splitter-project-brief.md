# Expense Splitter — Project Brief & Decisions

> Handoff document. All product and technical decisions below are settled unless marked **OPEN**. Start from this document; do not re-litigate settled decisions without flagging it.

## 1. What we're building

A mobile-first **web app (PWA)** for splitting expenses among friend groups (Splitwise-style), hosted entirely on **Firebase**. Link-driven growth: creator shares an invite link (typically via WhatsApp), friends tap it, sign in, and claim their spot in the group. India-centric, INR-only.

Primary user flow: create group → add members as named slots → share invite link → members join & claim slots → anyone adds expenses with flexible splits → balances update live → members settle via UPI outside the app and record settlements → when balance hits zero, group can be closed → export PDF → creator may delete group.

## 2. Stack (settled)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **React + Vite + TypeScript**, static PWA | No Next.js/SSR — everything renders post-auth from Firestore subscriptions. `vite-plugin-pwa` for manifest + service worker (needed for iOS push + installability). |
| State | **Zustand** | Thin custom hooks (`useGroup(id)`, `useExpenses(id)`) own `onSnapshot` subscriptions. No TanStack Query, no Redux, no Context-for-everything. |
| Routing | **React Router v7** (library mode) | Routes incl. `/join/:groupId/:token`, `/group/:id` |
| Styling | **Tailwind** | Mobile-first |
| Auth | **Firebase Auth: Google sign-in (primary) + email/password (fallback)** | No anonymous auth (explicitly rejected). No phone OTP. Fallback exists because Google OAuth fails inside WhatsApp/Instagram in-app webviews (`disallowed_useragent`). Join page must detect webviews (UA sniffing) and show an "open in browser" banner; on Android try `intent://` escape. |
| Database | **Cloud Firestore** | Schema in §5 |
| Files | **Firebase Storage** | Receipts as WebP (JPEG fallback if canvas WebP encode returns null) |
| Server | **Cloud Functions (Node 20)** | List in §6 |
| Hosting | **Firebase Hosting** | Static files, one-command deploy |
| Plan | **Blaze required** (Functions + Storage) | Free-tier quotas still apply; expected cost ≈ ₹0 at friends-group scale |
| Libraries | `firebase` v10+ modular SDK, `browser-image-compression`, `jspdf` + `jspdf-autotable` | |
| Testing | **Firebase Emulator Suite from day one** | Security-rules tests are mandatory for the rules in §7; other tests optional |

## 3. Product decisions (settled)

### Money
- **All amounts stored as integer paise** (₹33.34 → `3334`). Percentages stored as integer basis points (25.5% → `2550`). Never floats. Display formatting to 2 decimals happens only at render time.
- Rationale: `balance === 0` must be an exact check (auto-close depends on it); float accumulation breaks that.
- **Remainder rule** for uneven splits: distribute leftover paise one each to members in **ascending memberId order**. Deterministic; precomputed and stored, never recomputed differently by clients.
- **Single currency per group, INR default. No multi-currency.** No recurring expenses.

### Splits — four types, per expense
`equal` | `amount` | `percent` | `portions`

- **`portions`** is the key feature: A=1, B=1, C=2 portions (e.g., C pays for a partner D who isn't in the group). Term to use in UI: **"portions"** (not "ratio"/"shares").
- Split is **fully self-describing per expense** — no member-level weight config. The couple case is just data on each expense.
- Group has a **`defaultSplit`** (portions type) that pre-fills the new-expense form; always editable per expense. Default is **creator-editable only**.
- Not every expense includes the whole group — any subset of members per expense.
- If partner D later joins: new expenses include D at 1 portion; **old expenses stay unchanged** (correct — C really did carry both). No migration.

### Payers & ownership
- **Exactly one payer per expense.** Multi-payer explicitly rejected (log as two expenses). This follows from the ownership rule.
- **The payer owns the expense**: only the payer can edit/delete it. If I record an expense paid by B and made a mistake, I ask B to fix it.
- **Unclaimed-payer exception**: while the payer's member slot is unclaimed (no uid), the record's **creator** (`createdBy`) can edit/delete it. The moment the slot is claimed, ownership transfers exclusively to the claimer.
- **Group creator can delete (not edit) any expense** — cleanup escape hatch, logged in history.

### Settlements
- Modeled as **just another expense** (`type: "settlement"`, payer = who paid, single split entry = who received). Same balance math, same ownership rule.
- **Trust-based, no confirmation step.** B records "paid C ₹450" and it's done.

### Editing & history
- Edits allowed **only while group is open**. Closed group = fully read-only.
- **Edit history** kept per expense (subcollection of snapshots), viewable by any member.
- **OPEN (leaning yes):** enforce history via an `updateExpense` callable (edit + history snapshot in one transaction, direct client updates locked down in rules) vs. trusting the client to write both docs. Decide before building expense editing.

### Group lifecycle
- **Close**: when all balances are zero, show a "Close group" button. **Auto-close** after 7 days if balance is zero **AND no new expense in those 7 days** (any new expense cancels the timer — zero mid-lifecycle must not kill an active group). Daily scheduled function.
- **Delete**: creator only. Flow: prompt (strongly, possibly force) a PDF export download first → confirm → Cloud Function deletes Firestore docs + the group's Storage receipts folder. Server-side because client-side cleanup can be interrupted.

### Receipts
- Optional photo per expense. Client-side pipeline: **manual crop UI** (drag corners; auto-crop via OpenCV.js rejected — 8MB WASM) → resize ~1280px → **WebP** ~0.7 quality (JPEG fallback) → upload to `receipts/{groupId}/{expenseId}.webp`. Target ~150–300KB.
- **Expense saves immediately**; upload is background with retry. `receiptStatus`: `none | pending | uploaded | failed` — `failed` renders a visible retry indicator **only on expenses where an upload was attempted**.
- Storage rules: group members only, path must match an expense in their group, image content-type, ~1MB cap.

### PDF export
- **Client-side** (jsPDF + autotable). Any member can export. Required before creator deletes group.
- Layout: **expense/settlement table first, ALL receipts appended at the end** — one receipt per page with a caption (date, description, amount, paid by). **Do NOT interleave receipts with table rows.**
- WebP receipts must be decoded to canvas → re-encoded JPEG for embedding (jsPDF doesn't embed WebP).

### Invites & anti-stranger design
- Link: `app.com/join/{groupId}/{token}` — random 20+ char token on the group doc, with expiry (e.g., 7 days).
- **Claim-a-slot model** (approval flow rejected): joiner signs in, picks their unclaimed slot from the member list. Stranger-proofing = unguessable link + slot claiming + visible Google identities + creator can kick/unclaim + **creator can rotate the token** (direct field update, no function).
- Per-person invite tokens: optional future upgrade, not v1.

### Identity & display names
- Slot name (typed by creator) wins; if none, claimer's Google display name. Member can edit **their own** slot name after claiming. Google photo as avatar.

### Multi-group & home page
- A user can be in many groups; **each group settles independently**. Home page shows per-group lines: "you owe ₹X in group Y". Implemented via collection-group query on `members` where `uid == me` (composite index), then 1 group-doc read each → user in 5 groups = 6 reads.

### Notifications
- **No email alerts** (only Firebase's built-in auth emails). No per-expense emails ever.
- **v1.5, not v1**: Web push via FCM for "expense added" / "settled up". Works on Android/desktop browsers directly; **iOS requires the PWA to be added to home screen** (iOS 16.4+), a regular Safari tab cannot receive push. Push send will fold into the `onExpenseWrite` trigger — zero rework.

## 4. Read/write cost strategy (settled)

- **Materialized `balances` map on the group doc**, maintained by a Cloud Function trigger — never computed client-side, never writable by clients. Balance screen = 1 read; home page = 1 read per group + membership query.
- Full expense scans happen only for: paginated expense list, PDF export (on-demand).
- `uids` mirror array on the group doc (maintained by the join function) so read rules are a cheap array check instead of `get()` calls.
- Trigger computes balance **deltas from the changed doc**, never rescans the collection.

## 5. Firestore schema

```
users/{uid}
  displayName, photoURL, createdAt

groups/{groupId}
  name, currency: "INR"
  createdBy: uid
  status: "active" | "closed"
  inviteToken: string            // 20+ random chars
  inviteTokenExpiresAt: timestamp
  uids: [uid]                    // mirror array, maintained by joinGroup fn
  balances: { [memberId]: int }  // net paise; positive = owed to them
  balancesZero: bool
  zeroSince: timestamp | null
  lastExpenseAt: timestamp
  defaultSplit: { type: "portions", entries: [{ memberId, portions }] }
  createdAt, closedAt

groups/{groupId}/members/{memberId}
  name: string                   // slot name
  uid: string | null             // null = unclaimed
  photoURL: string | null
  claimedAt: timestamp | null

groups/{groupId}/expenses/{expenseId}
  type: "expense" | "settlement"
  description, date
  amountPaise: int
  paidBy: memberId               // exactly one
  createdBy: uid
  splitType: "equal" | "amount" | "percent" | "portions"
  splits: [ { memberId, input: int, owedPaise: int } ]
    // input semantics by splitType:
    //   portions → portion count, percent → basis points, amount → paise, equal → ignored
    // owedPaise precomputed w/ remainder rule = source of truth; must sum to amountPaise
  receiptStatus: "none" | "pending" | "uploaded" | "failed"
  receiptPath: string | null
  createdAt, updatedAt

groups/{groupId}/expenses/{expenseId}/history/{editId}
  editedBy: uid, editedAt
  before: { changed fields snapshot }
```

Composite indexes needed: collection-group `members(uid)`; autoClose query on `groups(status, balancesZero, zeroSince, lastExpenseAt)` (exact shape per emulator error messages).

## 6. Cloud Functions (Node 20, single codebase)

1. **`joinGroup`** (callable) — validate token + expiry → atomically claim slot (set uid, append to `uids`) → reject already-claimed. Must be a function (race-safety + mirror array).
2. **`onExpenseWrite`** (Firestore trigger, create/update/delete) — incremental `balances` update, set `balancesZero` / `zeroSince` / `lastExpenseAt`; re-validate splits-sum invariant as backstop; **on delete, also remove the expense's receipt from Storage** (folded-in cleanup). Push notifications fold in here later.
3. **`deleteGroup`** (callable, creator-only) — delete expenses + members + history + Storage receipts folder + group doc.
4. **`autoClose`** (scheduled daily) — `status=="active" && balancesZero && zeroSince<=now-7d && lastExpenseAt<=now-7d` → close.
5. **OPEN:** `updateExpense` (callable) if enforced edit history is chosen (see §3 Editing).

Explicitly NOT functions: token rotation (direct field update), PDF export (client), receipt compression (client), token-expiry sweep (checked at claim time).

## 7. Security rules (intent)

```
groups:    read  → request.auth.uid in resource.data.uids
           create → authed; createdBy == auth.uid
           update → creator only; whitelist (name, defaultSplit, inviteToken,
                    inviteTokenExpiresAt); NEVER balances/status/uids from clients
           delete → nobody (function only)

members:   read → member; creator manages slots (creates/edits/unclaims);
           claimer may update only name/photoURL of own slot;
           uid written only by joinGroup fn
           // OPEN (minor): may non-creator members add new slots? Default: creator only.

expenses:  read → member
           create → member && group active && createdBy == auth.uid
                    && amountPaise > 0 && sum(splits.owedPaise) == amountPaise
           update/delete → group active && (
                    auth.uid == memberDoc(paidBy).uid                  // owner
                 || (memberDoc(paidBy).uid == null
                     && auth.uid == resource.data.createdBy)           // unclaimed payer
                 || auth.uid == group.createdBy )                      // creator delete
           // if updateExpense callable is adopted, lock client updates instead

history:   read → member; create → same as expense update; update/delete → nobody

storage:   receipts/{groupId}/{expenseId}.webp — write by group members only,
           image/*, ≤ ~1MB
```

**Write emulator tests for rules** — this is the highest-risk code in the app.

## 8. Monorepo layout

```
expense-splitter/
├── package.json               # npm workspaces root: ["web", "functions", "shared"]
├── firebase.json              # hosting → web/dist; functions → functions; emulators
├── .firebaserc
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── shared/                    # workspace: @app/shared — types + pure logic
│   ├── package.json
│   └── src/
│       ├── types.ts           # Group, Member, Expense, Split, enums
│       ├── split.ts           # owedPaise computation + remainder rule
│       └── balance.ts         # balance delta math
├── web/                       # workspace: Vite + React + TS PWA
│   ├── package.json
│   ├── vite.config.ts         # vite-plugin-pwa
│   └── src/
│       ├── lib/firebase.ts    # SDK init (+ emulator connect in dev)
│       ├── stores/            # Zustand
│       ├── hooks/             # useGroup, useExpenses, useAuth… (own onSnapshot)
│       ├── routes/            # RRv7 library mode
│       └── features/          # auth, join, group, expense, receipt, export
└── functions/                 # workspace: Cloud Functions, Node 20, TS
    ├── package.json
    └── src/
        ├── index.ts
        ├── joinGroup.ts
        ├── onExpenseWrite.ts
        ├── deleteGroup.ts
        └── autoClose.ts
```

Key point of the monorepo: **`shared/` holds the split/remainder/balance math and types**, imported by both `web` and `functions`, so client preview and server validation can never disagree. Keep it dependency-free pure TS. (Functions deploy bundles workspace deps — use a bundler in functions or `npm pack` approach; verify at setup since Firebase deploy + workspaces has known friction.)

## 9. Build order

1. Repo scaffold + Firebase project + **Emulator Suite** wiring
2. Auth (Google + email/password) + group creation + **`joinGroup` flow** (riskiest rules) + rules tests
3. Expenses (all 4 split types via `shared/`) + `onExpenseWrite` balance function
4. Home page (multi-group balances), settlements
5. Receipts (crop → WebP → background upload/retry)
6. PDF export; `deleteGroup`
7. Close flow + `autoClose`
8. PWA polish (installability, iOS add-to-home-screen nudge, webview detection on join page)
9. v1.5: FCM push

## 10. Open items (decide during build, all small)

1. Enforced edit history via `updateExpense` callable — **leaning yes**
2. May non-creator members add member slots? — default: creator only
3. Exact auto-close index shape — let emulator/deploy errors dictate
4. Per-person invite tokens — future, not v1
