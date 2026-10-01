# Decisions log (Claude Code)

One line per decision: date, decision, reason, option rejected.

- 2026-10-01: Confirmed `main` is the branch serving `loudentify.app` by querying the live Vercel API directly (not trusting stale local memory of a 33-days-old check). Last 5 production-target deployments all show `githubCommitRef: "main"`, the project's domain list includes `loudentify.app`/`www.loudentify.app` and the `loud-app-git-main-...` branch-tracked alias (proof of branch-tracked auto-deploy, not a one-off CLI deploy). `feature/privacy-page` is branched from `main`.
- 2026-10-01: The task's design spec asks for `lang="en-GB"` on the privacy page, but Next.js App Router only allows one `<html>` tag, rendered by the single shared root layout (`app/layout.js`), which already sets `lang="en"` for the whole app. Changing it would be a global change, and the task says "change nothing else in the app." Left it as the inherited `lang="en"` rather than touch the shared layout for one page's regional subtag — a negligible SEO/accessibility difference, not worth the blast radius. Rejected: editing `app/layout.js`.
- 2026-10-01: No sitewide footer component exists anywhere in the app (confirmed by grep across `components/` and `app/`), so per the task's own fallback instruction, the "Privacy" footer is small and scoped to the `/privacy` page only, not added to any shared layout.
