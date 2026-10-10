# Evenly

Mobile-first PWA for splitting expenses among friend groups, INR-only, hosted
entirely on Firebase. See [`expense-splitter-project-brief.md`](./expense-splitter-project-brief.md)
for the settled product and technical decisions — this README covers how to run it.

## Layout

```
.                       npm workspaces root
├── shared/             @app/shared — types + split/balance math, pure TS, no deps
├── web/                Vite + React + TS PWA (Firebase Hosting)
├── functions/          Cloud Functions, Node 20, bundled with esbuild
├── tests/rules/        Firestore security-rules tests (emulator)
├── firestore.rules     the highest-risk code in the app
├── storage.rules
└── firebase.json       hosting -> web/dist, functions, emulator ports
```

`shared/` is the point of the monorepo: `computeSplits`, the remainder rule and
the balance deltas live there and are imported by **both** the client (live
preview) and the server (validation), so the two can never disagree.

## Running it

```bash
npm install
npm run dev:all        # Emulator Suite + Vite together
```

- app → http://localhost:5173
- Emulator UI → http://localhost:4000

`web/.env.development` already points the SDK at the emulators using a
`demo-` project, so this works with no Firebase account. Sign-in, Firestore,
Functions and Storage all run locally.

To hit real Firebase instead, put your web app config in `web/.env.local`
(gitignored) and set `VITE_USE_EMULATORS=false`.

## Tests

```bash
npm test                 # pure logic in shared/ and web/ (226 tests, no emulator)
npm run test:rules       # Firestore + Storage rules vs the emulators (166 tests)
npm run test:integration # functions + real client modules (95 tests)
npm run test:all         # all of the above
npm run typecheck        # all three workspaces
```

The rules tests are the important ones — they cover slot claiming, expense
ownership transfer, the splits-sum invariant, closed-group read-only mode and
the fields clients must never write. The integration tests drive real expense
writes through the deployed-shape function bundle and assert the balances that
come back out, remainder paise included; `createGroup.web.test.ts` imports the
actual client module and runs it with rules enforced.

If the emulators are already running, skip `emulators:exec` and point vitest at
them directly: `npx vitest run --config tests/rules/vitest.config.ts`. The rules
tests run against their own project id (`demo-expense-splitter-rules`) precisely
so that the `clearFirestore()` between cases cannot wipe your dev data — the
integration tests do share the dev project, but only ever add to it.

## Deploying

See [DEPLOY.md](./DEPLOY.md) for the full first-time walkthrough. Once set up:

```bash
npm run deploy            # rules, indexes, functions, hosting
npm run deploy:rules      # rules + indexes only
npm run deploy:functions
npm run deploy:hosting
```

`functions` is bundled by esbuild into a single `lib/index.cjs` with the shared
math inlined via an alias — `@app/shared` deliberately does not appear in
`functions/package.json`, because that file is uploaded verbatim and a
workspace-only version spec is unresolvable from the public registry.

## Conventions that matter

- **Money is always integer paise.** `₹33.34` is `3334`. Percentages are integer
  basis points. Never floats — `balance === 0` has to be an exact check because
  auto-close depends on it.
- **Leftover paise go to members in ascending `memberId` order.** Computed once,
  stored on the expense, never recomputed differently elsewhere.
- **Clients never write `balances`, `status` or `uids`.** `onExpenseWrite` owns
  balances and applies deltas from the changed doc; it never rescans.
- **Collection-group queries need their own rule.** The home page finds your
  groups with one `collectionGroup('members')` query, and a nested
  `/groups/{groupId}/members/{memberId}` rule does not match it — that takes the
  recursive-wildcard rule near the top of `firestore.rules`, plus the
  collection-group index in `firestore.indexes.json`.
- **Expense edits go through the `updateExpense` callable.** Rules cannot
  require that two documents are written together, so a client-side edit could
  update the expense and skip the history entry, leaving the record decorative.
  The callable writes both in one transaction and recomputes splits server-side.
  Direct client writes are locked to the receipt fields, which the background
  upload needs.
- **A payment can carry a transfer breakdown, display-only.** `parts` on a
  settlement lists the individual transfers (11 UPI payments recorded as one).
  Balances never read it — only `amountPaise` and `splits`. Rules check its
  shape only, because per-transfer checks exceed the rules' 1000-expression
  budget at ~7 transfers; `usableParts()` hides any breakdown that does not
  sum exactly to the amount, and `updateExpense` validates it fully on edit.
- **"Not confirmed" still counts.** `unconfirmed: true` marks a guess (often
  the payer) for the group to check; balances include it as recorded.
  Confirming goes through `updateExpense` so it lands in history, and is the
  one change the recorder may make without owning the expense.
- **Comments are flat per group** (`groups/{g}/comments`, keyed by
  `expenseId`), so the list gets every thread from one listener and the
  expense doc never carries a counter. No edits; delete and re-post.
  `onExpenseWrite` deletes an expense's comments with it.
- **Deletes are soft, and clients can never hard-delete.** Deleting goes
  through `updateExpense` (`changes: { deleted: true }`, payer or group
  creator), which sets `deletedAt`/`deletedBy` and writes history.
  `onExpenseWrite` treats a soft-deleted expense as absent, so its delta
  reverses exactly like a hard delete, and a restore re-applies it. Its
  receipt and comments are kept. The list filters deleted entries out
  client-side (old docs have no field, so no backfill); the Deleted page reads
  them with `deletedAt != null`. Only `deleteGroup` really removes expenses.
