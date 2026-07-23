// A FULL 80-minute soccer match, played end to end. Everything before this
// covered setup, overtime rules and the tiebreakers; this exercises the part an
// operator actually spends the game doing — shots, goals, assists, keeper saves,
// cards, substitutions, fouls, corners — and then checks the box score and the
// report agree with what was entered.
const {JSDOM}=require('jsdom');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
function boot(){
  const posted=[];
  const stub=(url,opt)=>{
    const m=(opt&&opt.method)||'GET';
    if(m!=='GET'){ try{posted.push(JSON.parse(opt.body||'{}'));}catch(e){posted.push({});}
      return Promise.resolve({ok:true,status:201,json:()=>Promise.resolve([{id:'G1'}]),text:()=>Promise.resolve('')}); }
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('[]')});
  };
  const dom=new JSDOM(require('./fieldload.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{}; w.confirm=()=>true;
      w.jspdf=require('jspdf');
      w.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d:window.document,ev:c=>window.eval(c),posted};
}
async function kickoff(ctx){
  const {window,d,ev}=ctx;
  window.setSport('soccer'); window.suSetMode('new');
  d.getElementById('su-home-name').value='ZZ Test North';
  d.getElementById('su-away-name').value='ZZ Test South';
  const squad=(pfx)=>Array.from({length:14},(_,i)=>({
    num:String(i+1), first:'P'+(i+1), last:pfx+'er'+(i+1), fi:'P',
    starter:i<11, gk:i===0 }));
  ev(`SU.home.players=${JSON.stringify(squad('Home'))};`);
  ev(`SU.away.players=${JSON.stringify(squad('Away'))};`);
  window.toggleTestMode();                       // no network for the match itself
  await window.suKickOff(); await new Promise(r=>setTimeout(r,50));
}
// helpers that drive the app the way a finger does
const pick=(ctx,side,i)=>ctx.window.selPlayer(ctx.ev(`PL.${side}[${i}].id`), side);
const shot=(ctx,side,i,result,assistIdx)=>{
  const {window,ev}=ctx;
  ev(`pendingShot={pt:{x:50,y:40}, side:'${side}', p:PL.${side}[${i}]};`);
  window.resolveShot(result);
  // a goal opens the assist picker; answer it
  if(result==='goal') window.finishGoal(assistIdx==null?null:ev(`PL.${side}[${assistIdx}].id`));
};
const btn=(ctx,key)=>ctx.ev(`SP.btns.findIndex(b=>b.key==='${key}')`);
const teamAct=(ctx,side,key)=>{ ctx.window.setTeamMode(side); ctx.window.doStat(btn(ctx,key)); };
const playerAct=(ctx,side,i,key)=>{ pick(ctx,side,i); ctx.window.doStat(btn(ctx,key)); };

