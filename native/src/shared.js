// native/src/shared.js — the one place the native app imports shared code
// from the web repo. Everything here is pure JavaScript with no DOM and no
// 'server-only': design tokens, the delay alignment, the guest preview
// meter, sign-up rules, metering, the compositor geometry, the booking
// rules. tests/native-shared.test.mjs proves each one loads without a
// window object.
export { color, font, silk, radius, size, breakpoint, playerFrame } from '@loud/lib/design/tokens.js';
export { voteDecision, measuredDelayMs, attributeToPrompt } from '@loud/lib/alignment.js';
export { PreviewMeter, PREVIEW_LIMIT_MS, PREVIEW_CHIP_AT_MS, GATED_ACTIONS } from '@loud/lib/guestPreview.js';
export { validateSignup, parseDateOfBirth, ageOn, MIN_AGE } from '@loud/lib/signupRules.js';
export { ViewMeter, METERING_EVENTS } from '@loud/lib/metering.js';
export { composeLayout, VERSUS_VIEWS } from '@loud/lib/pipeline/compositor.js';
export { validateBooking, earliestStart, LENGTH_OPTIONS } from '@loud/lib/schedule.js';
export { decideAction, resolveRequest } from '@loud/lib/pipeline/stageRequests.js';
