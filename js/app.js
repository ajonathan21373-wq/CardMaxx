/* ---------- Data ---------- */
/* Data lives in /data/*.json so it can be updated without touching code. */
let CATS, CHIP_ORDER, MERCHANTS, CURRENCIES, CARDS, DATA_UPDATED;
async function loadData(){
  const get = p => fetch(p,{cache:'no-cache'}).then(r=>{ if(!r.ok) throw new Error(p+' '+r.status); return r.json(); });
  const [c,m,k] = await Promise.all([get('data/categories.json'),get('data/merchants.json'),get('data/cards.json')]);
  CATS=c.categories; CHIP_ORDER=c.chipOrder; CURRENCIES=k.currencies; CARDS=k.cards; DATA_UPDATED=k.updated;
  MERCHANTS=m.merchants.map(x=>({n:x.name,c:x.category,a:x.aliases||[],note:x.note}));
}
/* ---------- State ---------- */
const DEFAULT_STATE = {on:{amex:true,citi:true,jetblue:true,discover:true,savor:true}, jbVariant:'plus', discActivated:false, discSpent:0,
  cpp:{mr:1.6,aa:1.5,tb:1.3,cash:1}, amount:20, last:{type:'merchant',key:'Chipotle'}, tab:null,
  profile:{goal:null, airline:'none', spend:{dining:300,grocery:250,gas:120,streaming:30,entertainment:50,utilities:0,flights:50,retail:400}}};
let S = load();
function load(){
  try{ const raw = localStorage.getItem('cardmaxx-v1'); if(raw){ const s = JSON.parse(raw); const p = s.profile||{};
    return {...DEFAULT_STATE,...s,on:{...DEFAULT_STATE.on,...(s.on||{})},cpp:{...DEFAULT_STATE.cpp,...(s.cpp||{}),cash:1},
      profile:{...DEFAULT_STATE.profile,...p,spend:{...DEFAULT_STATE.profile.spend,...(p.spend||{})}}}; } }catch(e){}
  return structuredClone(DEFAULT_STATE);
}
function save(){ try{ localStorage.setItem('cardmaxx-v1', JSON.stringify(S)); }catch(e){} }

/* ---------- Logic ---------- */
const today = new Date();
const ymd = d => d.toISOString().slice(0,10);
function activeRotation(card){
  if(!card.rotating) return null;
  const t = ymd(new Date(today.getTime()-today.getTimezoneOffset()*60000));
  return card.rotating.find(r => t>=r.start && t<=r.end) || null;
}
function cardRates(card){ return card.variants ? card.variants[S.jbVariant].rates : card.rates; }
function cardName(card){ return card.variants ? card.variants[S.jbVariant].name : card.name; }

function earn(card, cat, base=false){
  const rates = cardRates(card);
  let rate = rates[cat] ?? rates.other;
  let flag = null;
  const rot = base ? null : activeRotation(card);
  if(rot && rot.cats.includes(cat)){
    const left = Math.max(0, rot.cap - (Number(S.discSpent)||0));
    if(!S.discActivated) flag = {kind:'activate', rot};
    else if(left<=0) flag = {kind:'capped', rot};
    else { rate = rot.rate; flag = {kind:'bonus', rot, left}; }
  }
  const cpp = card.cur==='cash' ? 1 : Number(S.cpp[card.cur])||0;
  return {card, rate, cents: rate*cpp, flag};
}
function rateText(e){
  const c = e.card; const r = e.rate;
  if(c.cur==='cash') return `${r}% cash back`;
  const unit = {mr:'Membership Rewards',aa:'AAdvantage miles',tb:'TrueBlue points'}[c.cur];
  return `${r}x ${unit} at ${fmtC(S.cpp[c.cur])}`;
}
const fmtC = v => `${(+v).toFixed(v%1? (Math.round(v*10)===v*10?1:2):0)}¢`;
const fmtCents = v => `${(Math.round(v*10)/10).toFixed(1)}¢`;
const money = v => `$${v.toFixed(2)}`;

function rank(cat){
  return CARDS.filter(c=>S.on[c.id]).map(c=>earn(c,cat)).sort((a,b)=>b.cents-a.cents || (b.card.cur==='cash')-(a.card.cur==='cash') || (a.card.net==='amex')-(b.card.net==='amex'));
}

