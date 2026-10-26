# Pushing to the team's new GitHub repository — the clean-history procedure

CAC 2026, item 1.5. Two keys the former owner issued (NPS and Recreation.gov) were
committed to `Verdure/Secrets.xcconfig` in this repository's past. They are
**burned** — never reuse them — and the new repository must receive **no commit that
ever contained them**. On the Windows clone used for the 2026-10-24/25 work the
history still carries them:

| Check (run from the repo root) | Result on this clone, 2026-10-25 |
|---|---|
| `git log --all -p \| grep -c <old NPS key>` | 3 |
| `git log --all -p \| grep -c <old Recreation.gov key>` | 3 |
| `git log --all -p \| grep -c <new NPS key>` | 0 |
| `node functions/scripts/check-no-secrets.mjs` (tracked files) | passes — no key material, no secret file tracked |
| `node functions/scripts/check-no-secrets.mjs --history` | fails on the burned keys, as it must until the history is rebuilt |

(The old values are read out of commit `f0d624f` by the person running the check; they are
deliberately not written in this document or in any script.)

## What is already done

- `Verdure/Secrets.xcconfig`, `Verdure/Verdure/GoogleService-Info.plist`,
  `functions/.secret.local` and `functions/.env.local` are ignored and no longer tracked
  (`.gitignore`). The `.template` files stay tracked so a fresh clone knows what to fill in.
- `functions/.env` is ignored too (the Mac tree's rule). The tracked, non-secret
  `functions/.env.example` is copied to `.env` by `functions/scripts/ensure-env.mjs` at the start of
  every `npm run build`, so a fresh clone's emulators stay non-interactive (`defineString` params
  prompt on stdin otherwise) while no config file that could hold a key is ever tracked. The secret
  scan fails the build if `.env` is ever tracked again.
- The new keys live only in the two ignored files. The backend reads them from
  `functions/.secret.local` on the emulators and from `firebase functions:secrets:set` in
  production; the app reads them from `Secrets.xcconfig` → `Info.plist`.
- `GoogleService-Info.plist` and `Secrets.xcconfig` both point at the registered iOS app
  `1:350584206981:ios:d008b84adbc0f34bd29bec` (bundle `com.verdure-app.verdure`).

## The push, when Rishit says so (do NOT run before)

The simplest history with no key in it is a fresh first commit of the current tree.
This keeps every file and loses only the old commit log, which the old repository still has.

```bash
# 0. From a clean working tree on cac-2026, with the final tag in place:
git status --short            # must be empty apart from untracked local files
node functions/scripts/check-no-secrets.mjs            # must pass
git ls-files | grep -E "Secrets\.xcconfig$|GoogleService-Info\.plist$|\.secret\.local$"   # must print nothing

# 1. A new root commit containing exactly the current tree:
git checkout --orphan clean-main
git add -A
git commit -m "Verdure — Congressional App Challenge 2026 submission (clean history)"

# 2. Prove the new history is clean (it has one commit, so this is quick):
node functions/scripts/check-no-secrets.mjs --history   # must pass

# 3. Point at the team's repository and push only this branch:
git remote add team <the new repository URL>
git push team clean-main:main
git tag cac-final-3 && git push team cac-final-3

# 4. Back to the working branch:
git checkout cac-2026
```

If the team would rather keep the full log, use `git filter-repo --replace-text` with a
file holding the two burned values (kept outside the repo), re-point every tag, then run
step 2 against the rewritten history before pushing. Either way: `gitleaks detect` or the
`--history` scan above must report zero hits before `git push`.

## After the push

Each developer copies the templates and fills in local values:

```bash
cp Verdure/Secrets.xcconfig.template Verdure/Secrets.xcconfig
cp Verdure/Verdure/GoogleService-Info.plist.template Verdure/Verdure/GoogleService-Info.plist   # or download it from the Firebase console
printf 'NPS_API_KEY=…\nRECREATION_GOV_KEY=…\n' > functions/.secret.local
```

Rishit holds the two new keys; the handoff document should now say "sent to developer"
in place of the values.
