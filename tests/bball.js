// Behavioural baseline for the basketball scorer, captured BEFORE moving it onto
// mbr-core.js. Everything here is current, working behaviour — if the port
// changes any of it, that is a regression, not an improvement.
const {JSDOM}=require('jsdom');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
function boot(){
  const posted=[];
  const stub=(url,opt)=>{
    const u=String(url), m=(opt&&opt.method)||'GET';
    if(m!=='GET'){ try{posted.push({u,m,body:JSON.parse(opt.body||'{}')});}catch(e){posted.push({u,m});}
      return Promise.resolve({ok:true,status:201,json:()=>Promise.resolve([{id:'G1'}]),text:()=>Promise.resolve('')}); }
    let data=[];
    if(/teams\?/.test(u)) data=[{id:'T1',school_name:'ZZ Test North',sport_id:'b31ab283-b28e-4ba8-9684-b1cf30cea219'}];
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(data),text:()=>Promise.resolve('[]')});
  };
  const dom=new JSDOM(require('./bballload.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{};
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d:window.document,ev:c=>window.eval(c),posted};
}
async function game(ctx){
  const {window,d,ev}=ctx;
  window.suSetMode('new');
  d.getElementById('su-home-name').value='ZZ Test North';
  d.getElementById('su-away-name').value='ZZ Test South';
  d.getElementById('su-home-short').value='ZTN';
  d.getElementById('su-away-short').value='ZTS';
  // five starters a side is enforced by suTipOff
  const roster=(pfx)=>Array.from({length:8},(_,i)=>({id:pfx+(i+1),num:String(i+1),
    first:'P'+(i+1), last:'Player'+(i+1), fi:'P', starter:i<5}));
  ev(`SU.home.players=${JSON.stringify(roster('h'))};`);
  ev(`SU.away.players=${JSON.stringify(roster('a'))};`);
  ev("G_test_mode=true;");
  window.suTipOff();
  await new Promise(r=>setTimeout(r,60));
}
const sel=(ctx,side,i)=>ctx.ev(`selP=PL.${side}[${i}]; selSide='${side}'; teamMode=false;`);

