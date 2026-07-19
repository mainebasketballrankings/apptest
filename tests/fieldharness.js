// Thin behavioural harness for field_scorer.html (soccer / field hockey / lacrosse).
// Purpose: lock in CURRENT behaviour before the core port, so a regression is loud.
const {JSDOM}=require('jsdom');
function boot(){
  const posted=[];
  const stub=(url,opt)=>{
    const u=String(url), m=(opt&&opt.method)||'GET';
    if(m==='POST'||m==='PATCH'){ try{posted.push({u,body:JSON.parse(opt.body||'{}')});}catch(e){posted.push({u});} 
      return Promise.resolve({ok:true,status:201,json:()=>Promise.resolve([{id:'G1'}]),text:()=>Promise.resolve('')}); }
    let data=[];
    if(/teams\?/.test(u)) data=[{id:'T1',school_name:'Camden Hills',sport_id:'ff80a695-0e78-4432-98f2-141b2b571e0e'}];
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(data),text:()=>Promise.resolve('[]')});
  };
  const dom=new JSDOM(require('./fieldload.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{};
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom,d=window.document;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d,ev:c=>window.eval(c),posted};
}
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};

async function setupGame(ctx, sportKey){
  const {window,d,ev}=ctx;
  window.setSport(sportKey);
  window.suSetMode('new');
  d.getElementById('su-test').checked = true;          // no network
  d.getElementById('su-home-name').value='Camden Hills';
  d.getElementById('su-away-name').value='Belfast';
  // two players a side, one GK each (gkTracked sports require it)
  ev(`SU.home.players=[{num:'1',first:'Ann',last:'Keeper',fi:'A',starter:true,gk:true},{num:'9',first:'Bea',last:'Striker',fi:'B',starter:true}];`);
  ev(`SU.away.players=[{num:'1',first:'Cy',last:'Netmin',fi:'C',starter:true,gk:true},{num:'7',first:'Dee',last:'Wing',fi:'D',starter:true}];`);
  await window.suKickOff();
  await new Promise(r=>setTimeout(r,30));
}

(async()=>{
  // ── SOCCER ────────────────────────────────────────────────────────────────
  {
    const ctx=boot(); const {window,d,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    chk('boots without throwing', ev("typeof SPORTS")==='object');
    chk('defaults to soccer', ev("SP.key")==='soccer', ev("SP.key"));
    await setupGame(ctx,'soccer');
    chk('soccer: 2 periods of 2400s', ev('SP.periods')===2 && ev('SP.periodSecs')===2400, `${ev('SP.periods')}x${ev('SP.periodSecs')}`);
    chk('soccer: clock seeded to period length', ev('GAME.clockSec')===2400, ev('GAME.clockSec'));
    chk('soccer: rosters built with ids', ev('PL.home.length')===2 && ev('PL.away.length')===2, `${ev('PL.home.length')}/${ev('PL.away.length')}`);
    chk('soccer: goalkeeper assigned', !!ev('GAME.home.gk') && !!ev('GAME.away.gk'), `${ev('GAME.home.gk')}/${ev('GAME.away.gk')}`);
    chk('soccer: score starts 0-0', ev('GAME.home.score')===0 && ev('GAME.away.score')===0);
    chk('soccer: tracks a keeper stat block', ev("JSON.stringify(SP.keeper)").includes('SV'), ev("JSON.stringify(SP.keeper)"));
    chk('soccer: second yellow = red rule present', ev('SP.secondYellowRed')===true);
    chk('soccer: mercy rule configured', ev('SP.mercy.diff')===8, ev('SP.mercy && SP.mercy.diff'));
  }
  // ── FIELD HOCKEY ──────────────────────────────────────────────────────────
  {
    const ctx=boot(); const {window,d,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    await setupGame(ctx,'field_hockey');
    chk('field hockey: 4 periods of 900s', ev('SP.periods')===4 && ev('SP.periodSecs')===900, `${ev('SP.periods')}x${ev('SP.periodSecs')}`);
    chk('field hockey: clock seeded', ev('GAME.clockSec')===900, ev('GAME.clockSec'));
    chk('field hockey: distinct sport_id', ev("SP.sport_id")==='1054869a-20d4-465f-8ca9-4bc4d2bafe1b', ev('SP.sport_id'));
  }
  // ── LACROSSE ──────────────────────────────────────────────────────────────
  {
    const ctx=boot(); const {window,d,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    await setupGame(ctx,'lacrosse');
    chk('lacrosse: sport_id set', ev("SP.sport_id")==='9c34ec5c-81b4-4e2e-9f60-740bb30fee4d', ev('SP.sport_id'));
    chk('lacrosse: periods configured', ev('SP.periods')>0, String(ev('SP.periods')));
  }
  // ── season year rule (the thing football gets wrong if copied blindly) ────
  {
    const ctx=boot(); const {ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    chk('fall game -> season year is that calendar year', ev("seasonYearFor('2026-09-15')")===2026, String(ev("seasonYearFor('2026-09-15')")));
    chk('spring game -> season year is that calendar year', ev("seasonYearFor('2026-04-15')")===2026, String(ev("seasonYearFor('2026-04-15')")));
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'FIELD HARNESS — BASELINE CAPTURED'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
