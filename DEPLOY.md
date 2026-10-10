# Deploying

One-time setup, then three commands. Everything marked **console** happens in a
browser at <https://console.firebase.google.com>; everything else is terminal.

> **Two choices here are permanent.** The Firestore location cannot be changed
> after creation, and it must match the Cloud Functions region or the
> `onExpenseWrite` trigger will not deploy. Both are `asia-south1` below.

---

## 1. Create the project — console

1. **Add project**, note the **Project ID** (not the display name).
2. **Upgrade to Blaze.** Functions and Storage do not exist on Spark. Expected
   cost at friends-group scale is effectively ₹0, but set a budget alert anyway:
   Google Cloud console → Billing → Budgets & alerts → ₹500/month.

## 2. Create Firestore and Storage in `asia-south1` — console

1. **Build → Firestore Database → Create database**
   - Location **`asia-south1` (Mumbai)** ← permanent, must match the functions region
   - Start in **production mode** (rules get overwritten in step 6 anyway)
2. **Build → Storage → Get started**, same location.

If you pick a different region, change it in both
`functions/src/common.ts` (`REGION`) and `web/src/lib/firebase.ts`
(`FUNCTIONS_REGION`) before deploying.

## 3. Enable sign-in providers — console

**Build → Authentication → Get started**, then enable:

- **Google** — set a project support email
- **Email/Password** — the fallback for WhatsApp/Instagram in-app browsers,
  where Google OAuth returns `disallowed_useragent`

## 4. Register the web app — console

**Project settings → Your apps → Web (`</>`) → Register app.**
Leave Firebase Hosting unchecked (the CLI handles it). Copy the config object.

## 5. Point the repo at your project

```bash
npx firebase login

# point `default` at your real project id — edit .firebaserc directly, and
# leave the `emulator` alias alone (it is local-only, see Notes)
npx firebase use --add
npx firebase use default
npx firebase projects:list          # confirm the right one is marked (current)
```

## 6. Write the production config

Use `.env.production.local`, **not** `.env.local` — `.env.local` is also read by
`npm run dev` and would silently point local development at live data.

```bash
cat > web/.env.production.local <<'ENV'
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET=YOUR_PROJECT_ID.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:abc123
ENV
```

Copy the values from the console — do not hand-type the bucket name. Projects
created recently use `.firebasestorage.app`; older ones use `.appspot.com`.

`npm run build` refuses to run if any of these are missing, or if the project id
still starts with `demo-`. Without that guard a missing key compiles to
`undefined`, the build succeeds, and the first thing you see is
`auth/invalid-api-key` in the browser console of a site you already deployed.

## 7. Check it before shipping it

```bash
npm run typecheck
npm test
npm run test:rules
npm run test:integration
```

All four must pass. `test:rules` and `test:integration` start their own
emulators, so stop `npm run dev:all` first or they will fail on busy ports.

## 8. Deploy

Rules and indexes first — indexes take a few minutes to build, and the app
needs the collection-group index before the home page will list anything.

```bash
npm run deploy:rules       # firestore rules + indexes + storage rules
npm run deploy:functions   # first run enables APIs; approve the prompts
npm run deploy:hosting
```

Or everything at once once you have done it the long way at least once:

```bash
npm run deploy
```

The first `deploy:functions` asks to enable Cloud Build, Artifact Registry,
Cloud Run, Eventarc, Pub/Sub and Cloud Scheduler. Say yes to all — `autoClose`
is a scheduled function and `onExpenseWrite` is an Eventarc trigger.

### Storage CORS — once, for PDF export

PDF export draws each photo receipt onto a canvas to re-encode it as JPEG,
and downloads each PDF bill to merge its pages in. Neither works across
origins without CORS. The bucket has
no CORS policy by default, so without this step every receipt page in the PDF
says "could not be loaded" (viewing receipts in the app is unaffected).

```bash
gcloud storage buckets update gs://YOUR_BUCKET --cors-file=storage.cors.json
gcloud storage buckets describe gs://YOUR_BUCKET --format="default(cors_config)"
```

`YOUR_BUCKET` is `VITE_FIREBASE_STORAGE_BUCKET` from step 6. `storage.cors.json`
allows GET from the two hosting domains and `localhost:5173`; add any custom
domain you serve the app from.