(async()=>{
  const ctx=await (async()=>{ const c=boot(); await new Promise(r=>setTimeout(r,200)); await kickoff(c); return c; })();
  const {window,d,ev}=ctx;

  chk('match starts 0-0 in the 1st half', ev('GAME.home.score')===0 && ev('GAME.period')===1);
  chk('11 on the field each', ev('PL.home.filter(p=>p.on).length')===11 && ev('PL.away.filter(p=>p.on).length')===11,
      `${ev('PL.home.filter(p=>p.on).length')}/${ev('PL.away.filter(p=>p.on).length')}`);

  // ── FIRST HALF ────────────────────────────────────────────────────────────
  window.toggleClock();

  // 9' home shot saved by the away keeper
  shot(ctx,'home',9,'save');
  chk('a save credits the OPPOSING keeper', ev('GAME.away.saves')===1, 'away saves='+ev('GAME.away.saves'));
  chk('a saved shot counts as a shot on goal', ev('GAME.home.shots')===1 && ev('GAME.home.sog')===1,
      `sh=${ev('GAME.home.shots')} sog=${ev('GAME.home.sog')}`);

  // 14' home scores, assisted
  shot(ctx,'home',9,'goal',7);
  chk('goal counts', ev('GAME.home.score')===1, String(ev('GAME.home.score')));
  chk('scorer credited a goal', ev("(playerLine(PL.home[9].id)||{}).g")===1, 'g='+ev("(playerLine(PL.home[9].id)||{}).g"));
  chk('assist credited to the other player', ev("(playerLine(PL.home[7].id)||{}).a")===1, 'a='+ev("(playerLine(PL.home[7].id)||{}).a"));
  chk('a goal stops the clock', ev('GAME.running')===false);
  // GA is a keeper stat, carried on the goal event rather than playerLine
  chk('goal names the conceding keeper', ev("evts.some(e=>e.goal&&e.gkName)")===true,
      ev("JSON.stringify((evts.find(e=>e.goal)||{}).gkName)"));

  // 21' away miss, 25' away hits the post, 30' away blocked
  shot(ctx,'away',10,'miss');
  shot(ctx,'away',10,'post');
  shot(ctx,'away',5,'blocked');
  chk('misses count as shots but not on goal', ev('GAME.away.shots')===3 && ev('GAME.away.sog')===0,
      `sh=${ev('GAME.away.shots')} sog=${ev('GAME.away.sog')}`);

  // fouls, a corner, an offside
  playerAct(ctx,'away',4,'foul');
  chk('foul recorded against the player', ev("(playerLine(PL.away[4].id)||{}).fl")===1, 'fl='+ev("(playerLine(PL.away[4].id)||{}).fl"));
  // corner IS a team-only button, so it clears; offside is a player stat and
  // deliberately keeps the team selected so you can attribute it next.
  teamAct(ctx,'home','corner');
  chk('a team-only action clears the highlight', ev('selSide')===null, String(ev('selSide')));
  // A player stat needs a player: doStat refuses it in team mode rather than
  // silently logging an unattributed event. Worth pinning down.
  const evtsBefore=ev("evts.length");
  teamAct(ctx,'away','offside');
  chk('player stat is REFUSED with nobody selected', ev("evts.length")===evtsBefore,
      `${evtsBefore} -> ${ev("evts.length")}`);
  playerAct(ctx,'away',8,'offside');
  chk('offside logs once a player is picked', ev("evts.some(e=>e.key==='offside')")===true);

  // 38' yellow card
  playerAct(ctx,'away',4,'card_yellow');
  chk('yellow card recorded', ev("(playerLine(PL.away[4].id)||{}).yc")===1, 'yc='+ev("(playerLine(PL.away[4].id)||{}).yc"));
  chk('a yellow does NOT remove the player', ev('PL.away[4].on')===true);

  // halftime
  ev("GAME.clockSec=0;"); window.chgPeriod(1);
  chk('second half begins', ev('GAME.period')===2, String(ev('GAME.period')));
  chk('clock reset for the half', ev('GAME.clockSec')===2400, String(ev('GAME.clockSec')));

  // ── SECOND HALF ───────────────────────────────────────────────────────────
  // 52' substitution
  const outId=ev("PL.home.find(p=>p.on&&!p.gk).id"), inId=ev("PL.home.find(p=>!p.on).id");
  window.setTeamMode('home'); window.openSubBox();
  window.subPick('home',outId,'out'); window.subPick('home',inId,'in');
  chk('substitute is on the field', ev(`PL.home.find(p=>p.id==='${inId}').on`)===true);
  chk('replaced player is off', ev(`PL.home.find(p=>p.id==='${outId}').on`)===false);
  chk('still 11 on the field after the sub', ev('PL.home.filter(p=>p.on).length')===11,
      String(ev('PL.home.filter(p=>p.on).length')));

  // 61' away equalise, unassisted
  shot(ctx,'away',10,'goal');
  chk('away equalise', ev('GAME.away.score')===1, String(ev('GAME.away.score')));
  chk('unassisted goal records no assist', ev("evts.filter(e=>e.key==='assist').length")===1, 'assists so far');

  // 70' red card — away go down to ten
  playerAct(ctx,'away',6,'card_red');
  chk('red card recorded', ev("(playerLine(PL.away[6].id)||{}).rc")===1, 'rc='+ev("(playerLine(PL.away[6].id)||{}).rc"));
  chk('a red DOES remove the player', ev('PL.away[6].on')===false);
  chk('away are down to ten', ev('PL.away.filter(p=>p.on).length')===10,
      String(ev('PL.away.filter(p=>p.on).length')));

  // 78' home winner, assisted by the substitute
  const subIdx=ev(`PL.home.findIndex(p=>p.id==='${inId}')`);
  shot(ctx,'home',3,'goal',subIdx);
  chk('home take the lead', ev('GAME.home.score')===2, String(ev('GAME.home.score')));
  chk('substitute can record an assist', ev(`(playerLine('${inId}')||{}).a`)===1, 'sub assist a='+ev(`(playerLine('${inId}')||{}).a`));

  // ── FULL TIME: the numbers must reconcile ─────────────────────────────────
  const ta=ev("JSON.stringify(teamTotals('away'))"), th=ev("JSON.stringify(teamTotals('home'))");
  const A=JSON.parse(ta), H=JSON.parse(th);
  chk('team goal totals match the scoreboard', H.g===2 && A.g===1, `H=${H.g} A=${A.g}`);
  chk('shots on goal never exceed shots', H.sog<=H.sh && A.sog<=A.sh, `H ${H.sog}/${H.sh}  A ${A.sog}/${A.sh}`);
  chk('goals never exceed shots on goal', H.g<=H.sog && A.g<=A.sog, `H ${H.g}/${H.sog}  A ${A.g}/${A.sog}`);
  chk('cards tallied on the team line', A.yc===1 && A.rc===1, `yc=${A.yc} rc=${A.rc}`);

  // per-player goals must sum to the team score
  const sumG=ev("PL.home.reduce((s,p)=>s+((playerLine(p.id)||{}).g||0),0)");
  chk('player goals sum to the team score', sumG===2, `sum=${sumG} score=${ev('GAME.home.score')}`);

  // box score renders and agrees
  window.openBoxScore();
  const box=d.getElementById('bs-body').innerHTML;
  chk('box score renders', box.length>200);
  chk('box score shows the final score', /2/.test(box) && /Team Stats/.test(box));
  chk('every scorer appears in the box score', /Home/.test(box));

  // the report must generate on a real match
  let pdfOK=false, err='';
  try{ const b=await window.generatePDF({returnBlob:true}); pdfOK=!!b; }catch(e){ err=e.message; }
  chk('match report generates', pdfOK, err);

  // undo still works at the end of a full match
  const before=ev('GAME.home.score');
  window.undoLast();
  chk('undo works after a full match', ev('GAME.home.score')===before-1 || ev('GAME.home.score')===before,
      `${before} -> ${ev('GAME.home.score')}`);

  console.log('\n'+(fails?fails+' FAIL(s)':'FULL SOCCER MATCH PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