- **Groups are deleted in two stages.** `deleteGroup` defaults to a soft
  delete (`status: 'deleted'`, read-only for everyone, restorable) — the
  default matters, because app versions from before this call it with no
  mode. `mode: 'permanent'` is refused until `GROUP_PURGE_WAIT_DAYS` (7) after
  the soft delete and without `confirmName` matching the group name; it is
  the only code path that hard-deletes expenses, comments and receipts.
- **"What's new" is computed on the client.** `users/{uid}/seen/{groupId}`
  (private, server-timestamped) records each person's last visit; three small
  range queries (`createdAt` / comment `createdAt` / `deletedAt` > last visit)
  feed `features/activity/activity.ts`. Your own actions never count. The
  group page captures the previous visit before marking it seen — a
  mark-seen that runs first (React's dev double-mount) would hide everything.
- **Push notifications go only to the people an event involves.** Recipients
  and wording live in `shared/src/notify.ts`; `functions/src/push.ts` reads
  each person's `settings/notifications` and `devices`, sends data-only FCM
  messages, and deletes tokens FCM reports dead. The service worker is our own
  (`web/src/sw.ts`, injectManifest) and builds every notification itself —
  always showing one, because iOS revokes web push from apps that receive
  pushes silently. Under the emulator nothing is sent: messages land in
  `_pushLog` for the tests. `PWA_DEV=1 npm run dev` runs the service worker in
  development.
- **Offline: the app opens, data does not.** The service worker serves the
  app offline; Firestore stays on its in-memory cache on purpose (with
  IndexedDB persistence, writes made right after a reload hung 25s+ in
  testing — see `web/src/lib/firebase.ts`). Offline, screens say so and
  save buttons are disabled; everything catches up on reconnect.
- **Lazy export chunks must stay lazy.** jsPDF, canvg, pdf-lib & co. are
  kept out of the precache, so the app's startup must never import them —
  a `manualChunks` entry once dragged a shared helper into pdf-lib and made
  every offline launch a blank page. `lazyChunksStayLazy()` in
  `vite.config.ts` now fails the build if that happens. Name such chunks via
  `chunkFileNames`, not `manualChunks`.
- **`npm run build:e2e -w web`** builds the real installed app against the
  emulators (`web/.env.e2e`, demo project only; the build guard refuses it
  for a real project). Serve with `npx vite preview` in `web/` to test
  install, offline and the service worker. Never deploy it — `deploy:hosting`
  rebuilds for production first.
- **Fields added after launch are optional, always.** `note`, `time` and
  `location` on an expense are validated as "absent OR null OR valid". An
  update sends the whole document, so requiring any of them would have locked
  every expense recorded before they existed.
- **Never re-key the expense sort.** The list orders by `date, createdAt`. A
  Firestore `orderBy` silently excludes documents missing that field, so
  sorting by `time` would hide every expense that predates it.
- **Two different names, on purpose.** `users/{uid}.displayName` is your account
  name — it seeds new groups and nothing else. `members/{memberId}.name` is your
  slot name in one group, and it is what everyone else sees there. Renaming one
  never touches the other. The account name is written once from the auth
  provider at first sign-in and is yours after that: signing in with Google
  again must never put the Google name back.
- **The payer owns the expense.** While their slot is unclaimed, whoever recorded
  it owns it; ownership transfers the moment the slot is claimed. The one
  exception is the receipt: the recorder may attach or replace it too.
- **Receipts never block the save.** The expense is written with
  `receiptStatus: 'pending'`, the encoded photo is parked in IndexedDB, and
  `features/receipt/queue.ts` uploads it in the background. Clients cannot
  delete Storage objects; clearing `receiptPath` makes `onExpenseWrite` do it.
  A receipt is a photo (`.webp`/`.jpg`, ≤1MB) or a PDF bill uploaded as-is
  (`.pdf`, ≤5MB); the kind is read off the path's extension, so there is no
  extra field. The group export merges PDF bills' own pages in with pdf-lib.
- **`member.uid` is written by `joinGroup` and nothing else** — including for the
  group creator's own slot. Group creation is therefore three sequenced steps
  (group doc → unclaimed slots → `joinGroup`), never one batch: member rules
  `get()` the group doc, and rules read *committed* state, so a batch holding
  both would evaluate the member writes against a group that does not exist yet.

## Build order

Done: repo scaffold, emulator wiring, auth, group creation, invite + claim flow,
all four split types, `onExpenseWrite` balances, home page, settlements, rules
tests.

Also done since launch: group rename, user profile + per-group slot names,
members page (add/remove slots), expense notes, time-of-day, optional location
capture with a Google Maps link, expense editing with enforced, visible
edit history, and receipts (manual crop → ≤1280px WebP/JPEG → background
upload parked in IndexedDB, resumed on app open or reconnect, with Retry;
a `pending` older than 15 minutes is shown as failed), client-side PDF export
(ledger and balances first, every receipt appended one per page), and
`deleteGroup` UI (creator-only, PDF download required first).

Also done: close flow — a "settled up, closes around …" card, creator-only
Close now / Reopen (`setGroupClosed`; reopening restarts the quiet week so the
nightly `autoClose` does not re-close it), and a day's notice before
auto-close. The timing rules live in `shared/src/lifecycle.ts`. Install
prompt (one tap on Android/desktop, Share-sheet steps on iPhone) on the home
page and in Settings, and an honest offline mode. "Download all files (.zip)"
next to the PDF: the same report plus every receipt as its original file
(`receipts/<date> <description> Rs <amount>.<ext>`), built on the device
with fflate.

Next, per the brief §9: close flow + `autoClose` UI, PWA polish, then FCM
push in v1.5.