## Prompts you will be asked, and what to answer

The CLI is interactive on a first deploy. None of these are trick questions,
but two of them cost money if you get them wrong.

| Command | Prompt | Answer | Why |
|---|---|---|---|
| `firebase login` | Allow Firebase to collect CLI usage and error reporting? | either | Telemetry only. |
| `deploy:rules` | Cloud Storage needs an IAM Role to use cross-service rules. Grant the new role? | **Yes** | `storage.rules` calls `firestore.get()` to check group membership. Without the role, every receipt upload is denied. |
| `deploy:functions` | API `[…]` not enabled. Enable and retry? | **Yes** | Repeats for Cloud Build, Artifact Registry, Cloud Run, Eventarc, Pub/Sub and Cloud Scheduler. All are required. |
| `deploy:functions` | How many days do you want to keep container images before they're deleted? `(1)` | **`1`** | See below — this is the only line item likely to show up on your bill. |
| `deploy:functions` | Functions found in your project but not in local source. Proceed with deletion? | **No**, unless you deleted them on purpose | Answering yes removes live functions. |

### The container image cleanup prompt

Every function deploy builds a container image and pushes it to Artifact
Registry. Nothing deletes the old ones by default, so they pile up with every
deploy — roughly 100–400 MB each, times five functions, times every deploy you
ever run.

Artifact Registry gives 0.5 GB free and then bills for storage. At this app's
scale it is the **only** service likely to leave the free tier — not Functions,
not Firestore, not Scheduler. Answering `1` sets a policy that deletes images
older than a day. It does not affect running functions; those images are build
artifacts, not the live runtime.

If you already dismissed the prompt, set it after the fact:

```bash
npx firebase functions:artifacts:setpolicy --location asia-south1 --days 1 --force
```

### What actually costs money here

| Service | Free allowance | This app at friends-group scale |
|---|---|---|
| Cloud Functions (2nd gen) | 2M invocations/month, scales to zero | free — no idle instances |
| Cloud Firestore | 50K reads + 20K writes/day | free |
| Cloud Scheduler | 3 jobs/month | free — `autoClose` is 1 job |
| Eventarc / Pub/Sub | generous free tier | free at this volume |
| Artifact Registry | 0.5 GB | **the one to watch** — set the cleanup policy |
| Hosting | 10 GB storage, 360 MB/day transfer | free |