function notesFor(cat, ranked, merchant){
  const out = [];
  const top = ranked[0];
  if(merchant && merchant.note) out.push({t:merchant.note, warn: merchant.c==='wholesale'});
  ranked.forEach(e=>{
    if(e.flag?.kind==='activate') out.push({warn:true, t:`<b>Discover is paying 5% on ${e.flag.rot.catsText} this quarter</b>, but only once you activate it in the Discover app. After activating, flip the switch in Your wallet below.`});
    if(e.flag?.kind==='capped') out.push({warn:true, t:`You've hit Discover's $${e.flag.rot.cap.toLocaleString()} bonus cap for ${e.flag.rot.q}, so it's back to 1% here.`});
    if(e.flag?.kind==='bonus' && e===top) out.push({t:`Discover 5% applies to the next ${money(e.flag.left)} of combined ${e.flag.rot.catsText} spending this quarter.`});
  });
  if(top && top.card.id==='amex' && top.cents>0){
    const backup = ranked.find(e=>e.card.net!=='amex');
    if(backup) out.push({t:`Some places don't take Amex. Backup: <b>${cardName(backup.card)}</b> (${fmtCents(backup.cents)} per $1).`});
  }
  if(S.on.amex){
    if(cat==='dining') out.push({t:'Amex Gold earns 4x at restaurants worldwide, including takeout and delivery, on up to $50,000 a year. Its dining credit also applies at Resy restaurants (enrollment required).'});
    if(cat==='grocery') out.push({t:'Amex Gold earns 4x at U.S. supermarkets only (an annual cap applies). Superstores and warehouse clubs earn 1x.'});
    if(['aa','jetblue','airline'].includes(cat)) out.push({t:'Amex Gold earns 3x only on flights booked directly with the airline or through Amex Travel.'});
  }
  if(merchant && merchant.n==="Dunkin'" && S.on.amex) out.push({t:"Amex Gold has a Dunkin' credit when you enroll and pay with the card."});
  if(cat==='hotel') out.push({t:'Booking through a card\'s travel site earns more: Savor gets 5% on hotels via Capital One Travel, and Amex Gold gets 5x on prepaid hotels via Amex Travel. Booked direct, all your cards earn the base rate.'});
  if(cat==='superstore' || cat==='wholesale' || cat==='retail') out.push({t:'None of your cards have a bonus here, so any card earns the base rate. Use the one with the most valuable points.'});
  return out;
}

/* ---------- Search ---------- */
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’']/g,'').replace(/[^a-z0-9+ ]/g,' ').replace(/\s+/g,' ').trim();
function search(q){
  const n = norm(q); if(!n) return [];
  const res = [];
  MERCHANTS.forEach(m=>{
    const names = [m.n, ...m.a].map(norm);
    let score = 0;
    names.forEach(x=>{ if(x===n) score=Math.max(score,100); else if(x.startsWith(n)) score=Math.max(score,80); else if(x.includes(n)) score=Math.max(score,50); });
    if(score) res.push({type:'merchant', key:m.n, label:m.n, sub:CATS[m.c].label, score});
  });
  Object.entries(CATS).forEach(([k,c])=>{
    const words = [c.label, ...c.words].map(norm);
    let score = 0;
    words.forEach(w=>{ if(w===n) score=Math.max(score,90); else if(w.startsWith(n) && n.length>=3) score=Math.max(score,60); else if(n.includes(w) && w.length>=4) score=Math.max(score,55); });
    if(score) res.push({type:'cat', key:k, label:c.label, sub:'Category', score});
  });
  return res.sort((a,b)=>b.score-a.score).slice(0,6);
}

