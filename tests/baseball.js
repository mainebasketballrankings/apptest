// Behavioural baseline for the baseball/softball scorer, captured BEFORE the
// move to mbr-core.js. This is the most intricate of the four — slot-based
// lineups, resolvePlayer as the single source of truth, group undo — so the
// point here is to pin down current behaviour, not to judge it.
const {JSDOM}=require('jsdom');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
function boot(){
  const posted=[];
  const stub=(url,opt)=>{
    const u=String(url), m=(opt&&opt.method)||'GET';
    if(m!=='GET'){ try{posted.push({u,m,body:JSON.parse(opt.body||'{}')});}catch(e){posted.push({u,m});}
      return Promise.resolve({ok:true,status:201,json:()=>Promise.resolve([{id:'G1'}]),text:()=>Promise.resolve('')}); }
    let data=[];
    if(/teams\?/.test(u)) data=[{id:'T1',school_name:'ZZ Test North',sport_id:'c87a4d6c-a471-47e1-b6a0-d1643d942bf0'}];
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(data),text:()=>Promise.resolve('[]')});
  };
  const dom=new JSDOM(require('./bbload.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{}; w.confirm=()=>true;
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d:window.document,ev:c=>window.eval(c),posted};
}
async function game(ctx){
  const {window,d,ev}=ctx;
  d.getElementById('awayNameInp').value='ZZ Test South';
  d.getElementById('homeNameInp').value='ZZ Test North';
  // Build the lineups with the app's OWN factory so the shape always matches —
  // these entries carry a nested stats object the scorer writes into directly.
  ev(`['away','home'].forEach(sd=>{
        G.teams[sd].lineup = ['P','C','1B','2B','3B','SS','LF','CF','RF']
          .map((pos,i)=> Object.assign(newPlayer(i+1, 'Player '+(i+1), pos), {number:String(i+1)}));
        G.teams[sd].bench = [];
        G.teams[sd].slots = [];
      });`);
  ev("G_test_mode=true;");
  await window.startGame();
  await new Promise(r=>setTimeout(r,60));
}
(async()=>{
  // ── boots and starts ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200));
    chk('boots without throwing', ev("typeof G")==='object');
    await game(ctx);
    chk('starts top of the 1st', ev('G.inning')===1 && ev("G.half")==='top', `${ev('G.half')} ${ev('G.inning')}`);
    chk('no outs, empty count', ev('G.outs')===0 && ev('G.balls')===0 && ev('G.strikes')===0);
    chk('bases empty', ev('!G.bases[1] && !G.bases[2] && !G.bases[3]')===true);
    chk('scoreless', ev('G.runs.away')===0 && ev('G.runs.home')===0);
    chk('lineups nine deep', ev('G.teams.away.lineup.length')===9 && ev('G.teams.home.lineup.length')===9);
  }
  // ── outs and the half-inning ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    window.doStrikeout('swinging');
    chk('strikeout records an out', ev('G.outs')===1, String(ev('G.outs')));
    chk('count resets after the out', ev('G.balls')===0 && ev('G.strikes')===0);
    window.doStrikeout('swinging');
    window.doStrikeout('swinging');
    // Three outs clears the bases and asks before flipping — the same "don't skip
    // a period by accident" guard basketball uses. confirmHalf() does the flip.
    chk('third out clears the bases and outs', ev('G.outs')===0 && ev('!G.bases[1]')===true);
    chk('half does not flip until confirmed', ev("G.half")==='top', ev('G.half'));
    window.confirmHalf();
    chk('confirming flips to the bottom half', ev("G.half")==='bottom', ev('G.half'));
    chk('still the 1st', ev('G.inning')===1, String(ev('G.inning')));
  }
  // ── walks put a runner on ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    window.doWalk('bb');
    chk('walk puts a runner on first', !!ev('G.bases[1]'), 'first='+ev('JSON.stringify(G.bases[1])').slice(0,40));
    chk('walk is not an out', ev('G.outs')===0);
    chk('batting order advances', ev('G.batIdx.away')===1, String(ev('G.batIdx.away')));
  }
  // ── the batting order wraps ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    for(let i=0;i<9;i++) window.doWalk('bb');
    chk('order wraps back to the top after nine', ev('G.batIdx.away')===0, String(ev('G.batIdx.away')));
  }
  // ── runs score ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    for(let i=0;i<4;i++) window.doWalk('bb');     // bases loaded, then forced in
    chk('a forced walk drives in a run', ev('G.runs.away')>=1, 'away runs='+ev('G.runs.away'));
  }
  // ── undo ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    // Snapshots are taken by logPitch(), which then calls doStrikeout() on the
    // third strike. Calling doStrikeout directly skips the snapshot, so undo
    // must be exercised through the real pitch path.
    window.logPitch('Ks'); window.logPitch('Ks'); window.logPitch('Ks');   // 3 swinging strikes
    chk('three strikes is an out', ev('G.outs')===1, String(ev('G.outs')));
    window.doUndo();
    chk('undo rolls the strikeout back', ev('G.outs')===0, String(ev('G.outs')));
  }
  // ── plumbing the port will move ──
  {
    const ctx=boot(); const {ev}=ctx;
    await new Promise(r=>setTimeout(r,200));
    chk('sbFetch exists', ev("typeof sbFetch")==='function');
    chk('sbInsert exists', ev("typeof sbInsert")==='function');
    chk('offline queue exists', ev("typeof flushQueue")==='function');
    // Baseball loads schools in an IIFE into ALL_SCHOOLS rather than a named
    // global — a third separate copy of the same logic, which the port replaces.
    chk('school list is populated somewhere', ev("typeof ALL_SCHOOLS")==='object');
    chk('emailGameReport exists', ev("typeof emailGameReport")==='function');
    chk('autoUploadGameReport exists', ev("typeof autoUploadGameReport")==='function');
  }
  // ── events push in a real game ──
  {
    const ctx=boot(); const {window,ev,posted}=ctx;
    await new Promise(r=>setTimeout(r,200)); await game(ctx);
    ev("G_test_mode=false; G_game_id='GID-1'; G_home_team_id='H'; G_away_team_id='A';");
    window.doStrikeout('swinging');
    await new Promise(r=>setTimeout(r,60));
    chk('a row is pushed for a real game', posted.some(r=>/game_events/.test(r.u)), 'posts='+posted.length);
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'BASEBALL BASELINE CAPTURED'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
