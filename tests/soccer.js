// Soccer behaviour: team-selection clearing, sub highlight, time of possession,
// and MPA overtime (regular season 2x5 then a tie; playoff 2x10 then kicks).
const {JSDOM}=require('jsdom');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
function boot(){
  const stub=(url,opt)=>{
    const m=(opt&&opt.method)||'GET';
    if(m!=='GET') return Promise.resolve({ok:true,status:201,json:()=>Promise.resolve([{id:'G1'}]),text:()=>Promise.resolve('')});
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('[]')});
  };
  const dom=new JSDOM(require('./fieldload.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{};
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d:window.document,ev:c=>window.eval(c)};
}
async function game(ctx,{playoff=false}={}){
  const {window,d,ev}=ctx;
  window.setSport('soccer'); window.suSetMode('new');
  d.getElementById('su-test').checked=true;
  if(playoff) d.getElementById('su-playoff').checked=true;
  d.getElementById('su-home-name').value='ZZ Test North';
  d.getElementById('su-away-name').value='ZZ Test South';
  ev(`SU.home.players=[{num:'1',first:'Ann',last:'Keeper',fi:'A',starter:true,gk:true},{num:'9',first:'Bea',last:'Striker',fi:'B',starter:true},{num:'12',first:'Cal',last:'Bench',fi:'C',starter:false}];`);
  ev(`SU.away.players=[{num:'1',first:'Cy',last:'Netmin',fi:'C',starter:true,gk:true},{num:'7',first:'Dee',last:'Wing',fi:'D',starter:true}];`);
  await window.suKickOff(); await new Promise(r=>setTimeout(r,40));
}
(async()=>{
  // ── team selection clears after a team-only action (the corner bug) ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    await game(ctx);
    window.setTeamMode('home');
    chk('team selected before the action', ev("selSide")==='home', String(ev('selSide')));
    const i=ev("SP.btns.findIndex(b=>b.key==='corner')");
    window.doStat(i);
    chk('corner logged for that team', ev("evts.some(e=>e.key==='corner')"));
    chk('team selection CLEARS after a corner', ev("selSide")===null, String(ev('selSide')));
    // a player action should NOT clear the player (you often log two things)
    window.selPlayer(ev('PL.home[1].id'),'home');
  }
  // ── substitution keeps the OUT player lit ──
  {
    const ctx=boot(); const {window,d,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    await game(ctx);
    window.setTeamMode('home'); window.openSubBox();
    const outId=ev("PL.home.find(p=>p.on&&!p.gk).id");
    window.subPick('home',outId,'out');
    const html=d.getElementById('sub-body').innerHTML;
    chk('OUT player stays highlighted while picking IN', /ast-item sel/.test(html), html.slice(0,120));
    const inId=ev("PL.home.find(p=>!p.on).id");
    window.subPick('home',inId,'in');
    chk('sub completes', ev(`PL.home.find(p=>p.id==='${inId}').on`)===true);
    chk('OUT player is off the field', ev(`PL.home.find(p=>p.id==='${outId}').on`)===false);
  }
  // ── time of possession ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    await game(ctx);
    chk('possession counters start at zero', ev('GAME.home.topSec')===0 && ev('GAME.away.topSec')===0);
    ev("GAME.possession='home'"); window.toggleClock();
    await new Promise(r=>setTimeout(r,2300));
    window.toggleClock();
    const h1=ev('GAME.home.topSec'), a1=ev('GAME.away.topSec');
    chk('home banks time while holding the ball', h1>=2, 'home='+h1);
    chk('away banks none', a1===0, 'away='+a1);
    ev("GAME.possession='away'"); window.toggleClock();
    await new Promise(r=>setTimeout(r,2300));
    window.toggleClock();
    chk('possession switches to away', ev('GAME.away.topSec')>=2, 'away='+ev('GAME.away.topSec'));
    chk('home stops accruing', ev('GAME.home.topSec')===h1, `${h1} -> ${ev('GAME.home.topSec')}`);
    const before=ev('GAME.home.topSec');
    ev("GAME.possession='home'");
    await new Promise(r=>setTimeout(r,1200));
    chk('clock stopped = no possession time', ev('GAME.home.topSec')===before, 'stopped clock must not accrue');
  }
  // ── MPA overtime: regular season ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    await game(ctx,{playoff:false});
    chk('regular season flagged', ev('GAME.playoff')===false);
    chk('regular OT is 5 minutes', ev('otRules().secs')===300, String(ev('otRules().secs')));
    chk('regular OT is 2 periods', ev('otRules().max')===2);
    ev("GAME.period=3");
    chk('OT period clock seeds to 5:00', ev('periodSecs(3)')===300, String(ev('periodSecs(3)')));
  }
  // ── MPA overtime: playoff ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    await game(ctx,{playoff:true});
    chk('playoff flagged from setup', ev('GAME.playoff')===true);
    // MPA: 11-player playoff OT is 2 x 15 min (8-player is 2 x 10).
    chk('playoff OT is 15 minutes', ev('otRules().secs')===900, String(ev('otRules().secs')));
    chk('playoff OT is 2 periods', ev('otRules().max')===2);
    chk('playoff OT ends in kicks', ev('otRules().shootout')===true);
    ev("GAME.period=3");
    chk('OT period clock seeds to 15:00', ev('periodSecs(3)')===900, String(ev('periodSecs(3)')));
    // end modal should name the shootout, not a tie
    ev("GAME.home.score=1; GAME.away.score=1; GAME.period=4; GAME.clockSec=0;");
    window.openEndModal(false);
    const body=ctx.d.getElementById('end-body').innerHTML;
    // the end screen now offers the tiebreaker outright rather than just describing it
    chk('tied playoff offers penalty kicks, not a tie',
        /settle it with penalty kicks/i.test(body) && /Start penalty kicks/.test(body), body.slice(-140));
  }
  // ── regular-season tie wording ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    await game(ctx,{playoff:false});
    ev("GAME.home.score=2; GAME.away.score=2; GAME.period=4; GAME.clockSec=0;");
    window.openEndModal(false);
    const body=ctx.d.getElementById('end-body').innerHTML;
    chk('tied regular season records a tie', /recorded as a tie/i.test(body), body.slice(-120));
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'SOCCER FIXES PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
