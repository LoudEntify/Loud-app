import { NextResponse } from 'next/server';
import { getPaymentProvider, devHarnessAllowed } from '../../../../lib/paymentProvider';
import { verifySession } from '../../../../lib/verifyArtistAuth';

// TASK 4 — can this deployment actually take a payment?
//
// PRD: Token economy / wallet    S&I: Stateless hosting, Auth
//
// AUTH MODEL: a verified session. Not because the answer is secret — it
// is a property of the deployment, not of the person — but because this
// is only ever rendered inside the signed-in wallet, and an endpoint
// that describes payment configuration should not be enumerable by
// anyone who happens to find the URL.
//
// ── WHY A ROUTE AT ALL, RATHER THAN AN ENV CHECK IN THE CLIENT ──
// Because the client cannot do it correctly, and the ways it might try
// are all worse:
//
//   * NEXT_PUBLIC_STRIPE_… would put a payment-configuration flag in the
//     browser bundle, where it can be stale (it is baked at BUILD time,
//     so a key added afterwards would not show up until a redeploy) and
//     where it is trivially wrong for anyone editing it in devtools.
//   * Inferring from a failed checkout means finding out by dead end,
//     which is the exact experience this task exists to remove.
//
// The server knows, because the server is the only thing holding
// STRIPE_SECRET_KEY. So the server answers.
//
// ── WHAT `live` MEANS ─────────────────────────────────────────
// `live: true` means a real provider is configured AND a purchase can
// actually complete here. That is deliberately stricter than "a provider
// object exists":
//
// The dev provider is a real provider shape with no money in it. It
// completes only via the dev harness (app/api/wallet/dev-event), and
// devHarnessAllowed() is false when VERCEL_ENV === 'production'. So on
// production with no Stripe key there is a provider that can START a
// checkout and nothing that can ever FINISH one — a dead end, which is
// precisely what was shipped and what this closes.
//
// Reported as three separate booleans rather than one, because "no
// provider", "dev provider on a preview" and "dev provider on
// production" need three different sentences in the UI.

export async function GET(request) {
  const auth = await verifySession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const provider = getPaymentProvider();
  const key = provider?.key || null;
  const canSettle = key === 'stripe' || (key === 'dev' && devHarnessAllowed());

  return NextResponse.json({
    provider: key,                 // 'stripe' | 'dev' | null
    live: !!provider && canSettle, // can a purchase actually complete here
    simulated: key === 'dev' && canSettle,
    reason: !provider
      ? 'no_provider'
      : canSettle
        ? null
        : 'provider_cannot_settle',
    // The sentence the wallet shows. Written here, next to the logic that
    // decides it, so the two cannot drift — a UI that infers its own
    // copy from three booleans is a UI that will eventually say the
    // wrong one.
    message: !provider
      ? 'Payments are not set up on this deployment yet.'
      : canSettle
        ? (key === 'dev' ? 'No payment provider is connected — purchases here are simulated.' : null)
        : 'Payments are not connected yet, so tokens cannot be bought here.',
  });
}
