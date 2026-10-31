// lib/orientation.js — a show is portrait or landscape, and the artist
// chooses which when they book it.
//
// Why it is a choice rather than a constant: the two shapes are for two
// different audiences, and an artist knows which they are playing to.
//
//   portrait (9:16)   how a phone is held and how a phone is watched. It is
//                     the shape our own feed wants, and the shape a clip
//                     wants when it is cut for Shorts, Reels or TikTok. A
//                     landscape show cut into a vertical clip has to be
//                     cropped, and the crop throws away either the guitar
//                     or the face.
//   landscape (16:9)  YouTube's own shape. A landscape show fills a laptop
//                     or a television instead of sitting in a letterbox
//                     between two black bars, which is what a portrait
//                     stream looks like on a desktop YouTube page.
//
// Everything downstream reads the show's orientation from here rather than
// assuming: the composed frame, the player's box, what the camera phone is
// told to do, and what a clip is cut from.
//
// PRD rows 99, 139, 143. S&I: Real-time media.

export const ORIENTATIONS = ['portrait', 'landscape'];
export const DEFAULT_ORIENTATION = 'portrait';

/** The composed broadcast frame for each shape, at 1080p. */
export const FRAME = Object.freeze({
  portrait: { w: 1080, h: 1920 },
  landscape: { w: 1920, h: 1080 },
});

/** What the artist is choosing between, in their own words. */
export const ORIENTATION_CHOICES = Object.freeze([
  {
    key: 'portrait',
    label: 'Portrait',
    shape: '9:16',
    note: 'Fills a phone. Best for our feed, and clips cut straight to Shorts, Reels or TikTok.',
    youtube: 'On YouTube it plays as a vertical video, full screen on a phone and letterboxed on a laptop.',
  },
  {
    key: 'landscape',
    label: 'Landscape',
    shape: '16:9',
    note: 'Fills a laptop or a television. The shape YouTube was built for.',
    youtube: 'On YouTube it plays full width everywhere. A vertical clip has to be cropped from it afterwards.',
  },
]);

export const normaliseOrientation = (o) => (ORIENTATIONS.includes(o) ? o : DEFAULT_ORIENTATION);

/** The show's orientation, wherever the row came from. */
export const showOrientation = (show) => normaliseOrientation(show?.orientation);

/** The composed frame for a show: { w, h, aspect, orientation }. */
export function frameFor(show) {
  const orientation = showOrientation(show);
  const { w, h } = FRAME[orientation];
  return { orientation, w, h, aspect: w / h };
}

/** Height over width, which is what a CSS box and the player layout want. */
export const aspectRatioOf = (orientation) => {
  const { w, h } = FRAME[normaliseOrientation(orientation)];
  return h / w;
};

/**
 * Is this phone held the right way for this show? The camera can publish
 * either way round, but a portrait phone in a landscape show gives viewers
 * a tall picture inside a wide frame, which is the kind of thing nobody
 * notices until the recording.
 */
export function mountAdvice(orientation, physical) {
  const want = normaliseOrientation(orientation);
  const have = physical === 'landscape' || physical === 'portrait' ? physical : null;
  if (!have) return { ok: true, message: null };
  if (have === want) return { ok: true, message: null };
  return {
    ok: false,
    message: want === 'landscape'
      ? 'This show is landscape: turn the phone on its side, or viewers get a tall picture with bars either side.'
      : 'This show is portrait: stand the phone up tall, or viewers get a wide picture with bars above and below.',
  };
}

/** One line for the booking screen and the console, so nobody has to remember what the shapes mean. */
export function describeOrientation(orientation) {
  const o = normaliseOrientation(orientation);
  const choice = ORIENTATION_CHOICES.find((c) => c.key === o);
  return `${choice.label} (${choice.shape}): ${choice.note}`;
}
