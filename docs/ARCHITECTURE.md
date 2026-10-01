# Loudentify Build Architecture

Version 2, 1 October 2026. Owner: Oluwakorede Alashe (Korey). Version 1 was 30 September 2026.

## How to read this

This is the build standard for Loudentify: what every service must do about security, data access, privacy and performance before it ships. It is written for Ugo and for Claude Code to build against and for Korey to hold decisions in.

**What changed in v2.** Everything in v1 stands unless a section says otherwise. New or changed text is marked **v2**. The changes come from decisions made on 1 October:
- Viewers watch through an embedded YouTube player first, with Loudentify's own delivery added later behind the same interface. This changes the live media path, metering, cost, privacy, safety, performance and reliability sections.
- The build is done largely by an AI coding agent working unattended, on a staging then production release flow. This changes the change control, secrets and testing sections.
- The risk list now includes dependence on YouTube and on unattended agent builds.

Four outside standards shape it. Two are law and apply from day one. Two are certifications the business will want later but must be designed for now, because retrofitting them is expensive. **v2:** a fifth row covers platform rules we must obey from the first show.

| Standard | Applies | Why it shapes the build now |
|---|---|---|
| UK GDPR and the Data Protection Act | From the first user | Lawful basis, consent records, DSAR, deletion, retention. Design choices here are hard to undo. |
| Online Safety Act | From the first public show | Live user-generated video with an 18+ gate carries duties around illegal content, reporting and age assurance. |
| SOC 2 Type II | When enterprise or partner deals require it | Needs a year of evidence, so the audit log and access controls must exist long before the audit. |
| ISO 27001 | Alongside or after SOC 2 | Needs a running information security management system, not a document written the month before. |
| **v2:** Platform and privacy-of-communications rules (YouTube API Services terms, Google OAuth verification, UK PECR rules on cookies, Apple and Google store rules) | From the first show | Embedding YouTube sets cookies and has layout rules; going live on an artist's channel needs a verified Google scope; the native apps cannot take payments. |

Three rules run through everything below, and v2 adds a fourth.

1. The show must never stop. Security controls that could cut a live performance are designed to degrade instead. A failed check warns; it does not kill the stream.
2. Least data, least access, least time. Collect only what the product needs, show it only to those who need it, keep it only as long as required.
3. Everything that touches money, identity or someone else's data leaves a trace. If it cannot be audited, it does not ship.
4. **v2:** Own the record, rent the delivery. Any third party that carries our show can fail, change its rules or remove a show. The show state, the recording, the chat, the votes and the money stay in our hands, and delivery sits behind an interface we can swap.

A note on what this is not: it is an engineering and product standard, not legal advice. The GDPR and Online Safety Act points need a lawyer's sign-off before launch, and the training-data section flags where that is most urgent.

## Architecture at a glance

Four layers, and the important thing is what cannot flow backwards.

Every client reaches one gateway, which establishes who is asking before anything else runs. Services hold the logic; stores hold the data, each isolated from the others so a fault in one exposes nothing in the next. The audit log sits below everything with one-way arrows into it: services write, nothing reads back, and no application role can change what is there.

**v2:** Delivery is a fifth concern that sits beside the services, not inside them. The composed show picture leaves through a `PlayerSource` interface with two implementations: `youtube` (first) and `loudentify-llhls` (when funded). Clients ask for a player and never care which one they get.

## Identity, roles and access control

Every request carries an identity, and every identity carries a scope. There is no request that is trusted because of where it came from.

### The roles

| Role | Gets | Never gets |
|---|---|---|
| Guest | Public shows, public profiles, read only | Anything tied to an account |
| Viewer | Their own account, their wallet, their messages | Another viewer's data, any artist console |
| Artist | Everything a viewer has, plus their own shows, settings, recordings, earnings, and their own YouTube channel connection | Another artist's anything, or another viewer's anything |
| Camera device | One show, one camera slot, publish only | Any account data, any read of the stream |
| Operator | The controls one artist granted, for one show, expiring when it ends | Money, settings, account, anything after the show |
| Support agent | A named user's account state, only after a ticket opens, time-boxed | Message contents, payout changes, silent access, YouTube tokens |
| Admin | Moderation queue and account actions, always logged | Direct database access, payout approval alone |
| Finance | Ledger and payout review | Content moderation, account changes |
| Engineer | Production access only through break-glass, time-boxed and logged | Standing production database credentials |
| **v2:** Build agent (Claude Code) | Repository branches, the staging environment, staging data | Production credentials, production data, the promote approval, any production write |

### How it is enforced

