import { chromium } from 'playwright';
const BASE=process.env.SMOKE_URL, BYPASS=process.env.VERCEL_AUTOMATION_BYPASS;
const b=await chromium.launch();
const ctx=await b.newContext({extraHTTPHeaders:BYPASS?{'x-vercel-protection-bypass':BYPASS}:{}});
const p=await ctx.newPage();
p.on('console', m => { const t=m.text(); if(/invite|notif/i.test(t)) console.log('  [page]', t.slice(0,160)); });
await p.goto(`${BASE}/auth`,{waitUntil:'domcontentloaded'});
await p.getByPlaceholder(/email/i).first().fill(process.env.SMOKE_EMAIL);
await p.getByPlaceholder(/password/i).first().fill(process.env.SMOKE_PASSWORD);
await Promise.all([p.waitForLoadState('networkidle').catch(()=>{}),p.getByRole('button',{name:/LOG IN/i}).last().click()]);
await p.waitForTimeout(4000);
console.log('console:', p.url());

// ---- schedule a Versus show, tomorrow late, minimal exposure ----
const d = new Date(Date.now() + 24*3600*1000);
const date = d.toISOString().slice(0,10);
await p.getByPlaceholder(/What are you calling this one/i).fill('ZZ invite probe (delete me)');
await p.locator('input[type="date"]').fill(date);
await p.locator('input[type="time"]').fill('23:30');
await p.getByRole('button', { name: /^VERSUS$/i }).click().catch(()=>{});
await p.waitForTimeout(400);
const scheduleBtn = p.getByRole('button', { name: /SCHEDULE|ADD TO DIARY|PUT IT IN/i }).first();
console.log('schedule button:', await scheduleBtn.textContent().catch(()=>'(not found)'));
await scheduleBtn.click();
await p.waitForTimeout(4000);

// ---- the picker on the new card ----
const picker = p.getByPlaceholder(/Search for the other artist/i).first();
console.log('picker visible:', await picker.isVisible().catch(()=>false));
await picker.fill('ad');
await p.waitForTimeout(1800);
const inviteBtn = p.getByRole('button', { name: /adex/i }).first();
console.log('adex row visible:', await inviteBtn.isVisible().catch(()=>false));
await inviteBtn.click();
await p.waitForTimeout(4000);

const body = await p.locator('body').innerText();
const m = body.match(/Invited [^\n]*\n[^\n]*/);
console.log('--- result on the card ---');
console.log(m ? m[0] : '(no "Invited …" block found)');
console.log('notified wording present:', /have been notified in Loudentify/i.test(body));
console.log('fallback wording present:', /could not notify them/i.test(body));
await b.close();
