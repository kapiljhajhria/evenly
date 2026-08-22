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

# swap in your real project id
sed -i 's/"default": "expense-splitter-dev"/"default": "YOUR_PROJECT_ID"/' .firebaserc
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

## 9. Verify

```bash
npx firebase hosting:channel:list
npx firebase functions:list
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

## Redeploying

```bash
npm run deploy:hosting     # front-end only, seconds
npm run deploy:functions   # after touching functions/ or shared/
npm run deploy:rules       # after touching firestore.rules or storage.rules
```

`shared/` is bundled into both, so a change there needs **both** hosting and
functions redeployed or the client and server will disagree about split math.

## Notes

- **Custom domain**: Hosting → Add custom domain. Then
  Authentication → Settings → Authorized domains → add it, or Google sign-in
  will fail on the new domain.
- **Storage rules are deployed but unexercised** — the receipt upload UI is not
  built yet (brief §9 step 5). Nothing writes to Storage until it is.
- **`autoClose` runs daily at 03:00 IST.** It will not touch groups that never
  had an expense.
- **Rolling back hosting**: Hosting → Release history → Rollback, or
  `npx firebase hosting:rollback`.