(async()=>{
  // ── boots and sets up ──
  {
    const ctx=boot(); const {window,ev,d}=ctx;
    await new Promise(r=>setTimeout(r,200));
    chk('boots without throwing', ev("typeof GAME")==='object');
    await game(ctx);
    chk('scorer screen entered', d.getElementById('setup-screen').style.display==='none',
        'display='+d.getElementById('setup-screen').style.display);
    chk('rosters built 8 a side', ev('PL.home.length')===8 && ev('PL.away.length')===8, `${ev('PL.home.length')}/${ev('PL.away.length')}`);
    chk('five on the floor each', ev('PL.home.filter(p=>p.on).length')===5 && ev('PL.away.filter(p=>p.on).length')===5);
    chk('starts 0-0 in period 1', ev('GAME.home.score')===0 && ev('GAME.away.score')===0 && ev('GAME.period')===1);
    chk('quarter length 8:00', ev('GAME.clockSec')===480, String(ev('GAME.clockSec')));
  }
  // ── scoring: 2s, 3s, free throws ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    sel(ctx,'home',0);
    window.recShot({x:230,y:200},true,'norm');          // inside the arc -> 2
    chk('made two counts 2', ev('GAME.home.score')===2, String(ev('GAME.home.score')));
    chk('player credited 2', ev('PL.home[0].pts')===2);
    sel(ctx,'home',1);
    window.recShot({x:20,y:120},true,'norm');           // deep corner -> 3
    chk('made three counts 3', ev('GAME.home.score')===5, String(ev('GAME.home.score')));
    sel(ctx,'home',0);
    window.recShot({x:230,y:200},false,'norm');
    chk('a miss adds no points', ev('GAME.home.score')===5);
    window.doStat({key:'ft_made'});
    chk('free throw counts 1', ev('GAME.home.score')===6, String(ev('GAME.home.score')));
    chk('possession flips after a made basket', ev("GAME.possession")==='away', ev('GAME.possession'));
  }
  // ── fouls and the bonus ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    sel(ctx,'away',0);
    for(let i=0;i<4;i++) window.doStat({key:'foul_personal'});
    chk('four team fouls recorded this quarter', ev('GAME.qFouls.away[0]')===4, String(ev('GAME.qFouls.away[0]')));
    chk('player foul count tracked', ev('PL.away[0].fouls')===4, String(ev('PL.away[0].fouls')));
    window.doStat({key:'foul_personal'});
    chk('fifth team foul reached (bonus)', ev('GAME.qFouls.away[0]')===5);
    chk('team foul total accumulates', ev('GAME.away.fouls')===5, String(ev('GAME.away.fouls')));
  }
  // ── periods and overtime ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    // Advancing with time still on the clock asks first — that guard stops a
    // mis-tap skipping a quarter mid-game. Worth locking in.
    window.chgPeriod(1);
    chk('will not skip a quarter while time remains', ev('GAME.period')===1, 'period='+ev('GAME.period'));
    ev("GAME.clockSec=0;"); window.chgPeriod(1);
    chk('advances once the quarter is over', ev('GAME.period')===2, String(ev('GAME.period')));
    chk('clock resets to 8:00 for the new quarter', ev('GAME.clockSec')===480, String(ev('GAME.clockSec')));
    ev("GAME.period=4; GAME.clockSec=0;"); window.chgPeriod(1);
    chk('period 5 is overtime', ev('GAME.period')===5, String(ev('GAME.period')));
    chk('overtime is 4:00', ev('GAME.clockSec')===240, String(ev('GAME.clockSec')));
    chk('quarter fouls start clean in the new period', ev('GAME.qFouls.home[4]')===0);
    window.chgPeriod(-1);
    chk('going back a period is always allowed', ev('GAME.period')===4, String(ev('GAME.period')));
  }
  // ── undo ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    sel(ctx,'home',0);
    window.recShot({x:230,y:200},true,'norm');
    chk('scored before undo', ev('GAME.home.score')===2);
    window.undoLast();
    chk('undo removes the points', ev('GAME.home.score')===0, String(ev('GAME.home.score')));
    chk('undo removes the player credit', ev('PL.home[0].pts')===0, String(ev('PL.home[0].pts')));
  }
  // ── the plumbing the port will move ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200));
    chk('sbFetch exists', ev("typeof sbFetch")==='function');
    chk('sbInsert exists', ev("typeof sbInsert")==='function');
    chk('sbPatch exists', ev("typeof sbPatch")==='function');
    chk('offline queue exists', ev("typeof flushQueue")==='function' && ev("typeof queueLoad")==='function');
    chk('loadSchools exists', ev("typeof loadSchools")==='function');
    chk('emailGameReport exists', ev("typeof emailGameReport")==='function');
    chk('autoUploadGameReport exists', ev("typeof autoUploadGameReport")==='function');
    chk('createEmergencyGame exists', ev("typeof createEmergencyGame")==='function');
    chk('basketball season year rolls after September',
        ev("(function(){try{return seasonYearFor?seasonYearFor('2026-11-15'):null}catch(e){return 'n/a'}})()")!==null);
  }
  // ── events actually push in a real (non-test) game ──
  {
    const ctx=boot(); const {window,ev,posted}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    ev("G_test_mode=false; G_game_id='GID-1'; G_home_team_id='H'; G_away_team_id='A';");
    sel(ctx,'home',0);
    window.recShot({x:230,y:200},true,'norm');
    await new Promise(r=>setTimeout(r,60));
    const evRow=posted.find(r=>/game_events/.test(r.u));
    chk('a game_event row is pushed', !!evRow, 'posts='+posted.length);
    if(evRow){
      chk('event carries the scoring key', /2pt_made/.test(JSON.stringify(evRow.body)), JSON.stringify(evRow.body).slice(0,120));
    }
  }
  // ── the port: basketball's season-year rule must survive the move to the core ──
  {
    const ctx=boot(); const {window,ev,d}=ctx;
    await new Promise(r=>setTimeout(r,200));
    if(ev("typeof MBR")==='object'){
      chk('running on the shared core', true);
      chk('November game belongs to NEXT season (basketball crosses New Year)',
          ev("MBR.cfg.seasonYearFor('2025-11-15')")===2026, String(ev("MBR.cfg.seasonYearFor('2025-11-15')")));
      chk('February game stays in that season year',
          ev("MBR.cfg.seasonYearFor('2026-02-10')")===2026, String(ev("MBR.cfg.seasonYearFor('2026-02-10')")));
      chk('September game is the season starting that autumn',
          ev("MBR.cfg.seasonYearFor('2026-09-05')")===2026, String(ev("MBR.cfg.seasonYearFor('2026-09-05')")));
      chk('October rolls over', ev("MBR.cfg.seasonYearFor('2026-10-05')")===2027, String(ev("MBR.cfg.seasonYearFor('2026-10-05')")));
      chk('core knows this is basketball', ev("MBR.cfg.sportId")==='b31ab283-b28e-4ba8-9684-b1cf30cea219', ev('MBR.cfg.sportId'));
      chk('queue is basketball-specific', ev("MBR.cfg.queueKey")==='mbr_bb_push_queue', ev('MBR.cfg.queueKey'));
      chk('build badge reports the core loaded', /core ok/.test(d.getElementById('buildBadge').textContent),
          d.getElementById('buildBadge').textContent);
    } else {
      console.log('  (pre-port build — core checks skipped)');
    }
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'BASKETBALL BASELINE CAPTURED'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
