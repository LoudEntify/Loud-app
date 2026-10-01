# design/ : approved screens (reference, not production code)

Each `*.dc.html` is one screen at its real size: phone 390 wide, Fold or tablet 768, computer and website 1440. They are laid out with inline styles, so read the markup for spacing, colours, copy and states. `canvas.json` lists every board with its title and where it sits.

Groups: first minute and sign-up; Discover, Live and the show; profiles, inbox, wallet; artist show flow (Create, Schedule, KitCheck, Countdown, Console, FixSheet, PostShow, ClipEditor, Insights, CameraMode); Settings; the five states; computer app (Web*); website (WebHome, WebLiveUpcoming, WebShowPage and others); Fold and tablet.

YouTube viewer variant (build this first for viewing): YT-Waiting, YT-Show, YT-Focus, YT-Prompt, YT-GuestSignUp, YT-VersusTalk, YT-Versus (Artist A performing), YT-VersusB, YT-FoldShow, YT-FoldVersus, WebYT-Show, WebYT-VersusTalk, WebYT-VersusA, WebYT-ShowPage.
Artist side for Versus: YT-ArtistTalk, YT-ArtistRequest, YT-ArtistHandover, YT-ArtistPerform, YT-KitCheck, WebYT-Artist.
Where a YT- or WebYT- board and an older board cover the same screen, the YT board wins for viewers. Read `docs/YOUTUBE_ADDENDUM.md` with them.

Notes: `[Square brackets]` are data to bind. The grey 9:16 box in YT boards is the YouTube player, so nothing may sit over it. Logo images are referenced by internal ids and are not in this folder: ask Korey for the logo files (listed in NEEDS_KOREY.md).