- Permission is checked at the data layer, not the screen. The API returns only what the caller may see, so a hidden UI element is never the control. The owner-mode profile is the test case: a non-owner's request must not return owner fields at all.
- Short-lived access tokens, long-lived refresh tokens, bound to a device. Fifteen minutes for access. Refresh tokens rotate on use, and reuse of an old one revokes the whole family, which is how a stolen token gets caught.
- Camera devices get a credential, not a login. Scoped to one artist, one slot, one show window, and it cannot read anything.
- Operator grants are capabilities with an expiry, issued by the artist, revocable mid-show, and they die with the show.
- Passkeys from launch, with Apple and Google sign-in. Passwords are the fallback, not the default.
- Step-up authentication on payout changes, email changes, and identity checks. Re-authenticate even inside a valid session.
- **v2:** Third-party grants (the artist's YouTube connection) request the narrowest scope that allows creating and ending a broadcast. The artist can disconnect at any time, the disconnect takes effect immediately, and every connect, refresh failure and disconnect is audited. Stream keys are created per show, never sent to any client except the egress service, never logged, and rotated after the show.

### Enterprise and organisation access

This is not launch work, but the shape must be right from the start, because bolting tenancy onto a single-user model means rewriting the data layer.

Model it as: a user belongs to zero or more organisations, an organisation holds artists, and roles are granted per organisation rather than globally. A solo artist is simply an organisation of one. That one decision makes labels, venues, management companies and enterprise SSO additive later rather than structural.

When enterprise arrives it needs SAML or OIDC single sign-on, SCIM provisioning so leavers lose access automatically, and per-organisation audit export. Design the role table for it now; build it when a deal needs it.

## Data isolation

Different kinds of data carry different risk, so they do not share a home. The rule is that a mistake in one store should not expose another.

| Store | Holds | Isolation |
|---|---|---|
| Core application | Profiles, shows, follows, comments, settings, current Versus view, stage requests | Row-level security keyed to the caller, enforced in the database itself |
| Identity | Credentials, sessions, passkeys, date of birth, **v2:** YouTube OAuth tokens and stream keys | Separate schema, separate credentials, no join to application data. **v2:** third-party tokens encrypted with per-tenant keys, never returned to a client, never logged |
| Money ledger | Token movements, earnings, payouts | Separate database, append-only, no delete privilege for any application role |
| Audit log | Every privileged action | Separate account entirely, write-only from the app |
| Media | Recordings, clips, B-roll, the egress recording and training copy | Object storage, private by default, reached only by short-lived signed URLs. **v2:** the live picture on YouTube is public by intent and is not covered by our signed URLs |
| Analytics | Behaviour events for product decisions | Pseudonymous ids only, no names, no emails, no message contents |
| Verification | Identity documents | Never stored by us. The provider holds them; we keep a pass or fail and a reference |

### The controls that matter most

- Row-level security in the database. Application code says who is asking, and the database decides what is returned. A missing WHERE clause in one endpoint then leaks nothing. This is the single highest-value control in the whole list.
- No standing production credentials for humans. Access is requested, time-boxed, approved, logged, and expires. **v2:** the same applies to the build agent, which never holds production credentials at all.
- Encryption at rest with per-tenant keys for the sensitive stores, so a key revocation is a real containment action rather than a gesture.
- Signed media URLs, minutes not hours, tied to the viewer and the show. A leaked link should die quickly.
- Private recordings never reachable by guessing a URL: authorisation on every media request, not just on the page that links to it.
- Test data is synthetic. Production data never goes to staging. This is the one that teams break under deadline pressure, so it needs to be enforced in tooling, not policy.

### Data residency

UK and EU users' personal data stays in the UK or EU region. Media can sit behind a global CDN because it is intended to be public, but private recordings and all personal data stay in region. Deciding this now avoids a painful migration when the first enterprise or public-sector conversation asks about it.

**v2:** Live shows carried on YouTube sit on Google's infrastructure and are outside our region control. The artist agreement and the privacy notice must say so plainly. Everything we hold ourselves (accounts, chat, votes, ledger, recordings, tokens) stays in region. The embedded player is loaded from the privacy-enhanced embed domain and only after cookie consent where the rules require it. The cookie banner and privacy notice are updated before the first public show.

## Audit log

The audit log is a separate system that the application can write to and cannot change. It exists so that a year from now we can answer who did what, when, and prove the answer has not been edited.

Build it first. SOC 2 Type II needs a continuous evidence period, so an audit log added in month ten gives an audit that can only start in month ten.

### What it must be

- Separate. Its own store, its own credentials, in a different account from the application. Compromising the app must not let someone rewrite history.
- Append-only. No update, no delete, from any application role. Retention is enforced by policy in the storage layer, not by a delete script.
- Tamper-evident. Each entry carries a hash of the one before it, so any removal or edit breaks the chain and is detectable. A daily root hash is published internally, which turns tampering into something provable rather than suspected.
- Queryable. By actor, subject, action, time and correlation id, without touching production application data. Auditors and support both need this, and support needing it is what keeps it accurate.
- Complete but clean. It records that an action happened, not the contents of a private message or a card number.

### What gets logged

| Category | Examples |
|---|---|
| Authentication | Sign-in, sign-out, failed attempts, password and passkey changes, step-up challenges |
| Access to another person's data | Any support or admin view of a user account, with the ticket reference |
| Money | Every ledger movement, payout request, payout approval, identity-check result, limit change |
| Consent and privacy | Terms acceptance, training-data choice and every change to it, DSAR request and fulfilment, account closure |
| Content decisions | Report received, moderation action, removal, reinstatement, appeal |
| Grants | Operator invited, accepted, revoked; camera paired and unpaired |
| Configuration | Role changes, feature flags, break-glass access opened and closed |
| **v2:** Third-party connections | YouTube channel connected, token refresh failed, disconnected; broadcast created, started, ended, made private; stream key rotated |
| **v2:** Show control | Versus view changes, stage requests, handovers accepted or declined, show started and stopped, legal hold placed and released |
| **v2:** Release and agent actions | Promotion to production requested, approved, applied; migrations applied per environment; protected-path changes and their human approvals |

Each entry carries: who, what, which subject, when, from where, a correlation id linking it to the request, and the before and after where a value changed.

### Retention

Security and financial entries: six years, matching UK financial record-keeping expectations. Product and behaviour events: shorter, and pseudonymous. Personal data inside audit entries is minimised at write time rather than cleaned up later, because cleaning an append-only store is exactly what you cannot do.

## Privacy and data handling

Every field the product collects needs a reason to exist, a lawful basis, and an end date. The sign-up page was already cut to the minimum for this reason.

| Data | Why we have it | Lawful basis | Kept |
|---|---|---|---|
| Name, username, date of birth | Account, 18+ gate | Contract | Life of the account |
| Email | Sign-in, show reminders | Contract | Life of the account |
| Location, country and city | Local discovery, show times | Contract | Life of the account, editable |
| Show recordings | The product itself | Contract | Hot 30 days, then cold; kept until the artist deletes them, subject to legal hold |
| Comments and reactions | The product itself | Contract | Until deleted |
| Messages | The product itself | Contract | Until deleted by either person |
| Ledger and payout records | Legal obligation | Legal obligation | Six years after the last movement |
| Identity documents | Anti-money-laundering | Legal obligation | Held by the provider, not by us |
| Behaviour analytics | Improving the product | Legitimate interests | 13 months, pseudonymous |
| Marketing email | Telling people about features | Consent | Until withdrawn |
| Show footage for director training | Improving the AI director | See the next section | See the next section |
| **v2:** Artist's YouTube connection (tokens) | Going live on the artist's channel | Contract | Until the artist disconnects or closes the account, then deleted |
| **v2:** Viewer playback and cookies from the embedded player | Watching the show | Set by Google; our use is consent where required | Governed by Google's policy; we do not receive viewer identity from YouTube |

### Rights, built as features

DSAR and deletion are product features, not a manual job someone does in a spreadsheet. At a hundred thousand users, manual handling fails the statutory one-month deadline.

- Download my data produces profile, shows, wallet history, comments and notifications, automatically, within the statutory window.
- Close my account is a soft delete: profile hidden, recordings made private, then a hard delete of personal data after a short grace period, keeping only what the ledger legally requires. What is kept and why is stated on the screen. **v2:** closing also disconnects the YouTube channel and deletes the tokens. We cannot delete content already on the artist's own YouTube channel, so the screen says that and tells the artist how to remove it. Where the API allows, we end and make private any broadcast we created.
- Withdrawing a consent is as easy as giving it, and it stops future processing from the moment it is withdrawn.

### Minors

The product is 18+. The date of birth at sign-up is the gate, and an under-18 date is not stored. If age assurance later needs to be stronger than self-declaration, that is an Online Safety Act question rather than a GDPR one, covered below.

### Recording retention

Recordings are the artist's own work, so the default is that we keep them until the artist removes them, and we move them to cheaper storage rather than deleting them to save money. Cost is managed by storage tiering, not by taking someone's catalogue away.

Three rules sit on top of that.

- Clips stay hot. They are what gets shared, so they stay on fast storage regardless of age.
- Legal hold overrides everything. Once a show is reported, or is part of a dispute, an investigation or a payout query, its recording is frozen: it cannot be deleted by the artist or by us until the hold is lifted. Holds are scoped to the show, time-limited, reviewed, and every placement and release is written to the audit log. **v2:** our egress recording is the evidence copy. A hold can also end the YouTube broadcast and make it private where the API allows.
- Nothing disappears silently. If a storage tier or plan ever does carry a time limit, the artist is told well before anything goes, with a chance to download or extend.

On the compliance point: keeping everything for ever is not the safer option. Data minimisation pushes the other way, and a large archive of live video of identifiable people is a growing liability rather than a protection. What regulators expect is that we can preserve and produce the specific material that matters when something goes wrong, which is what legal hold does. Keeping the rest indefinitely adds risk without adding defence.

### Before launch

A Data Protection Impact Assessment is needed, because the product involves live video of identifiable people, payments, and AI processing of personal data at scale. Write it while designing, not after. It is also the document that forces the training-data question in the next section to be answered properly. **v2:** it must also cover YouTube as a recipient of the live picture, the embedded player, and the artist's channel connection.

## The training-data choice

The decision on 30 September was to put this at sign-up, as an opt-out toggle presented alongside the terms rather than buried in a later screen. That is now designed. There is one thing to change about how it is framed, and it matters.

### The problem with making it a gate

Under UK GDPR, consent has to be freely given, and it is not freely given if it is bundled with something the person cannot refuse. If someone cannot finish sign-up without accepting training use, that acceptance is not valid consent, and the resulting dataset is built on a basis that would not survive scrutiny. That is a bad thing to discover after training a model on it.

Accepting the Terms and Conditions is different. That is necessary to provide the service, so it can be required. Training an AI model on someone's performance is not necessary to let them perform, so it cannot ride on the same requirement.

### What to do instead

Keep exactly the design you asked for, and change only the legal basis behind it.

1. Rely on legitimate interests, not consent, for the platform's own director model. This supports an opt-out toggle that is on by default, which is what you want. It requires a written Legitimate Interests Assessment: what the benefit is, why it cannot be achieved with less data, and why it does not override the artist's interests.
2. Present it as a clear, separate line at sign-up, on by default, never pre-ticked inside the terms sentence, and never hidden behind a link. Bundling it into the terms line is what makes it indefensible. Show it only to people who chose to perform, since it has nothing to do with watching.
3. Let it be switched off at sign-up and any time afterwards in Settings, with the change taking effect from that moment and recorded in the audit log.
4. Use it only for footage of the artist's own performance, only for the director model, and only inside Loudentify. Sharing with a third party, or using it to train anything else, needs opt-in consent and should be a separate ask.
5. Exclude viewers entirely. Viewer cameras, comments and messages are out of scope. This keeps the whole question to people who chose to perform publicly.
6. **v2:** Versus puts two artists in one composed picture. Exclusion must work per artist on the source camera tracks, not on the mixed picture. Train from per-camera tracks and shot decisions. Where only the composite exists, use it only if both artists have the setting on.

With those in place, the toggle on the sign-up screen is defensible, honest, and does not depend on people not reading it.

### Where this needs a lawyer

Two points to put in front of a data protection solicitor before launch, not after.

- Whether legitimate interests holds for training on identifiable performance footage, and whether the LIA is strong enough. Regulators have been active on AI training and lawful basis, and the answer moves.
- Whether footage used to model camera framing touches biometric data rules. We are not identifying anyone from their face, which is the usual trigger, but the question should be asked and the answer written down rather than assumed.

## Money

The rule is that the platform never touches card details and never holds a balance it cannot explain from the ledger.

### The ledger

- Double-entry, append-only. Every movement is two matching entries. Balances are derived from the ledger, never stored as a number someone can edit.
- Corrections are reversing entries, never edits. The history stays true.
- Every write is idempotent, keyed by a client-supplied id. A viewer who taps Support twice on a flaky connection pays once. This is the most common way payment systems leak money, and it is cheap to prevent at the start.
- Reconciled daily against the payment provider. A mismatch raises an alert, not a monthly surprise.
- Artist share is 72.5%, calculated once at the moment of the transaction and recorded, so a later rate change never rewrites history.

### What we never hold

Card numbers, bank details and identity documents stay with the payment and verification providers. Keeping card data out of our systems keeps PCI scope at its smallest, which is the difference between a short self-assessment and a serious audit. Payments happen on the web only, which the app design already reflects. The native apps show balances and nothing else.

### Financial crime controls

This product has the pattern that attracts money laundering: pay in, move value to another person, cash out. It needs controls in from the start, not after the first incident.

- Identity checks before any payout. No exceptions, no manual overrides without two approvers.
- Limits on spending per day and per month, with a lower self-set limit available to any fan.
- Watch for the obvious patterns: a new account spending heavily and immediately, circular flows between the same pair, many small accounts funding one artist, a spike before a payout request.
- Separation of duties. Whoever reviews a payout is not whoever can approve it, and neither can change the limits.
- Suspicious activity reporting with a named person responsible and a documented route.
- Competition outcomes come from verified-fan votes, never token volume, which removes the incentive to launder value through prizes. The design already reflects this and the rule should be stated in the competition terms too.
- **v2:** Support is spent in Loudentify only. Nothing about YouTube Super Chat or any YouTube payment feature is used or shown.

## Live media and metering

This is the most expensive part of the product and the part most likely to fail in front of an audience. It gets designed for cost and for graceful failure at the same time.

### The path (v2)

1. Phones and operator devices publish to the ingest layer (WebRTC, WHIP).
2. A mixing layer applies the director's cuts and the vocal preset, and a compositor builds one portrait (9:16) composed picture. Solo is the director's output. Versus has three views: conversation (split half and half, top and bottom), Artist A performing (A fills the frame, B in a small portrait window in the lower right, about 31% of frame width) and Artist B performing (the mirror). Artists switch views with Conversation and Perform buttons. A Perform request while the other artist is on stage must be confirmed by the performing artist. The current view is a show-level fact.
3. The egress service captures that one composed picture and sends it out over RTMP to YouTube. In Versus it goes to both artists' channels. The Loudentify logo is burned in before it leaves. The same egress also writes the recording and the training copy, so a recording cannot go missing because a second process failed.
4. Viewers watch the YouTube player embedded in the Loudentify app and website. Artists see exactly the composed picture, a few seconds ahead of viewers.
5. Delivery sits behind a `PlayerSource` interface. `youtube` ships first. `loudentify-llhls` (low-latency HLS from our own origin and CDN) is added when funded, selected by configuration per show or per region, not by rewriting screens.

### Rules from the pilots

- One feed per physical device, using that device's own camera. The stalled camera on 20 September was the one sharing a laptop.
- A camera is healthy only if it keeps sending frames, not if it connects. Kit Check holds each camera for two minutes for exactly this reason, and the same watchdog runs during the show.
- Mic health is watched on the raw input, not the mixed output, so a dead microphone is caught while the mix still sounds fine.
- Switching a microphone rewires the live mix in place. Nobody logs out mid-show ever again.
- Performer and camera devices must stay in the foreground, and the app warns before the artist navigates away.

### YouTube delivery rules (v2)

- Nothing may overlay the player frame, and the player is never smaller than 200 x 200. Chat, emoji, votes, Support, Share and Report sit around it. We do not put a click-blocker over it.
- Kit Check shows the artist's own camera in the three frames it will appear in, never the YouTube picture. Channel readiness is checked at artist onboarding, not at show time: the channel must be allowed to live stream (a new channel can take about a day to enable) and the Google connection must be valid.
- The broadcast is created when the show is scheduled, goes live at the slot, ends with the show, and its stream key is rotated afterwards. Where the API allows, YouTube's own live chat and comments are switched off so conversation happens only where we moderate it.
- YouTube adds delay. Votes, Support thank-yous and reactions line up with what the viewer sees, not what our server sees: stamp them with the viewer's playback position and give a short grace window when voting closes.
- If delivery is interrupted (YouTube ingest drops, a policy action, a key problem), the artists keep performing, our recording continues, viewers see an honest reconnecting state, and the egress retries the same broadcast and then creates a new one. The show is never lost. Every step is audited.
- Originals only in the public product until the licensing path is signed.

### Metering viewer-hours (v2)

A view counts after 30 seconds of playing, so scrolling past costs the artist nothing. Under YouTube delivery the count comes from the embedded player's own playback events, reported by the viewer's client with the pseudonymous viewer id. Because it is client-reported it is rate-limited, de-duplicated per viewer and show, and sanity-checked against YouTube's concurrent viewer figure. Metering is a separate event stream from the ledger, reconciled to it, and it never blocks playback. If metering fails, the show carries on and the count is reconstructed from the event stream afterwards. Hours running out mid-show never stops the stream; it borrows and tells the artist afterwards.

**Decision needed (v2):** with YouTube carrying the viewers, viewer-hours no longer track a media cost we pay. Decide whether they stay as the artist's allowance and the trigger for prepaid packs, or are redefined. Build metering either way, because the allowance logic needs it.

### Keeping the cost sane (v2)

- Adaptive bitrate for viewers is handled by YouTube. Our own adaptive delivery returns with `loudentify-llhls`.
- Recordings move to cheaper storage after 30 days, and clips stay hot because they are what gets shared.
- Cap the concurrent shows per region at launch, and raise it deliberately. An uncapped launch is how a bill becomes the story. Under YouTube delivery the bill that scales is egress, compute for the compositor and the director, and recording storage.
- Track cost per show-hour (egress, compute, storage) as a product metric from the first show, and track YouTube API quota use. Pricing depends on knowing both.

## Safety, abuse and the Online Safety Act

Loudentify hosts live user-generated video with chat and direct messages between adults. That puts it squarely in scope of the Online Safety Act, and this is the area where a small company is most likely to be caught unprepared. **v2:** it stays in scope when YouTube carries the picture, because chat, messages, show pages, discovery and the embed are ours.

### What being in scope means in practice

- A risk assessment of illegal content, written and kept current.
- Reporting and complaints routes that are easy to find and actually answered. The Report and Contact screens exist; the queue behind them has to be real.
- Terms that say what is not allowed, applied consistently, with a route to appeal.
- Records of decisions, which the audit log already covers.
- A named person accountable for safety. In a two-founder company that is a founder, and it should be written down.

### Live is the hard part

You cannot review live video before it goes out. So the controls are about speed and shape, not pre-approval.

- A one-tap report on the show screen, which cuts straight to a queue with the show, the timestamp and the reporter.
- Ability to stop a show immediately and hold the recording as evidence rather than deleting it. **v2:** stopping means three things at once: remove the embed from Loudentify, end the YouTube broadcast or make it private where the API allows, and freeze our evidence recording.
- A rate of new-artist shows the team can actually watch at launch. Growing supply faster than the ability to moderate it is a self-inflicted wound.
- Chat filters and hidden words already designed, applied by default with the platform list on.
- Clear escalation for the worst categories, including child sexual abuse material and threats to life, with the legal reporting route documented before launch, not improvised during an incident.
- **v2:** Two platforms means two rule sets. YouTube can strike or stop an artist's channel under its own policies, including music rights. The artist agreement says so, and Kit Check or onboarding warns about it.

### Age assurance

Self-declared date of birth is the launch position. If the service later carries content that triggers stricter duties, or if the regulator's expectations for this kind of service tighten, stronger age assurance may be required. Design the sign-up flow so an assurance step can be inserted without redesigning it.

### Abuse of the platform itself

Rate limits on sign-up, comments, follows and token spending. Device and network signals to catch bulk account creation, since vote integrity in competitions depends on accounts being real people. A clear, quick route for an artist to report someone targeting them across shows.

## Performance at scale

The product promise is that a guest sees music within seconds and an artist never gets interrupted. Those two promises set the engineering budget.

### Budgets to hold

| Journey | Target | Why it matters |
|---|---|---|
| App open to first video frame | Under 2 seconds on a mid-range phone | The 60-second preview is worthless if 10 of it is loading |
| Tap a live card to joining the show | Under 3 seconds, **v2:** including the YouTube player | Longer and people swipe away |
| Feed scroll | No dropped frames while scrolling | A stuttering feed reads as a broken app |
| Comment appears for viewers | Under 1 second | Below that it feels live; above it feels like a delay |
| Any settings screen | Under 1 second | Perceived quality lives here |
| **v2:** Composed picture reaches viewers | Delay measured and reported on every show | Votes and reactions depend on it |

### How to hold them

- The feed is a read model, not a query. Precompute per-viewer feeds rather than ranking at request time. This is the difference between a feed that works at a thousand users and one that works at a million.
- Cache aggressively, invalidate on events. Live state such as viewer counts uses short-lived caches; profiles and recordings cache long and clear when they change.
- Preload the next card's first frames while the current one plays, which is what makes a snap feed feel instant. **v2:** an embedded player is heavy. Only one live player instance exists at a time. Neighbouring cards show a still image and warm up lightly. Show the poster first and swap in the player.
- Never block the screen on a non-essential call. Viewer counts, follower counts and insights load after the content, never before it.
- Paginate everything with cursors, never offsets, because offset paging degrades exactly when a list gets popular.
- Read replicas for feeds and profiles, with writes going to the primary. Money always reads from the primary.
- Measure on real devices, not simulators, on the phones the artists in the research actually use.

### Scaling shape

The web app and API scale horizontally and hold no session state. Media scales separately from the application, because a busy Saturday night is a media problem, not a database problem. The database is the hard limit, so keep the hot tables narrow and move behaviour analytics out of it from day one. **v2:** under YouTube delivery the viewer fan-out is Google's problem and ours is the compositor and egress per live show, plus chat, votes and reactions, which are database and realtime load.

## Reliability

A dropped show cannot be undone. An artist who loses an audience once may not book another show, which makes reliability a retention feature rather than an infrastructure concern.

### What we promise ourselves

| Thing | Target |
|---|---|
| **v2:** Our half of delivery: composed picture reaches YouTube | 99.9% of show minutes, measured at the egress |
| **v2:** Viewers watching | Tracked separately from ours, because YouTube's availability is outside our control |
| Going live on time | 99% of scheduled shows start within 60 seconds of their slot |
| The app itself | 99.9% monthly |
| Money operations | 99.99%, and never wrong even when slow |

### Degrade, never stop

When something fails during a show, the order of sacrifice is fixed, and it is the opposite of the usual instinct: protect the performance, drop the extras.

1. Drop insights and analytics collection.
2. Drop viewer counts and non-essential live numbers.
3. Drop comments to read-only.
4. Drop to a single camera feed. **v2:** in Versus, if one artist's connection fails, the healthy artist fills the frame.
5. Drop video quality.
6. Only then, if audio itself cannot be delivered, end the show with an honest message and keep the recording. **v2:** if only YouTube delivery fails, the show is not ended: keep recording, retry, and tell viewers honestly.

Money and safety controls are never in this list. They fail closed while everything else fails open.

### Backups and recovery

Point-in-time recovery on the databases, with a recovery point objective of five minutes and a recovery time objective of one hour. Backups encrypted, held in a separate account, and restored in a test at least quarterly. An untested backup is a guess, and the quarterly restore is what turns it into a fact. **v2:** staging and production are both rebuilt from the repository (infrastructure and migrations as code) so a rebuild is a routine, not a rescue.

## How we build

These are the habits that make the controls above real rather than aspirational, and most of them are cheap if adopted at the start.

### Environments (v2)

Three: local, staging, production. Separate Supabase projects (ideally separate organisations), separate credentials, separate data. Production data never leaves production. Staging runs on synthetic data that looks real enough to test with. Region: UK or EU.

Release flow: feature branch, pull request into `staging`, tests run, merge, the pipeline applies migrations to staging and deploys staging. A human tests on staging. Promotion to production is a manual workflow with an approval step: it merges `staging` into `main`, applies the same migration files to production, and deploys. Production credentials exist only as secrets of the `production` environment in the repository host and are used only by that workflow.

### Change control

- Everything through pull requests. No direct pushes to the main branch.
- Infrastructure defined as code, so what is running can be read and reviewed.
- Anything touching money, identity, permissions or the audit log needs a second reviewer, and that rule is enforced by the repository, not by good intentions. **v2:** with an AI agent doing most of the building, the agent may merge its own pull requests into staging. Changes to those protected areas must carry a recorded human approval (Ugo or Korey) before they can be promoted, and the promote workflow checks for it.
- Migrations are reversible and rehearsed against a production-sized copy before they run. Every migration has a rollback script. Applied migrations are never edited.
- The frozen pilot-freeze-v2 branch and the existing pilot database stay as the production fallback until the new build has run real shows.

### The build agent (v2)

- It holds staging credentials only and never sees production keys or data.
- It runs migrations, tests and the app itself, records every decision in the decisions log, and puts anything needing a human into a visible needs-human list instead of asking mid-task or stopping.
- Its pull requests name the requirements rows and the scaling area they touch, the migrations, and the tests added.
- It cannot approve its own promotion.

### Secrets

In a secrets manager, never in the repository, never in an environment file that gets shared, never pasted into a chat or an agent's context. Rotated on a schedule and immediately when anyone with access leaves. Automated scanning on every commit for leaked keys, with push protection on, because this is the failure that does not announce itself.

### Testing that earns its place

| Test | Covers |
|---|---|
| Permission tests | Every endpoint, for each role, including the negative cases. The most valuable tests in the codebase |
| Ledger property tests | Balances always derivable, idempotency always holds, no path creates money |
| Load tests | The realistic bad night: one popular show, thousands joining in the same minute |
| Failure drills | Camera stalls, mic dies, connection drops mid-show, using what actually happened on 20 September. **v2:** also YouTube ingest drops, a rejected stream key, a channel not enabled for live, an artist disconnecting mid-show |
| Accessibility | Contrast, tap targets, screen reader labels, reduced motion |
| **v2:** Layout and embed tests | Nothing overlaps the player at any supported width; player never under 200 x 200; five states on every screen |
| **v2:** Compositor tests | The three Versus views render correctly; corner window position and size; stage request and confirmation flow |
| **v2:** Delay alignment tests | Votes, reactions and Support line up with playback position under 3 to 10 seconds of delay |

### Before launch

An external penetration test, focused on access control between users and on the money paths. Dependency and container scanning in the pipeline. A written incident plan naming who decides, who communicates, and what the 72-hour GDPR breach notification route is.

## Knowing what is happening

The pilots showed the real risk: a camera stalled 283 times and nobody knew until afterwards. Instrumentation is not reporting, it is the ability to react during a show.

### Watch during every show

Per camera: frames arriving, stalls, reconnects. Per show: audio level on the raw input, viewers joining and leaving, comment latency, director cuts. If a camera stalls twice in a minute, the artist should see it on the Fix sheet before a viewer notices. **v2:** also egress frames out and RTMP reconnects, the YouTube broadcast state, concurrent viewers as YouTube reports them, and the measured delay between composed picture and playback.

### Watch across the product

The journey steps already listed in the design handover: sign-up started and completed with what triggered it, feed card seen, show joined and left, reminder set, Kit Check result per item, go live, end show, clip shared. Tied to the pseudonymous viewer id, never to a name. **v2:** add Versus view changes, stage request outcomes, "Bigger" used, and how often viewers leave to YouTube itself.

Every request carries a correlation id that runs through logs, traces and audit entries, so one identifier answers what happened.

### Alert on few things, and mean them

A show failing to start. Money reconciliation mismatch. Authentication failure spike. Audit log write failure, which is severe because it means we are operating blind. Error budget burn. **v2:** egress to YouTube failing for a live show, and YouTube API quota close to its limit.

Everything else is a dashboard, not a page. An on-call rota that gets woken for noise stops working within a month.

### Logs

Structured, no personal data in them, retained 90 days hot and a year cold. Personal data belongs in the database, not scattered through log files where it cannot be deleted on request.

## What to do in what order

Not everything above is launch work. What matters is doing the things now that cannot be retrofitted later.

### Do first, because retrofitting is painful

1. **v2:** The environments and the release flow (staging, production, promotion, migrations by pipeline).
2. Row-level security and the permission model, including the organisation shape even with one member.
3. The audit log, separate and append-only, before the first real user.
4. The double-entry ledger with idempotency, before any money moves.
5. Consent and preference records, including the training-data choice, with every change logged.
6. Data classification in the schema, so deletion and export can be automated rather than hand-written later.
7. Correlation ids and the journey events, because a product with no instrumentation cannot be improved.
8. **v2:** The `PlayerSource` interface and the composed-output pipeline, before any show goes public.

### Do before launch

The DPIA and the legitimate interests assessment. The Online Safety Act risk assessment and a working report queue. An external penetration test. The incident plan. The restore drill. Legal review of the training-data basis. **v2:** Google verification for the live streaming scope and a quota plan; the cookie banner and privacy notice updated for the embed; artist agreement clauses on YouTube terms, content and music rights, training data, and disconnect and deletion; a decision on what viewer-hours mean.

### Do after launch, when it is needed

SOC 2 Type II, which needs the audit log running for a year first. ISO 27001 alongside it. Enterprise single sign-on and SCIM when a deal requires them. Stronger age assurance if the regulator's expectations move. **v2:** Loudentify's own delivery (`loudentify-llhls`) when funded.

## The honest risk list

| Risk | Why it is the one to watch |
|---|---|
| Training-data basis is wrong | A model trained on an invalid basis may have to be discarded. Cheapest to fix now, with a lawyer |
| Moderation cannot keep up with live | The Act's duties do not scale down for small teams. Control the rate of new shows |
| **v2:** Cost per show-hour is unknown | Egress, compute and storage drive pricing now. Measure from the first show |
| Permission bug between users | The classic breach for a two-sided product. Permission tests are the mitigation |
| Single founder-engineer dependency | Documented architecture and infrastructure as code are what reduce it |
| **v2:** Dependence on YouTube | Rules, strikes, outages, quota and Google verification are outside our control. Keep delivery behind `PlayerSource`, keep the recording, state and money ours |
| **v2:** Viewer-hours lose their cost basis | The allowance and prepaid packs were built on media cost per viewer. Decide what they mean before pricing is published |
| **v2:** Brand credibility and leakage | Viewers can leave for YouTube. Keep chat, votes and Support in Loudentify and measure leakage |
| **v2:** Versus footage includes a second artist | Training and exclusion must work per artist on source tracks |
| **v2:** Unattended agent builds | Staging-only credentials, protected-path approvals before promotion, and a human gate on production are the controls |
