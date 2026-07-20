// Checks the shared core pieces promoted from one scorer to another:
// gender-aware team lookup, and live clock sync (games.game_clock for the feed).
const APP = require('path').join(__dirname,'..');
const {JSDOM}=require('jsdom');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};

function boot(){
  const seen=[], patched=[];
  const stub=(url,opt)=>{
    const u=String(url), m=(opt&&opt.method)||'GET';
    if(m==='PATCH'){ patched.push({u,body:JSON.parse(opt.body||'{}')});
      return Promise.resolve({ok:true,status:204,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')}); }
    if(m==='POST') return Promise.resolve({ok:true,status:201,json:()=>Promise.resolve([{id:'G1'}]),text:()=>Promise.resolve('')});
    seen.push(u);
    let data=[];
    if(/gender=ilike\.girls/.test(u)) data=[{id:'GIRLS-TEAM'}];
    else if(/gender=ilike\.boys/.test(u)) data=[{id:'BOYS-TEAM'}];
    else if(/teams\?school_name=eq\./.test(u)) data=[{id:'FALLBACK-TEAM'}];
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(data),text:()=>Promise.resolve('[]')});
  };
  const dom=new JSDOM(require('./loadapp.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{};
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d:window.document,ev:c=>window.eval(c),seen,patched};
}

(async()=>{
  const ctx=boot(); const {window,ev,seen,patched}=ctx;
  await new Promise(r=>setTimeout(r,150));

  // ── gender-aware team lookup ──
  const girls = await window.MBR.resolveTeamId('Camden Hills','SPORT-1','girls');
  chk('girls lookup picks the girls team', girls==='GIRLS-TEAM', String(girls));
  chk('gender filter sent server-side', seen.some(u=>/gender=ilike\.girls/.test(u)));
  const boys = await window.MBR.resolveTeamId('Camden Hills','SPORT-1','Boys Varsity');
  chk('boys lookup picks the boys team', boys==='BOYS-TEAM', String(boys));
  const none = await window.MBR.resolveTeamId('Camden Hills','SPORT-1');
  chk('no gender given -> unfiltered lookup still resolves', none==='FALLBACK-TEAM', String(none));
  chk('missing school name returns null', (await window.MBR.resolveTeamId('','SPORT-1'))===null);

  // ── live clock sync ──
  chk('football exposes a broadcast clock label', typeof window.gameClockLabel==='function');
  ev("G.quarter=2; G.clock=323; G.qLen=12; G.kickoffPending=false;");
  // football's qtrLabel() reads "2ND QTR"; field's reads "2ND". Either is fine —
  // assert the shape (period then clock), not one scorer's exact wording.
  chk('label formats as period + clock', /^2ND.*\| ?5:23$/.test(window.gameClockLabel()), window.gameClockLabel());
  ev("G.clock=0; G.quarter=2;");
  chk('halftime labelled', window.gameClockLabel()==='Halftime', window.gameClockLabel());
  ev("G.clock=0; G.quarter=3;");
  chk('end of quarter labelled', /^End /.test(window.gameClockLabel()), window.gameClockLabel());

  // timer actually patches games.game_clock, and skips repeats
  ev("G_test_mode=false; G_game_id='GID-1'; _gameFinalized=false; G.quarter=1; G.clock=600; G.qLen=12; G.kickoffPending=false;");
  window.MBR.startClockSync(window.gameClockLabel, 20);
  await new Promise(r=>setTimeout(r,70));
  const n1=patched.length;
  chk('clock sync PATCHes games.game_clock', n1>0 && /\/games\?id=eq\.GID-1/.test(patched[0].u) && patched[0].body.game_clock, JSON.stringify(patched[0]||{}));
  await new Promise(r=>setTimeout(r,70));
  chk('unchanged clock is not re-sent', patched.length===n1, `${n1} -> ${patched.length}`);
  ev("G.clock=540;");
  await new Promise(r=>setTimeout(r,70));
  chk('changed clock IS sent', patched.length>n1, `${n1} -> ${patched.length}`);
  const before=patched.length;
  ev("_gameFinalized=true;"); ev("G.clock=500;");
  await new Promise(r=>setTimeout(r,70));
  chk('finalized game stops syncing', patched.length===before, `${before} -> ${patched.length}`);
  window.MBR.stopClockSync();

  console.log('\n'+(fails?fails+' FAIL(s)':'SHARED CORE (gender lookup + clock sync) PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