/* ---------- Render ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function renderPill(){
  const any = CARDS.map(activeRotation).find(Boolean);
  const d = today.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  $('qpill').textContent = any ? `${any.q} · ${d}` : d;
}
function renderChips(){
  const activeCat = S.last.type==='cat' ? S.last.key : null;
  $('chips').innerHTML = CHIP_ORDER.map(k=>`<button class="chip${k===activeCat?' on':''}" data-cat="${k}" type="button">${CATS[k].label}</button>`).join('');
}

function renderResult(){
  const r = $('result');
  let cat, merchant=null, title;
  if(S.last.type==='merchant'){ merchant = MERCHANTS.find(m=>m.n===S.last.key); if(!merchant){S.last={type:'cat',key:'dining'};return renderResult();} cat = merchant.c; title = merchant.n; }
  else if(S.last.type==='unknown'){
    r.innerHTML = `<div class="empty"><b style="color:var(--ink)">“${esc(S.last.key)}” isn't in the list yet.</b><br>Pick the closest category above and CardMaxx will rank your cards for it.</div>`;
    return;
  } else { cat = S.last.key; title = CATS[cat].label; }
  const ranked = rank(cat);
  if(!ranked.length){ r.innerHTML = `<div class="empty">Turn on at least one card in Your wallet below.</div>`; return; }
  const top = ranked[0], max = top.cents||1;
  const amt = Math.max(0, Number(S.amount)||0);
  const tie = ranked.filter(e=>Math.abs(e.cents-top.cents)<0.001).length>1;
  const c = CATS[cat];
  const netLabel = {amex:'Amex',mc:'Mastercard',discover:'Discover'}[top.card.net];
  r.innerHTML = `
    <div class="rhead">
      <div><div class="label">Best card for</div><h2>${esc(title)}</h2><div class="mcc">Usually codes as MCC ${c.mcc} · ${c.mccName}</div></div>
      <label class="amt" for="amt">Spending $<input id="amt" type="number" min="0" step="1" inputmode="decimal" value="${amt}"></label>
    </div>
    <div class="plastic" style="background:${top.card.grad}">
      <div class="top"><div class="chipgfx" aria-hidden="true"></div><span class="tag">${tie?'Tied best':'Use this'} · ${netLabel}</span></div>
      <div>
        <div class="cname">${esc(cardName(top.card))}</div>
        <div class="big">${fmtCents(top.cents)}<small>back per $1</small></div>
        <div class="how">${esc(rateText(top))} · about ${money(amt*top.cents/100)} on ${money(amt)}</div>
      </div>
    </div>
    <div class="label">Your whole wallet, ranked</div>
    <ol class="rank">${ranked.map(e=>`
      <li><span class="sw" style="background:${e.card.grad}"></span>
        <div class="nm">${esc(cardName(e.card))}<div class="rt">${esc(rateText(e))}${e.flag?.kind==='activate'?' · 5% if activated':''}</div></div>
        <div class="val">${fmtCents(e.cents)}<div class="rt">${money(amt*e.cents/100)}</div></div>
        <div class="bar"><i style="width:${Math.max(3,e.cents/max*100)}%"></i></div></li>`).join('')}
    </ol>
    <ul class="notes">${notesFor(cat,ranked,merchant).map(n=>`<li class="${n.warn?'warn':''}">${n.t}</li>`).join('')}</ul>`;
  $('amt').addEventListener('input', e=>{ S.amount = e.target.value; save(); updateAmounts(); });
}
function updateAmounts(){ // re-render without losing focus on the amount box
  const pos = $('amt').selectionStart; renderResult(); const a=$('amt'); a.focus(); try{a.setSelectionRange(pos,pos);}catch(e){}
}

function renderWallet(){
  $('walletList').innerHTML = CARDS.map(c=>{
    const rot = activeRotation(c);
    let extra = '';
    if(c.variants) extra = `<div class="extra"><label for="jbv">Which JetBlue card?</label><select id="jbv"><option value="plus"${S.jbVariant==='plus'?' selected':''}>JetBlue Plus (6x JetBlue)</option><option value="basic"${S.jbVariant==='basic'?' selected':''}>JetBlue Card, no annual fee (3x JetBlue)</option></select></div>`;
    if(c.id==='discover') extra = rot
      ? `<div class="extra"><label class="switch"><input type="checkbox" id="dact"${S.discActivated?' checked':''}> I activated ${rot.q}</label><label for="dsp">Bonus spend so far $</label><input type="number" id="dsp" min="0" step="1" value="${S.discSpent}"></div>`
      : `<div class="extra">Next quarter's 5% categories aren't loaded yet, so Discover counts as 1% everywhere for now.</div>`;
    const r = cardRates(c);
    const desc = Object.entries(r).filter(([k])=>k!=='other').map(([k,v])=>`${v}${c.cur==='cash'?'%':'x'} ${CATS[k].label.toLowerCase()}`).join(', ');
    const sub = c.id==='discover' ? (rot?`5% on ${rot.catsText} (${rot.q}, up to $${rot.cap.toLocaleString()}), 1% else`:'1% on everything') : `${desc}, ${r.other}${c.cur==='cash'?'%':'x'} else`;
    return `<div class="wcard"><span class="sw" style="background:${c.grad}"></span>
      <label class="switch" for="on-${c.id}" style="font-weight:500">${esc(cardName(c))}</label>
      <input type="checkbox" id="on-${c.id}" data-card="${c.id}"${S.on[c.id]?' checked':''} aria-label="Use ${esc(cardName(c))}">
      <div class="sub">${esc(sub)}</div>${extra}</div>`;
  }).join('');
  $('cppList').innerHTML = Object.entries(CURRENCIES).filter(([k])=>k!=='cash').map(([k,v])=>`
    <label for="cpp-${k}">${v.label}</label><input type="number" id="cpp-${k}" data-cur="${k}" min="0" max="5" step="0.1" value="${S.cpp[k]}">
    <small>${v.hint}</small>`).join('');
}

/* ---------- Plan ---------- */
const GOALS = {
  travel:{label:'Travel', blurb:'Free flights and hotel stays', cpp:{mr:1.6,aa:1.5,tb:1.3}},
  cash:{label:'Cash back & reimbursements', blurb:'Money back and statement credits', cpp:{mr:0.6,aa:1.0,tb:1.0}},
  mix:{label:'A mix', blurb:'Some trips, some cash', cpp:{mr:1.1,aa:1.2,tb:1.1}}
};
const AIRLINES = {aa:'American', jetblue:'JetBlue', none:'No preference'};
const SPEND = [['dining','Dining'],['grocery','Groceries'],['gas','Gas'],['streaming','Streaming'],['entertainment','Entertainment'],['utilities','Utilities'],['flights','Flights'],['retail','Shopping & everything else']];
const AMEX_FEE = 325;
const dollars = v => `$${Math.round(v).toLocaleString()}`;
function planCat(k){ if(k==='flights') return S.profile.airline==='none' ? 'airline' : S.profile.airline; return k; }
function bestBase(cat, excl){ return CARDS.filter(c=>S.on[c.id] && c.id!==excl).map(c=>earn(c,cat,true)).sort((a,b)=>b.cents-a.cents || (b.card.cur==='cash')-(a.card.cur==='cash'))[0]; }
function annual(excl){
  let total=0; const rows=[];
  SPEND.forEach(([k,label])=>{ const m = Number(S.profile.spend[k])||0; const b = bestBase(planCat(k), excl); if(!b) return;
    const v = m*12*b.cents/100; total+=v; rows.push({k,label,m,b,v}); });
  return {total, rows};
}

