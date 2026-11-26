# Repository contribution evidence

Evidence date: 19 November 2026

## Evidential limitation

Git records names, email strings, commits and file changes. It does not independently prove legal identity, founder status, employment, intellectual-property ownership, or whether a named author worked without assistance. An endorsing body should verify those matters using company records, signed IP assignments, interviews, pull requests and platform account records.

This document therefore reports **repository attribution**, not a legal conclusion about the founder.

## Innovation implementation sequence attributed to Ugochukwu Onah

The following commits are present in the current Git history and use author name `Ugochukwu Onah`:

| Commit | Date | Repository evidence |
| --- | --- | --- |
| `478dd9b` | 2026-11-19 | Google/YouTube OAuth connection: 14 files, 606 insertions, 1 deletion. |
| `b93b9b4` | 2026-11-19 | YouTube readiness service: 9 files, 311 insertions, 33 deletions. |
| `ca0ca6d` | 2026-11-19 | YouTube broadcast management: 8 files, 436 insertions, 2 deletions. |
| `a994456` | 2026-11-19 | Show orchestration and persistent lease design: 7 files, 516 insertions, 1 deletion. |
| `cbb8763` | 2026-11-19 | Official embedded YouTube viewer: 6 files, 234 insertions, 3 deletions. |
| `243c553` | 2026-11-19 | Latency-aware interaction service: 14 files, 325 insertions, 11 deletions. |
| `9ded421` | 2026-11-19 | EXP-VD-001 visual assessment: 11 files, 432 insertions, 2 deletions. |
| `b904c1e` | 2026-11-19 | EXP-VD-002 recommendation/training pipeline: 10 files, 174 insertions, 3 deletions. |
| `4e5d5ed` | 2026-11-19 | Synthetic reliability/load framework: 7 files, 354 insertions, 1 deletion. |

The same author name appears earlier on account, dashboard, scheduling, waitlist and interface commits. Multiple email aliases are present for that name; they must not be assumed to represent separate people or verified identities without GitHub/account evidence.

## Nature of the attributed technical work

Subject to identity verification, the commit record attributes the following cohesive technical decisions to Ugochukwu Onah:

- **IMPLEMENTED:** artist-owned YouTube authorization, readiness checking and broadcast-resource management;
- **IMPLEMENTED:** lifecycle orchestration with leases, idempotency, reconciliation and audit events;
- **IMPLEMENTED:** compliant YouTube viewing and latency-aware interaction services;
- **EXPERIMENTAL / IMPLEMENTED:** performer-aware visual features outside the media path;
- **EXPERIMENTAL / IMPLEMENTED:** constrained deterministic recommendations, shadow mode, safe activation and leakage-aware dataset tooling;
- **TESTED:** local visual baselines, recommendation fixtures, mocked lifecycle/API tests and synthetic reliability profiles;
- **DOCUMENTED:** limitations, unvalidated claims and future research requirements.

## Other repository contributors

`git shortlog -sne --all` reports substantial history under several names and automation identities, including Korey Alashe, Claude/Claude Code, LoudEntify build identity, and Ugochukwu Onah aliases. As recorded at the evidence date, the largest displayed shortlog identity is `Korey Alashe <o.a.alashe@paintbookco.co.uk>` with 371 commits. Automated/AI identities also have commits. These contributions pre-date and coexist with the November innovation sequence.

Consequently:

- no claim is made that one person authored the entire Loudentify codebase;
- no claim is made that commit count measures technical importance;
- no claim is made that AI-authored commits establish personal authorship;
- the application should distinguish the applicant's product/technical leadership from code written by other people or tools.

## Suggested due-diligence corroboration

**PLANNED evidence collection:**

1. map Git email aliases to the applicant's verified GitHub account;
2. provide pull-request links and protected-branch review history;
3. retain dated design briefs that preceded commits `478dd9b` through `4e5d5ed`;
4. demonstrate the architecture and tests live from the relevant commits;
5. provide company incorporation, role and IP-assignment evidence separately;
6. identify work produced with AI assistance and explain the applicant's specification, review, testing and technical decision-making;
7. obtain contributor statements where ownership or responsibility needs corroboration.

## Reproducible Git checks

```sh
git show --stat 478dd9b
git show --stat b93b9b4
git show --stat ca0ca6d
git show --stat a994456
git show --stat cbb8763
git show --stat 243c553
git show --stat 9ded421
git show --stat b904c1e
git show --stat 4e5d5ed
git shortlog -sne --all
```

Run these against the submitted repository clone and record the repository URL, branch and final commit hash in the application bundle.
