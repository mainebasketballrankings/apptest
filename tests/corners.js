// Field hockey tournament tiebreaker: "Reduced Number of Corners — 6 on 6",
// sets of three equal-opportunity corners, sudden victory the moment one team
// leads with both having had the same number of attempts.
const {JSDOM}=require('jsdom');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
function boot(){
  const stub=(url,opt)=>{const m=(opt&&opt.method)||'GET';
    if(m!=='GET') return Promise.resolve({ok:true,status:201,json:()=>Promise.resolve([{id:'G1'}]),text:()=>Promise.resolve('')});
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('[]')});};
  const dom=new JSDOM(require('./fieldload.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{};
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d:window.document,ev:c=>window.eval(c)};
}
async function fhGame(ctx,{playoff=true}={}){
  const {window,d,ev}=ctx;
  window.setSport('field_hockey'); window.suSetMode('new');
  d.getElementById('su-test').checked=true;
  if(playoff) d.getElementById('su-playoff').checked=true;
  d.getElementById('su-home-name').value='ZZ Test North';
  d.getElementById('su-away-name').value='ZZ Test South';
  const mk=(n,f,l,gk)=>({num:String(n),first:f,last:l,fi:f[0],starter:true,gk:!!gk});
  ev(`SU.home.players=${JSON.stringify([mk(1,'Ann','Keeper',true),mk(2,'Bea','Bee'),mk(3,'Cia','See'),mk(4,'Dot','Dee'),mk(5,'Eve','Ee'),mk(6,'Fay','Ef'),mk(7,'Gia','Gee')])};`);
  ev(`SU.away.players=${JSON.stringify([mk(1,'Cy','Net',true),mk(2,'Dee','Wing'),mk(3,'Eli','Ess'),mk(4,'Flo','Eff'),mk(5,'Gus','Jee'),mk(6,'Hui','Aych'),mk(7,'Ivy','Eye')])};`);
  await window.suKickOff(); await new Promise(r=>setTimeout(r,40));
  ev("GAME.home.score=2; GAME.away.score=2; GAME.period=6; GAME.clockSec=0;");   // after OT2
}
const corner=(ctx,made)=>ctx.window.soKick(null, made);   // team attempt, scorer optional
(async()=>{
  // ── regular season field hockey ends in a tie, no tiebreaker ──
  {
    const ctx=boot(); const {window,ev,d}=ctx;
    await new Promise(r=>setTimeout(r,150)); await fhGame(ctx,{playoff:false});
    chk('regular season FH OT is 2 x 8:00', ev('otRules().secs')===480 && ev('otRules().max')===2, `${ev('otRules().secs')}x${ev('otRules().max')}`);
    window.updAll();
    chk('offers the playoff switch rather than a tiebreaker', /Is this a playoff game/i.test(d.getElementById('so-cta').innerHTML));
  }
  // ── playoff: corners, not kicks ──
  {
    const ctx=boot(); const {window,ev,d}=ctx;
    await new Promise(r=>setTimeout(r,150)); await fhGame(ctx);
    chk('playoff FH OT is still 2 x 8:00 7v7', ev('otRules().secs')===480, String(ev('otRules().secs')));
    chk('tiebreaker mode is corners', ev("soMode()")==='corners', ev('soMode()'));
    chk('a set is three corners', ev('soCfg().setSize')===3, String(ev('soCfg().setSize')));
    window.updAll();
    chk('banner names corners, not kicks', /PENALTY CORNERS/i.test(d.getElementById('so-cta').innerHTML),
        d.getElementById('so-cta').innerHTML.slice(0,120));
    window.soStart();
    chk('modal titled Penalty Corners', d.getElementById('so-title').textContent==='Penalty Corners');
  }
  // ── bulletin SITUATION #1: A no, B yes -> over immediately ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await fhGame(ctx);
    window.soStart(); window.soSetFirst('away');
    corner(ctx,false);                       // A does not score
    chk('not decided after one corner (no equal opportunity yet)', ev('GAME.so.done')===false);
    corner(ctx,true);                        // B scores -> equal opportunity, B leads
    chk('SITUATION 1: ends the moment B leads with equal opportunity', ev('GAME.so.done')===true, 'done='+ev('GAME.so.done'));
    chk('home (second) declared winner', ev("GAME.so.winner")==='home', ev('GAME.so.winner'));
  }
  // ── bulletin SITUATION #2: no, no, yes, no -> over after four ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await fhGame(ctx);
    window.soStart(); window.soSetFirst('away');
    corner(ctx,false); corner(ctx,false);
    chk('still level after one each', ev('GAME.so.done')===false);
    corner(ctx,true);
    chk('not decided before the other side answers', ev('GAME.so.done')===false, 'must give equal opportunity');
    corner(ctx,false);
    chk('SITUATION 2: decided after equal opportunity', ev('GAME.so.done')===true);
    chk('away (first) declared winner', ev("GAME.so.winner")==='away');
    chk('winner gets the goal (2 -> 3)', ev('GAME.away.score')===3, String(ev('GAME.away.score')));
  }
  // ── a corner needs no named scorer ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await fhGame(ctx);
    window.soStart(); window.soSetFirst('away');
    window.soResult(false);
    chk('records a corner with no player selected', ev('GAME.so.kicks.length')===1, String(ev('GAME.so.kicks.length')));
    chk('logged as a team attempt', ev("GAME.so.kicks[0].pid")===null);
  }
  // ── soccer is unaffected: still kicks, sets of five ──
  {
    const ctx=boot(); const {window,d,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    window.setSport('soccer'); window.suSetMode('new');
    d.getElementById('su-test').checked=true; d.getElementById('su-playoff').checked=true;
    d.getElementById('su-home-name').value='ZZ Test North'; d.getElementById('su-away-name').value='ZZ Test South';
    const mk=(n,f,l,gk)=>({num:String(n),first:f,last:l,fi:f[0],starter:true,gk:!!gk});
    ev(`SU.home.players=${JSON.stringify([mk(1,'Ann','K',true),mk(2,'Bea','B')])};`);
    ev(`SU.away.players=${JSON.stringify([mk(1,'Cy','N',true),mk(2,'Dee','W')])};`);
    await window.suKickOff(); await new Promise(r=>setTimeout(r,40));
    chk('soccer still uses kicks', ev("soMode()")==='kicks');
    chk('soccer sets are still five', ev('soCfg().setSize')===5, String(ev('soCfg().setSize')));
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'FIELD HOCKEY CORNERS PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