function renderProfileForm(){
  const p = S.profile;
  $('profileForm').innerHTML = `
    <fieldset><legend>What do you want from your cards?</legend>
      <div class="goals">${Object.entries(GOALS).map(([k,g])=>`<label class="goal"><input type="radio" name="goal" value="${k}"${p.goal===k?' checked':''}><b>${g.label}</b><span>${g.blurb}</span></label>`).join('')}</div>
    </fieldset>
    <fieldset><legend>Which airline do you fly most?</legend>
      <div class="seg">${Object.entries(AIRLINES).map(([k,l])=>`<label><input type="radio" name="airline" value="${k}"${p.airline===k?' checked':''}>${l}</label>`).join('')}</div>
    </fieldset>
    <fieldset><legend>Roughly what do you spend each month?</legend>
      <p class="hint">Starter numbers are filled in. Change them to match you; they only stay in this browser.</p>
      <div class="spend">${SPEND.map(([k,l])=>`<label for="sp-${k}">${l}<input type="number" id="sp-${k}" data-spend="${k}" min="0" step="10" inputmode="numeric" value="${p.spend[k]}"></label>`).join('')}</div>
    </fieldset>`;
  $('psum').textContent = p.goal ? `${GOALS[p.goal].label} · ${AIRLINES[p.airline]}` : 'Not set up yet';
  $('profileBox').open = !p.goal;
}

