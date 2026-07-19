const {JSDOM}=require('jsdom'); const fs=require('fs');
const html=require('./loadapp.js')();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
window.scrollTo=()=>{};window.alert=()=>{};const ev=c=>window.eval(c);const R=(s,i=0)=>`G.teams.${s}.roster[${i}]`;
const scoreLog=()=>JSON.parse(ev("JSON.stringify(G.scoreLog.map(x=>x.desc))"));
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
(async()=>{
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true'); await window.startGame(); await new Promise(r=>setTimeout(r,20));
  // TD then FAILED 2-pt via KICK OVERLAY (patMode='two'), carrier = roster[1]
  ev("G.kickoffPending=false; G.poss='home'; G.ballOn=95; G.down=1; G.distance=5;");
  window.openRun(); ev(`G.pend.rusher=${R('home',1)}; G.pend.toSpot=100;`); window.confirmRun();  // TD
  window.openKick(); ev(`G.pend.sub='pat'; G.pend.patMode='two'; G.pend.patConverted=false; G.pend.patPlayer=${R('home',1)};`); window.confirmKick();
  let sl=scoreLog();
  chk('failed 2-pt via kick overlay folds "(2-pt NO GOOD)"', sl.some(x=>/2-pt NO GOOD\)$/.test(x)), JSON.stringify(sl.slice(-1)));

  // Another TD then GOOD 2-pt via kick overlay with a named carrier (Ayoob-style)
  ev("G.kickoffPending=false; G.poss='home'; G.ballOn=95; G.down=1; G.distance=5;");
  const who=ev(`${R('home',2)}.name`).split(' ').pop();
  window.openRun(); ev(`G.pend.rusher=${R('home',1)}; G.pend.toSpot=100;`); window.confirmRun();  // TD
  window.openKick(); ev(`G.pend.sub='pat'; G.pend.patMode='two'; G.pend.patConverted=true; G.pend.patPlayer=${R('home',2)};`); window.confirmKick();
  sl=scoreLog();
  chk('good 2-pt via kick overlay folds "(<Name> 2-pt GOOD)"', sl.some(x=> new RegExp(`\\(${who} 2-pt GOOD\\)$`).test(x)), JSON.stringify(sl.slice(-1)));

  // Good 2-pt via RUN play path (resolveConversion): TD then run-in the 2pt
  ev("G.kickoffPending=false; G.poss='away'; G.ballOn=95; G.down=1; G.distance=5;");
  window.openRun(); ev(`G.pend.rusher=${R('away',1)}; G.pend.toSpot=100;`); window.confirmRun();  // TD (pendingPAT)
  const who2=ev(`${R('away',1)}.name`).split(' ').pop();
  window.openRun(); ev(`G.pend.rusher=${R('away',1)}; G.pend.toSpot=100;`); window.confirmRun();  // 2-pt run good
  sl=scoreLog();
  chk('good 2-pt via run play folds name too', sl.some(x=> new RegExp(`\\(${who2} 2-pt GOOD\\)$`).test(x)), JSON.stringify(sl.slice(-1)));

  console.log('\n'+(fails?fails+' FAIL(s)':'2-PT SUMMARY PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
