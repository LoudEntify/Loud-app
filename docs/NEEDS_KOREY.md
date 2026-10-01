# Needs Korey

Claude Code adds blockers here with exact steps. Tick them off, then tell Claude Code "NEEDS_KOREY updated" in the session.

## Privacy page (`/privacy`), branch `feature/privacy-page`

- [ ] **Fill in the company details.** The page has one placeholder sentence left exactly as you gave it: "Loudentify is run by [company legal name], [registered address], [company number]." Replace the three bracketed items with the real company legal name, registered address and company number before this goes live — Google's OAuth reviewers and anyone reading the policy will see the brackets otherwise. The text lives in `app/privacy/page.js`, in the "Who we are" section.
- [ ] **A solicitor must review this policy before launch.** This is temporary, plain-English content you gave me to use as written — it is not legal advice and hasn't been checked by a lawyer. `docs/ARCHITECTURE.md` already flags that the training-data section in particular needs legal sign-off; this page should go to the same review before Loudentify relies on it in front of real users or regulators.
- [ ] **To ship it — merge `feature/privacy-page` into `main`.** I confirmed via the live Vercel project data that `main` is the branch serving `loudentify.app` (production auto-deploys on every push to `main`, no separate deploy step). Exact steps:
  1. Go to github.com/LoudEntify/Loud-app in a browser, signed in as yourself.
  2. You should see a banner near the top offering to compare/open a pull request for the recently-pushed `feature/privacy-page` branch — click **Compare & pull request**. (If you don't see the banner: click the **Pull requests** tab → **New pull request** → set the base branch to `main` and the compare branch to `feature/privacy-page`.)
  3. Click **Create pull request**.
  4. Click the green **Merge pull request** button, then **Confirm merge**.
  5. Wait about a minute or two for Vercel to build and deploy automatically — no further click needed.
  6. Open `https://loudentify.app/privacy` in a normal browser tab (no login) and confirm the page loads with the Loudentify header, the title "Privacy policy", and the full text.
- [ ] **If you want to preview the branch before merging it**, Vercel will have already built a preview deployment for `feature/privacy-page` on push (same as every branch). Previews sit behind Vercel's own login (everything except the custom `loudentify.app` domains does) — since you're signed into the Vercel dashboard already, just open the project in vercel.com and click through to the latest preview deployment for this branch; you won't need a separate bypass step.

## Still open from the Phase 1 foundations work (separate branch, `staging`)

- [x] `git push` authentication — fixed. You ran `gh auth login` between sessions, which reconfigured git's credential helper; `feature/privacy-page` pushed cleanly on the first try this session, and the earlier-blocked `staging`/`feature/phase1-foundations` branches have now been pushed too (see below) — nothing left local-only.