function renderPlan(){
  const p = S.profile, out = $('planOut');
  if(!p.goal){ out.innerHTML = `<div class="empty"><b style="color:var(--ink)">Pick a goal above to get your plan.</b><br>CardMaxx will value your points for that goal, pick a card for each kind of spending, and list what to do next.</div>`; return; }
  const {total, rows} = annual();
  const withoutAmex = S.on.amex ? annual('amex').total : total;
  const amexGain = total - withoutAmex;
  const acts = [];
  const disc = CARDS.find(c=>c.id==='discover'), rot = activeRotation(disc);
  if(S.on.discover && rot && !S.discActivated) acts.push({u:true, t:`Activate Discover's ${rot.q} bonus`, d:`Your Discover card pays 5% on ${rot.catsText} through ${new Date(rot.end+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}, on up to $${rot.cap.toLocaleString()}, but only after you activate it in the Discover app. Then check the box in Which card → Your wallet.`});
  else if(S.on.discover && rot) acts.push({t:`Use Discover first for ${rot.catsText}`, d:`5% beats everything else in your wallet there until you hit the $${rot.cap.toLocaleString()} quarterly cap. This plan's yearly total leaves the rotating bonus out, since the categories change every quarter.`});

  if(p.goal==='travel' || p.goal==='mix'){
    if(p.airline==='aa') acts.push({t:'Build your American Airlines balance', d:'Book AA flights directly with the airline. Amex Gold earns 3x there, and your Citi card adds AA perks like a free first checked bag. Put gas on the Citi card for 2x miles.'});
    else if(p.airline==='jetblue') acts.push({t:'Put JetBlue flights on your JetBlue card', d:`Your ${cardName(CARDS.find(c=>c.id==='jetblue'))} earns ${cardRates(CARDS.find(c=>c.id==='jetblue')).jetblue}x on JetBlue purchases, more than any other card you have.${S.jbVariant==='plus'?' The Plus card also gives back 10% of the points you spend on JetBlue award flights.':''}`});
    else acts.push({t:'Make Amex points your main stash', d:'Membership Rewards transfer to many airline and hotel programs, so they stay useful whichever airline is cheapest. Your airline miles only work with one program each.'});
    acts.push({t:'Book hotels through Amex Travel when it makes sense', d:'Prepaid hotels booked through Amex Travel earn 5x on the Gold card, and stays of two nights or more at The Hotel Collection come with a $100 property credit.'});
    acts.push({t:"Don't cash out Amex points", d:'Used as a statement credit, Membership Rewards are worth about 0.6¢ each. Transferred to an airline, they are usually worth much more.'});
  }
  if(p.goal==='cash' || p.goal==='mix'){
    if(S.on.savor) acts.push({t:'Move restaurants and groceries to SavorOne', d:`At cash-out value, Amex Gold's 4x works out to about ${(4*S.cpp.mr).toFixed(1)}% back. SavorOne pays a straight 3% at restaurants and grocery stores, with no cap.`});
    acts.push({t:'Treat your card credits as reimbursements', d:"Amex Gold gives monthly Uber Cash plus dining credits at Resy restaurants and Dunkin' (enrollment required). Only count them if you'd spend that money anyway."});
    acts.push({t:'Check whether Discover will double your first year', d:'If you opened your Discover card within the past 12 months, Discover matches all the cash back you earn in your first year.'});
  }
  if(S.on.amex){
    const need = AMEX_FEE - amexGain;
    acts.push(need<=0
      ? {t:'Amex Gold pays for itself', d:`At your goal's point values, it earns about ${dollars(amexGain)} more a year than your other cards would. That covers the $${AMEX_FEE} fee before counting any credits.`}
      : {u: p.goal==='cash', t:`Make sure Amex Gold earns its $${AMEX_FEE} fee`, d:`At your goal's point values, it adds about ${dollars(amexGain)} a year over your other cards. It's worth keeping only if you actually use at least ${dollars(need)} of its credits each year.`});
  }
  const goalWord = {travel:'travel', cash:'cash', mix:'mixed'}[p.goal];
  out.innerHTML = `
    <div class="total"><span class="label" style="color:inherit;opacity:.75">Estimated rewards per year</span>
      <span class="big">${dollars(total)}</span>
      <span class="sm">Valued for ${goalWord} goals, using the best card for each kind of spending.</span></div>
    <div class="label">Your card for each kind of spending</div>
    <ul class="ptable">${rows.map(r=>`<li><span class="sw" style="background:${r.b.card.grad}"></span>
      <div class="cat">${r.label}${r.k==='flights'&&p.airline!=='none'?` (${AIRLINES[p.airline]})`:''}<div class="rt">${esc(cardName(r.b.card))} · ${esc(rateText(r.b))}</div></div>
      <div class="val">${dollars(r.v)}<div class="rt">per year</div></div></li>`).join('')}</ul>
    <div class="label">What to do next</div>
    <ol class="actions">${acts.map(a=>`<li class="${a.u?'urgent':''}"><b>${a.t}</b><p>${a.d}</p></li>`).join('')}</ol>`;
}

