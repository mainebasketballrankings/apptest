const {JSDOM}=require('jsdom'); const fs=require('fs');
function boot(){
  const dom=new JSDOM(require('./loadapp.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
  const {window}=dom, d=window.document;
  window.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
  window.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}};
  window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
  window.scrollTo=()=>{};window.alert=()=>{};
  return {window,d,ev:c=>window.eval(c)};
}
async function game(){
  const c=boot(); const {window,d,ev}=c;
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true'); await window.startGame(); await new Promise(r=>setTimeout(r,20));
  return c;
}
const R=(s,i=0)=>`G.teams.${s}.roster[${i}]`;
let fails=0; const chk=(n,cond,x='')=>{ if(!cond)fails++; console.log((cond?'PASS':'FAIL'),n,x?('| '+x):''); };
(async()=>{
  // ---- 2-pt conversion stats ----
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=95;G.down=1;G.distance=5;");
    window.openRun(); ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=100;`); window.confirmRun(); // TD
    const nm=ev(`${R('home',2)}.name`);
    const before=ev(`JSON.stringify(G.stats.home['${nm}']||null)`);
    window.openRun(); ev(`G.pend.rusher=${R('home',2)};G.pend.toSpot=100;`); window.confirmRun(); // 2pt run good
    const after=ev(`JSON.stringify(G.stats.home['${nm}']||null)`);
    chk('2-pt run does NOT create/credit rushing stats', before===after, `before=${before} after=${after}`);
    chk('2-pt still scored 2 pts', ev('G.score.home')===8, 'home='+ev('G.score.home'));
  }
  // ---- penalty: offensive holding on 1st & 10 should be 1st & 20, no rush yards ----
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=20;G.down=1;G.distance=10;");
    const nm=ev(`${R('home',1)}.name`);
    window.openRun();
    ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=29;
        G.pend.addPen=true;G.pend.penName='Holding (Off)';G.pend.penYds=10;G.pend.penTeam='home';G.pend.penAuto=false;`);
    window.confirmRun();
    chk('holding: down REPLAYS (still 1st)', ev('G.down')===1, 'down='+ev('G.down'));
    chk('holding: 1st & 20', ev('G.distance')===20, 'dist='+ev('G.distance'));
    chk('holding: ball back to the 10', ev('G.ballOn')===10, 'ball='+ev('G.ballOn'));
    chk('holding: NO rushing yards credited', (ev(`(G.stats.home['${nm}']||{}).ryd`)||0)===0, 'ryd='+ev(`(G.stats.home['${nm}']||{}).ryd`));
  }
  // ---- penalty on a TD play should wipe the points ----
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=80;G.down=1;G.distance=10;G.score.home=0;");
    window.openRun();
    ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=100;
        G.pend.addPen=true;G.pend.penName='Holding (Off)';G.pend.penYds=10;G.pend.penTeam='home';G.pend.penAuto=false;`);
    window.confirmRun();
    chk('penalty on TD play: no points scored', ev('G.score.home')===0, 'home='+ev('G.score.home'));
    chk('penalty on TD play: no pending PAT', ev('G.pendingPAT')===false, 'pendingPAT='+ev('G.pendingPAT'));
  }
  // ---- fumble into own end zone, offense recovers = SAFETY ----
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=1;G.down=1;G.distance=10;G.score.away=0;");
    window.openRun();
    ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=0;G.pend.fumble=true;G.pend.fumRecover='off';G.pend.fumRecoverer=${R('home',3)};G.pend.fumAdvTo=0;`);
    window.confirmRun();
    chk('fumble in own EZ, offense recovers = SAFETY (2 to EAST)', ev('G.score.away')===2, 'east='+ev('G.score.away'));
  }
  // ---- fumble forward into opponent EZ, offense recovers = TD ----
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=97;G.down=1;G.distance=3;G.score.home=0;");
    window.openRun();
    ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=100;G.pend.fumble=true;G.pend.fumRecover='off';G.pend.fumRecoverer=${R('home',3)};G.pend.fumAdvTo=100;`);
    window.confirmRun();
    chk('fumble into opp EZ, offense recovers = TD', ev('G.score.home')===6, 'west='+ev('G.score.home'));
  }
  console.log('\n'+(fails?fails+' FAIL(s) — baseline':'baseline all pass'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
