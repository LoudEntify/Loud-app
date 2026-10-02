// lib/player/youtube.js
// ─────────────────────────────────────────────────────────────
// The YouTube PlayerSource. Embeds the show's live video id through the
// IFrame Player API from the privacy-enhanced domain
// (youtube-nocookie.com), as docs/YOUTUBE_ADDENDUM.md requires.
//
// It is only ever created AFTER cookie consent for the embed
// (lib/consent.js) — the screen shows the consent card in the player's
// box instead until then. Nothing is placed over the iframe: the box the
// layout gives us is the iframe, full stop.
//
// Position comes from player.getCurrentTime(); for a live stream YouTube
// reports seconds since the start of the stream the viewer joined, which
// is exactly "where the viewer is", a few seconds behind the server.
// ─────────────────────────────────────────────────────────────
import { makeStateReporter } from './PlayerSource.js';

let apiPromise = null;
function loadIframeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => reject(new Error('YouTube player script failed to load'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('YouTube player script timed out')), 15000);
  });
  return apiPromise;
}

export function createYouTubeSource(show) {
  const videoId = show?.youtube_video_id;
  let player = null;
  let host = null;
  let report = () => {};
  let destroyed = false;

  return {
    kind: 'youtube',
    async mount(el, opts = {}) {
      report = makeStateReporter(opts);
      report('loading');
      if (!videoId) {
        report('error');
        opts.onError?.('This show has no YouTube video yet.');
        return this;
      }
      host = document.createElement('div');
      host.setAttribute('data-player-source', 'youtube');
      host.style.cssText = 'width:100%;height:100%;display:block';
      el.appendChild(host);
      try {
        const YT = await loadIframeApi();
        if (destroyed) return this;
        player = new YT.Player(host, {
          host: 'https://www.youtube-nocookie.com',
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { autoplay: opts.autoplay === false ? 0 : 1, playsinline: 1, rel: 0, modestbranding: 1, controls: 1 },
          events: {
            onReady: () => report('ready'),
            onStateChange: (e) => {
              const S = YT.PlayerState;
              if (e.data === S.PLAYING) report('playing');
              else if (e.data === S.PAUSED) report('paused');
              else if (e.data === S.BUFFERING) report('buffering');
              else if (e.data === S.ENDED) report('ended');
            },
            onError: (e) => { report('error'); opts.onError?.(`YouTube player error ${e?.data}`); },
          },
        });
      } catch (e) {
        report('error');
        opts.onError?.(e.message);
      }
      return this;
    },
    play() { try { player?.playVideo?.(); } catch { /* ignore */ } },
    pause() { try { player?.pauseVideo?.(); } catch { /* ignore */ } },
    positionMs() {
      try {
        const t = player?.getCurrentTime?.();
        return Number.isFinite(t) ? Math.round(t * 1000) : null;
      } catch { return null; }
    },
    setVersusView() { /* the compositor already drew it */ },
    destroy() {
      destroyed = true;
      try { player?.destroy?.(); } catch { /* ignore */ }
      host?.remove();
      player = null;
    },
  };
}
