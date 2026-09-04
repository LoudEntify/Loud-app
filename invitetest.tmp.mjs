import { chromium } from 'playwright';
const BASE=process.env.SMOKE_URL, BYPASS=process.env.VERCEL_AUTOMATION_BYPASS;
const b=await chromium.launch();
const ctx=await b.newContext({extraHTTPHeaders:BYPASS?{'x-vercel-protection-bypass':BYPASS}:{}});
const p=await ctx.newPage();
await p.goto(`${BASE}/auth`,{waitUntil:'domcontentloaded'});
await p.getByPlaceholder(/email/i).first().fill(process.env.SMOKE_EMAIL);
await p.getByPlaceholder(/password/i).first().fill(process.env.SMOKE_PASSWORD);
await Promise.all([p.waitForLoadState('networkidle').catch(()=>{}),p.getByRole('button',{name:/LOG IN/i}).last().click()]);
await p.waitForTimeout(3500);

const out = await p.evaluate(async () => {
  const raw = Object.keys(localStorage).find(k=>k.includes('auth-token'));
  const tok = raw ? JSON.parse(localStorage.getItem(raw))?.access_token : null;
  const log = {};

  // 1. find an artist to invite
  const s = await (await fetch('/api/artists/search?q=ad',{headers:{Authorization:`Bearer ${tok}`}})).json();
  const target = (s.artists||[])[0];
  log.target = target ? { id: target.id, name: target.display_name||target.username } : null;
  if (!target) return log;

  // 2. create a versus show, well in the future so it disturbs nothing
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  return { ...log, needsShow: true, targetId: target.id };
});
console.log('search target:', JSON.stringify(out.target));
await b.close();