Set a budget alert regardless (§1). Prices change; confirm against the
[pricing page](https://firebase.google.com/pricing) and your own billing
console rather than this table.

## First 2nd-gen deploy: Eventarc permission error

```
Validation failed for trigger …: Permission denied while using the Eventarc
Service Agent … Since this is your first time using 2nd gen functions, we need
a little bit longer to finish setting everything up.
```

This is a propagation race, not a misconfiguration. The Eventarc service agent
is created during the deploy that then immediately tries to use it. Only
`onExpenseWrite` hits it, because it is the only Eventarc-triggered function —
the three callables and the scheduled job deploy fine.

Wait two or three minutes, then redeploy just that one:

```bash
npx firebase deploy --only functions:onExpenseWrite
```

**Do not skip this.** `onExpenseWrite` is what maintains `balances`. Without it
expenses save but every balance stays at zero forever.

If it still fails after a few retries, grant the role explicitly in the Google
Cloud console → IAM → find the `service-<PROJECT_NUMBER>@gcp-sa-eventarc`
principal → add **Eventarc Service Agent**.

## 9. Verify

```bash
npx firebase firestore:indexes          # confirm the members(uid) override landed
npx firebase functions:list             # all FIVE must be listed
npx firebase functions:log --only onExpenseWrite
```

Then open `https://YOUR_PROJECT_ID.web.app` and walk the real path:

1. Sign in with Google
2. Create a group with two friend slots
3. Add an expense → the balance must move within a second or two
   (if it does not, `functions:log` will say why)
4. Open the invite link in an incognito window, sign in as someone else,
   claim a slot
5. Settle up → balances go to exactly zero

## Deploying a change to a live app

Order matters when rules and client code change together. Rules first: a client
that sends a new field before the rules accept it gets PERMISSION_DENIED,
whereas rules that accept a field nobody sends yet are harmless.

```bash
npm run deploy:rules       # accept the new shape first
npm run deploy:functions   # then new/changed callables
npm run deploy:hosting     # then the client that uses them
```

New callables (`removeMember`, `updateExpense`) do not exist until
`deploy:functions` finishes, so shipping hosting first gives users a button
that 404s.

Rules that *remove* a client capability are the exception to rules-first: the
expense update rule now allows only receipt patches, so deploying it before the
functions would break editing for anyone mid-session. In practice deploy all
three back to back.

## Redeploying

```bash
npm run deploy:hosting     # front-end only, seconds
npm run deploy:functions   # after touching functions/ or shared/
npm run deploy:rules       # after touching firestore.rules or storage.rules
```

`shared/` is bundled into both, so a change there needs **both** hosting and
functions redeployed or the client and server will disagree about split math.

## How users get an update

The running page is served from the **active** service worker's precache, so a
deploy does not reach an open app on its own. Three things make it land:

1. `UpdateTicker` shows a bar at the top of the app when a new build is waiting,
   with an "Update now" button and per-OS instructions behind "Nothing
   happened?". It re-checks hourly and whenever the app returns to the
   foreground, so a session left open for days still notices.
2. `Cache-Control: no-cache` on `/sw.js`, `/index.html`,
   `/manifest.webmanifest` and `/registerSW.js`, so the browser always sees the
   new service worker and the current app name.
3. Failing all that: fully closing the app activates the waiting worker.
   Backgrounding it is not enough — every window has to go.

**The ticker cannot retrofit itself onto an older install.** A build that
predates the component has no ticker in it, so those users need one manual
close-and-reopen. There is no way around that; it is a property of how service
workers hand over, not a bug. Say so when you announce a release.

## Troubleshooting

**`this index is not necessary, configure using single field index controls`**

A *single-field* index cannot live in the `indexes` array — that array is only
for multi-field composites. The home page's collection-group query on
`members.uid` is a single field, so it belongs in `fieldOverrides`:

```json
{
  "collectionGroup": "members",
  "fieldPath": "uid",
  "indexes": [
    { "order": "ASCENDING",  "queryScope": "COLLECTION" },
    { "order": "DESCENDING", "queryScope": "COLLECTION" },
    { "order": "ASCENDING",  "queryScope": "COLLECTION_GROUP" }
  ]
}
```

The two `COLLECTION` entries are not padding. A field override **replaces**
Firestore's automatic single-field indexing for that field, so omitting them
would break `joinGroup`'s `members.where('uid', '==', me)` — a collection-scoped
query — while fixing the home page.

**`The query requires an index` at runtime**

The error message contains a console link that builds the exact index. Click it,
then copy the resulting definition back into `firestore.indexes.json` so the
next deploy does not drop it. The auto-close index shape is the likely
candidate — it filters on two inequality fields.

**`auth/invalid-api-key` in the deployed app**

`web/.env.production.local` was missing or incomplete when you ran the build, so
the Firebase config compiled to `undefined`. Create the file (§6) and redeploy
hosting. `npm run build` now fails fast on this rather than shipping it.

**Emulators do not enforce indexes.** Every query works locally whether or not
an index exists, so index problems only ever surface against a real project.
Walk the verification steps in §9 after any index change.

## Notes

- **Custom domain**: Hosting → Add custom domain. Then
  Authentication → Settings → Authorized domains → add it, or Google sign-in
  will fail on the new domain.
- **The `emulator` alias in `.firebaserc` stays `demo-expense-splitter`.** It is
  a local Emulator Suite namespace, not a real project, and renaming it would
  reset your local dev data across six files for no functional gain.
- **Icons** live in `web/public/` and are generated by
  `python3 web/scripts/generate-icons.py` (needs Pillow). The PNGs are
  committed, so the build does not depend on that script — rerun it only if you
  change the mark in `favicon.svg`.
- **Storage rules are deployed but unexercised** — the receipt upload UI is not
  built yet (brief §9 step 5). Nothing writes to Storage until it is.
- **`autoClose` runs daily at 03:00 IST.** It will not touch groups that never
  had an expense.
- **Rolling back hosting**: Hosting → Release history → Rollback, or
  `npx firebase hosting:rollback`.
