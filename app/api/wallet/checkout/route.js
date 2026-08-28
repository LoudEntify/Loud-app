import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import { getPaymentProvider } from '../../../../lib/paymentProvider';
import { CURRENCY, packByKey } from '../../../../lib/tokens';

// BUY TOKENS — step one of two.
//
// AUTH MODEL: any signed-in account (verifySession). Buying tokens is not
// an artist capability; fans are the people who buy them. 18+ is already
// enforced at account creation — every account that can reach this route
// has passed it, and re-deriving an age from a date of birth here would
// be a second, weaker copy of a rule that already has one home.
//
// ── THE CLIENT NAMES A PACK. IT NEVER NAMES A PRICE. ──
// The request body carries `pack: 'regular'` and nothing else that
// matters. The price, the currency and the token count are looked up
// server-side from lib/tokens.js and written into the intent row BEFORE
// the person leaves for the provider. This is the whole reason
// payment_intents exists: "how many tokens does this payment buy" is
// answered before the payment, by us — not after it, by whatever the
// callback happens to contain.
//
// ── NO CARD DATA ──
// This route returns a redirect URL to the provider's own hosted
// checkout. The card is entered on their domain. Nothing here accepts,
// forwards, logs or stores a card number.

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    // A closed account cannot spend money. Checked here rather than
    // relying on the ban alone, because a token minted just before
    // closure stays valid until it expires.
    if (auth.profile?.deactivated_at) {
      return NextResponse.json({ error: 'This account is closed.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const pack = packByKey(body.pack);
    if (!pack) return NextResponse.json({ error: 'Unknown token pack.' }, { status: 400 });

    const provider = getPaymentProvider();
    if (!provider) {
      return NextResponse.json(
        { error: 'No payment provider is configured on this deployment.' },
        { status: 503 }
      );
    }

    const admin = getSupabaseAdmin();

    // The intent row is written FIRST, before the provider is called. A
    // provider that times out then leaves a row saying exactly that,
    // rather than leaving no trace of a person who may well have been
    // charged.
    const { data: intent, error: intentErr } = await admin
      .from('payment_intents')
      .insert({
        user_id: auth.user.id,
        provider: provider.key,
        status: 'created',
        amount_minor: pack.amountMinor,
        currency: CURRENCY,
        tokens: pack.tokens + pack.bonus,
        pack_key: pack.key,
        metadata: { base_tokens: pack.tokens, bonus_tokens: pack.bonus, label: pack.label },
      })
      .select()
      .single();

    if (intentErr) {
      console.error('[wallet/checkout] intent insert failed:', intentErr);
      const notMigrated = /does not exist|schema cache/i.test(intentErr.message || '');
      return NextResponse.json(
        {
          error: notMigrated
            ? 'Buying tokens needs a pending database update. Nothing has been charged.'
            : 'Could not start a purchase. Nothing has been charged.',
        },
        { status: notMigrated ? 503 : 500 }
      );
    }

    // The origin the person is actually on, so the return URL comes back
    // to the same deployment. Derived from the request rather than an env
    // var specifically because preview deployments each have their own
    // hostname and a hardcoded origin would send every preview purchase
    // back to production.
    const origin = new URL(request.url).origin;

    const result = await provider.createCheckout({
      intentId: intent.id,
      pack: { ...pack, currency: CURRENCY },
      user: auth.user,
      origin,
    });

    if (result.error || !result.checkoutUrl) {
      await admin
        .from('payment_intents')
        .update({ status: 'failed', metadata: { ...intent.metadata, error: result.error || 'no checkout url' }, updated_at: new Date().toISOString() })
        .eq('id', intent.id);
      return NextResponse.json({ error: result.error || 'The payment provider did not return a checkout.' }, { status: 502 });
    }

    await admin
      .from('payment_intents')
      .update({ provider_ref: result.providerRef, status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', intent.id);

    return NextResponse.json({
      intentId: intent.id,
      checkoutUrl: result.checkoutUrl,
      provider: provider.key,
      // Surfaced so the wallet page can say "test mode" out loud instead
      // of letting someone believe a simulated purchase was a real one.
      live: provider.live,
      testMode: !!provider.testMode,
    });
  } catch (err) {
    console.error('[wallet/checkout] failed:', err);
    return NextResponse.json({ error: 'Could not start a purchase.' }, { status: 500 });
  }
}
