// MPA penalty-kick tiebreaker: sets of five alternating kicks, early stop on
// mathematical elimination, "five different players" in even sets, and one goal
// added to the winner's score.
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
async function game(ctx){
  const {window,d,ev}=ctx;
  window.setSport('soccer'); window.suSetMode('new');
  d.getElementById('su-test').checked=true; d.getElementById('su-playoff').checked=true;
  d.getElementById('su-home-name').value='ZZ Test North';
  d.getElementById('su-away-name').value='ZZ Test South';
  const mk=(n,f,l,gk)=>({num:String(n),first:f,last:l,fi:f[0],starter:true,gk:!!gk});
  ev(`SU.home.players=${JSON.stringify([mk(1,'Ann','Keeper',true),mk(2,'Bea','Bee'),mk(3,'Cia','See'),mk(4,'Dot','Dee'),mk(5,'Eve','Ee'),mk(6,'Fay','Ef'),mk(7,'Gia','Gee'),mk(8,'Hal','Aitch'),mk(9,'Ivy','Eye'),mk(10,'Joy','Jay'),mk(11,'Kim','Kay')])};`);
  ev(`SU.away.players=${JSON.stringify([mk(1,'Cy','Netmin',true),mk(2,'Dee','Wing'),mk(3,'Eli','Ess'),mk(4,'Flo','Eff'),mk(5,'Gus','Jee'),mk(6,'Hui','Aych'),mk(7,'Ito','Eye'),mk(8,'Jo','Jay'),mk(9,'Kit','Kay'),mk(10,'Lou','Ell'),mk(11,'Mo','Em')])};`);
  await window.suKickOff(); await new Promise(r=>setTimeout(r,40));
  ev("GAME.home.score=1; GAME.away.score=1; GAME.period=4; GAME.clockSec=0;");
}
const kick=(ctx,i,made)=>{ const side=ctx.ev('soTurn()'); const pid=ctx.ev(`PL['${side}'][${i}].id`); ctx.window.soKick(pid,made); return side; };
(async()=>{
  // ── the end modal offers it instead of stalling ──
  {
    const ctx=boot(); const {window,ev,d}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.openEndModal(false);
    chk('tied playoff after OT offers penalty kicks', /Start penalty kicks/.test(d.getElementById('end-body').innerHTML));
  }
  // ── coin toss required, then alternating ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart();
    chk('shootout starts with no kicks', ev('GAME.so.kicks.length')===0);
    window.soKick(ev("PL.home[1].id"), true);
    chk('refuses kicks before the coin toss', ev('GAME.so.kicks.length')===0);
    window.soSetFirst('away');
    chk('first kicker recorded', ev("GAME.so.first")==='away');
    chk('away is on the spot', ev('soTurn()')==='away');
    kick(ctx,1,true);
    chk('turn alternates to home', ev('soTurn()')==='home', ev('soTurn()'));
    kick(ctx,1,true);
    chk('back to away', ev('soTurn()')==='away');
  }
  // ── mathematical elimination stops the set early ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart(); window.soSetFirst('away');
    // Level at 2-2 after three kicks each, then away pulls away. A team is done the
    // moment its best possible total can no longer reach the other's actual total.
    kick(ctx,1,true);  kick(ctx,1,true);      // 1-1
    kick(ctx,2,true);  kick(ctx,2,true);      // 2-2
    kick(ctx,3,false); kick(ctx,3,false);     // 2-2, two kicks left each
    chk('level 2-2 after three kicks each', ev("soMade('away')")===2 && ev("soMade('home')")===2);
    chk('not decided while home can still catch up', ev('GAME.so.done')===false);
    kick(ctx,4,true);                          // away 3, home 2 with 2 left -> still alive
    chk('still alive: home can still reach 4', ev('GAME.so.done')===false, 'done='+ev('GAME.so.done'));
    kick(ctx,4,false);                         // home 2 with 1 left, away has 1 left
    chk('still alive at 3-2 with one kick each', ev('GAME.so.done')===false);
    kick(ctx,5,true);                          // away 4, home max is 3 -> eliminated
    chk('decided once home is mathematically eliminated', ev('GAME.so.done')===true);
    chk('away declared winner', ev("GAME.so.winner")==='away');
    chk('winner gets one goal added (1 -> 2)', ev('GAME.away.score')===2, String(ev('GAME.away.score')));
    chk('loser score untouched', ev('GAME.home.score')===1);
    chk('a shootout-winner event was logged', ev("evts.some(e=>e.key==='goal')")===true);
  }
  // ── even sets must use different players ──
  {
    const ctx=boot(); const {window,ev,d}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart(); window.soSetFirst('away');
    for(let i=0;i<5;i++){ kick(ctx,i+1,true); kick(ctx,i+1,true); }   // 5-5, level
    chk('level after the first set moves to round 2', ev('soRound()')===2 && ev('GAME.so.done')===false, 'round='+ev('soRound()'));
    const usedPrev = ev("JSON.stringify([...soUsed(1)])");
    window.renderSO();
    const html=d.getElementById('so-body').innerHTML;
    chk('round 2 warns that players must differ', /did not kick in the previous set/.test(html));
    chk('previous-set kickers are disabled', /kicked in the previous set/.test(html), usedPrev.slice(0,40));
  }
  // ── undo unwinds the awarded goal ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart(); window.soSetFirst('home');
    for(let i=0;i<3;i++){ kick(ctx,i+1,true); kick(ctx,i+1,false); }   // 3-0, home eliminated
    chk('decided', ev('GAME.so.done')===true);
    const after=ev('GAME.home.score');
    window.soUndo();
    chk('undo clears the decision', ev('GAME.so.done')===false);
    chk('undo removes the awarded goal', ev('GAME.home.score')===after-1, `${after} -> ${ev('GAME.home.score')}`);
  }
  // ── kicks are logged with existing enum types + shootout metadata ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart(); window.soSetFirst('away');
    kick(ctx,1,true); kick(ctx,1,false);
    chk('made kick uses penalty_kick_made', ev("evts.some(e=>e.key==='penalty_kick_made')"));
    chk('missed kick uses penalty_kick_miss', ev("evts.some(e=>e.key==='penalty_kick_miss')"));
    chk('kicks carry shootout metadata', ev("evts.filter(e=>e.meta&&e.meta.shootout).length")>=2,
        ev("JSON.stringify((evts.find(e=>e.meta&&e.meta.shootout)||{}).meta)"));
  }
  // ── THE BUG: a completed set with a clear winner must END, not roll to round 2 ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart(); window.soSetFirst('away');
    // away 4/5, home 3/5 -> away wins on the last kick of the set
    const seq=[['a',true],['h',false],['a',true],['h',true],['a',false],
               ['h',true],['a',true],['h',true],['a',true],['h',false]];
    seq.forEach(([_,made],i)=>kick(ctx,(i%5)+1,made));
    chk('set finished 4-3', ev("soMade('away')")===4 && ev("soMade('home')")===3,
        `${ev("soMade('away')")}-${ev("soMade('home')")}`);
    chk('game ENDS on a decided set (does not roll to round 2)', ev('GAME.so.done')===true, 'done='+ev('GAME.so.done'));
    chk('away declared winner', ev("GAME.so.winner")==='away');
    chk('winner got the extra goal', ev('GAME.away.score')===2, String(ev('GAME.away.score')));
  }
  // ── a genuinely level set does roll on ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart(); window.soSetFirst('away');
    for(let i=0;i<5;i++){ kick(ctx,i+1,true); kick(ctx,i+1,true); }
    chk('level 5-5 rolls to round 2', ev('GAME.so.done')===false && ev('soRound()')===2, 'round='+ev('soRound()'));
  }
  // ── reduce to equate: smaller sets ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart(); window.soSetFirst('away');
    window.soSetSize(3);
    chk('set size can be reduced to 3', ev('soSize(1)')===3, String(ev('soSize(1)')));
    kick(ctx,1,true); kick(ctx,1,false);
    kick(ctx,2,true); kick(ctx,2,false);
    chk('decided early in a 3v3 set (2-0 with one left)', ev('GAME.so.done')===true, 'done='+ev('GAME.so.done'));
    chk('winner is away', ev("GAME.so.winner")==='away');
  }
  // ── a 3v3 set that stays level rolls on with the reduced size ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart(); window.soSetFirst('away'); window.soSetSize(2);
    kick(ctx,1,true); kick(ctx,1,true);
    kick(ctx,2,false); kick(ctx,2,false);
    chk('2v2 level -> round 2', ev('soRound()')===2 && ev('GAME.so.done')===false, 'round='+ev('soRound()'));
  }
  // ── cannot shrink below kicks already taken ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart(); window.soSetFirst('away');
    kick(ctx,1,true); kick(ctx,1,true); kick(ctx,2,true);
    window.soSetSize(1);
    chk('refuses a size smaller than kicks already taken', ev('soSize(1)')===5, String(ev('soSize(1)')));
  }
  // ── manual end ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await game(ctx);
    window.soStart(); window.soSetFirst('away');
    kick(ctx,1,true); kick(ctx,1,false);
    window.soEndManual('away');
    chk('manual end declares the winner', ev('GAME.so.done')===true && ev("GAME.so.winner")==='away');
    chk('manual end awards the goal', ev('GAME.away.score')===2, String(ev('GAME.away.score')));
    chk('manual end is undoable', (window.soUndo(), ev('GAME.so.done')===false && ev('GAME.away.score')===1));
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'PENALTY SHOOTOUT PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