function setTab(t){
  S.tab = t; save();
  $('payView').hidden = t!=='pay'; $('planView').hidden = t!=='plan';
  $('tab-pay').setAttribute('aria-selected', t==='pay'); $('tab-plan').setAttribute('aria-selected', t==='plan');
}

function renderAll(){ renderPill(); renderChips(); renderResult(); renderWallet(); renderProfileForm(); renderPlan(); setTab(S.tab || (S.profile.goal?'pay':'plan')); }

document.querySelector('.tabs').addEventListener('click', e=>{ const b=e.target.closest('button'); if(b) setTab(b.dataset.tab); });
$('profileForm').addEventListener('change', e=>{
  const t = e.target;
  if(t.name==='goal'){ S.profile.goal=t.value; S.cpp={...S.cpp,...GOALS[t.value].cpp}; $('psum').textContent = `${GOALS[t.value].label} · ${AIRLINES[S.profile.airline]}`; renderWallet(); renderResult(); }
  if(t.name==='airline'){ S.profile.airline=t.value; if(S.profile.goal) $('psum').textContent = `${GOALS[S.profile.goal].label} · ${AIRLINES[t.value]}`; }
  save(); renderPlan();
});
$('profileForm').addEventListener('input', e=>{ const t=e.target; if(t.dataset.spend){ S.profile.spend[t.dataset.spend]=Math.max(0,Number(t.value)||0); save(); renderPlan(); } });

/* ---------- Events ---------- */
let sel = -1, hits = [];
function showSugg(){
  const box = $('sugg');
  if(!hits.length){ box.hidden = true; $('q').setAttribute('aria-expanded','false'); return; }
  box.innerHTML = hits.map((h,i)=>`<li role="option"><button type="button" data-i="${i}" class="${i===sel?'on':''}"><span>${esc(h.label)}</span><small>${esc(h.sub)}</small></button></li>`).join('');
  box.hidden = false; $('q').setAttribute('aria-expanded','true');
}
function pick(h){ S.last = {type:h.type, key:h.key}; save(); $('q').value = h.type==='merchant'?h.label:''; hits=[]; showSugg(); renderChips(); renderResult(); }
$('q').addEventListener('input', e=>{ hits = search(e.target.value); sel = hits.length?0:-1; showSugg(); });
$('q').addEventListener('keydown', e=>{
  if(e.key==='ArrowDown' && hits.length){ sel=(sel+1)%hits.length; showSugg(); e.preventDefault(); }
  else if(e.key==='ArrowUp' && hits.length){ sel=(sel-1+hits.length)%hits.length; showSugg(); e.preventDefault(); }
  else if(e.key==='Enter'){
    e.preventDefault();
    if(hits[sel]) pick(hits[sel]);
    else if(e.target.value.trim()){ S.last={type:'unknown',key:e.target.value.trim()}; renderChips(); renderResult(); }
  } else if(e.key==='Escape'){ hits=[]; showSugg(); }
});
$('sugg').addEventListener('click', e=>{ const b = e.target.closest('button'); if(b) pick(hits[+b.dataset.i]); });
document.addEventListener('click', e=>{ if(!e.target.closest('.field')){ hits=[]; showSugg(); } });
$('chips').addEventListener('click', e=>{ const b=e.target.closest('.chip'); if(!b) return; $('q').value=''; S.last={type:'cat',key:b.dataset.cat}; save(); renderChips(); renderResult(); });
$('walletList').addEventListener('change', e=>{
  const t = e.target;
  if(t.dataset.card){ S.on[t.dataset.card]=t.checked; }
  else if(t.id==='jbv'){ S.jbVariant=t.value; renderWallet(); }
  else if(t.id==='dact'){ S.discActivated=t.checked; }
  else if(t.id==='dsp'){ S.discSpent=Math.max(0,Number(t.value)||0); }
  save(); renderResult(); renderPlan();
});
$('cppList').addEventListener('input', e=>{ const t=e.target; if(t.dataset.cur){ S.cpp[t.dataset.cur]=Math.max(0,Number(t.value)||0); save(); renderResult(); renderPlan(); } });

loadData().then(()=>{
  const d=$('updated'); if(d) d.textContent=new Date(DATA_UPDATED+'T12:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  renderAll();
}).catch(err=>{
  console.error(err);
  $('result').innerHTML='<div class="empty"><b style="color:var(--ink)">CardMaxx couldn\'t load its card data.</b><br>Check your connection and refresh the page.</div>';
});

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{})); }
