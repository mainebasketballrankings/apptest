const {JSDOM}=require('jsdom'); const fs=require('fs');
function boot(){
  const dom=new JSDOM(require('./loadapp.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
  const {window}=dom,d=window.document;
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
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
const pbp=ev=>JSON.parse(ev("JSON.stringify(G.pbp.map(x=>x.text.replace(/<[^>]+>/g,'')))"));
(async()=>{
  // ── RUN FUMBLE → TOUCHBACK (his case): fumbled at opp 1, into EZ, defense recovers there
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=95;G.down=1;G.distance=5;");
    const nm=ev(`${R('home',1)}.name`);
    window.openRun();
    // ran to the opponent 1 (toSpot 99) then fumbled; defense recovers in their own EZ (def frame 0)
    ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=99;G.pend.fumble=true;G.pend.fumRecover='def';G.pend.fumRecoverer=${R('away',3)};G.pend.fumAdvTo=0;`);
    window.confirmRun();
    chk('TOUCHBACK: EAST takes over', ev('G.poss')==='away', 'poss='+ev('G.poss'));
    chk('TOUCHBACK: ball at the 20 (not the 0)', ev('G.ballOn')===20, 'ball='+ev('G.ballOn'));
    chk('TOUCHBACK: no points scored', ev('G.score.away')===0 && ev('G.score.home')===0, `${ev('G.score.away')}-${ev('G.score.home')}`);
    chk('runner KEEPS yardage to the fumble spot (+4)', ev(`(G.stats.home['${nm}']||{}).ryd`)===4, 'ryd='+ev(`(G.stats.home['${nm}']||{}).ryd`));
    chk('runner charged a lost fumble', ev(`(G.stats.home['${nm}']||{}).fumlost`)===1);
    chk('PBP says touchback', pbp(ev).some(t=>/touchback/i.test(t)), JSON.stringify(pbp(ev).slice(-2)));
  }
  // ── RUN FUMBLE → scoop-6 still works (regression on the refactor)
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=50;G.down=1;G.distance=10;");
    window.openRun();
    ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=55;G.pend.fumble=true;G.pend.fumRecover='def';G.pend.fumRecoverer=${R('away',3)};G.pend.fumAdvTo=100;`);
    window.confirmRun();
    chk('scoop-6 still scores for EAST', ev('G.score.away')===6, 'east='+ev('G.score.away'));
  }
  // ── RUN FUMBLE → offense recovers in own EZ = safety (regression)
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=3;G.down=1;G.distance=10;");
    window.openRun();
    ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=1;G.pend.fumble=true;G.pend.fumRecover='off';G.pend.fumRecoverer=${R('home',3)};G.pend.fumAdvTo=0;`);
    window.confirmRun();
    chk('own-EZ recovery = safety for EAST', ev('G.score.away')===2, 'east='+ev('G.score.away'));
  }
  // ── RUN FUMBLE → offense recovers, plain (regression)
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=30;G.down=1;G.distance=10;");
    window.openRun();
    ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=38;G.pend.fumble=true;G.pend.fumRecover='off';G.pend.fumRecoverer=${R('home',3)};G.pend.fumAdvTo=36;`);
    window.confirmRun();
    chk('offense keeps it at the recovery spot (36)', ev('G.ballOn')===36 && ev('G.poss')==='home', `ball=${ev('G.ballOn')} poss=${ev('G.poss')}`);
  }
  // ── KICKOFF OUT OF BOUNDS: re-kick moves the spot 40 → 35
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=true;G.poss='away';G.ballOn=25;G.down=1;G.distance=10;");
    chk('free kick starts at the 40', ev('G.koFrom')===40, 'koFrom='+ev('G.koFrom'));
    window.openKick(); ev(`G.pend.sub='kickoff';G.pend.koKicker=${R('home',6)};G.pend.koOOB=true;G.pend.koOOBChoice='rekick';`); window.confirmKick();
    chk('re-kick: spot moves back to the 35', ev('G.koFrom')===35, 'koFrom='+ev('G.koFrom'));
    chk('re-kick: kickoff still pending', ev('G.kickoffPending')===true);
    chk('re-kick PBP names the new spot', pbp(ev).some(t=>/re-kick from their 35/i.test(t)), JSON.stringify(pbp(ev).slice(-1)));
    // second OOB → 30
    window.openKick(); ev(`G.pend.sub='kickoff';G.pend.koKicker=${R('home',6)};G.pend.koOOB=true;G.pend.koOOBChoice='rekick';`); window.confirmKick();
    chk('second OOB: spot moves to the 30', ev('G.koFrom')===30, 'koFrom='+ev('G.koFrom'));
    // now take it: 25 beyond the 30 = receiving team's 45
    window.openKick(); ev(`G.pend.sub='kickoff';G.pend.koKicker=${R('home',6)};G.pend.koOOB=true;G.pend.koOOBChoice='spot';`); window.confirmKick();
    chk('take-it spot computed from the kick spot (30 → their 45)', ev('G.ballOn')===45, 'ball='+ev('G.ballOn'));
    chk('koFrom resets to 40 after the ball is in play', ev('G.koFrom')===40, 'koFrom='+ev('G.koFrom'));
  }
  // ── normal kickoff resets koFrom; safety sets it to 20
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=true;G.poss='away';G.koFrom=35;");
    window.openKick(); ev(`G.pend.sub='kickoff';G.pend.koKicker=${R('home',6)};G.pend.koReturner=${R('away',5)};G.pend.koRecAt=5;G.pend.koAdvTo=25;`); window.confirmKick();
    chk('normal kickoff resets koFrom to 40', ev('G.koFrom')===40, 'koFrom='+ev('G.koFrom'));
    // safety → free kick from the 20
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=2;G.down=1;G.distance=10;");
    window.openRun(); ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=0;`); window.confirmRun();
    chk('after a safety the free kick is from the 20', ev('G.koFrom')===20, 'koFrom='+ev('G.koFrom'));
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'FUMBLE + KICKOFF-OOB ALL PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
