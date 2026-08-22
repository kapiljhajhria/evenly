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
npm test                 # shared money/split/balance logic (68 tests, no emulator)
npm run test:rules       # security rules vs the Firestore emulator (87 tests)
npm run test:integration # functions + real client modules (35 tests)
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
  it owns it; ownership transfers the moment the slot is claimed.
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
members page (add/remove slots), expense notes, time-of-day, and optional
location capture with a Google Maps link.

Next, per the brief §9: receipts (crop → WebP → background upload with retry),
PDF export, `deleteGroup` UI, close flow + `autoClose` UI, PWA polish, then FCM
push in v1.5.
