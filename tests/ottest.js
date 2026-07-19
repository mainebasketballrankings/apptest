const {JSDOM}=require('jsdom'); const fs=require('fs');
const html=require('./loadapp.js')();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
window.scrollTo=()=>{};window.alert=()=>{};const ev=c=>window.eval(c);const R=(s,i=0)=>`G.teams.${s}.roster[${i}]`;
const pbp=()=>JSON.parse(ev("JSON.stringify(G.pbp.map(x=>x.text.replace(/<[^>]+>/g,'')))"));
const vis=id=>d.getElementById(id).style.display==='flex';
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
// score a TD+PAT for the current offense
function tdPat(){
  const s=ev('G.poss'); const i=s==='away'?0:0;
  ev(`G.ballOn=95;G.down=1;G.distance=5;`);
  window.openRun(); ev(`G.pend.rusher=${R(s,1)}; G.pend.toSpot=100;`); window.confirmRun();
  window.openKick(); ev(`G.pend.sub='pat';G.pend.patMode='kick';G.pend.patKicker=${R(s,6)};G.pend.patGood=true;`); window.confirmKick();
}
function turnoverOnDowns(){
  // 4 incomplete-style runs for no gain from the 10 (ballOn 90) -> downs
  for(let k=0;k<4;k++){ window.openRun(); ev(`G.pend.rusher=${R(ev('G.poss'),1)}; G.pend.toSpot=${ev('G.ballOn')};`); window.confirmRun(); }
}
(async()=>{
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true'); await window.startGame(); await new Promise(r=>setTimeout(r,20));

  // Force a tied game at end of Q4
  ev("G.quarter=4; G.clock=0; G.score.away=14; G.score.home=14; G.kickoffPending=false; G.poss='home'; G.curDrive=null;");
  window.advanceQuarter();
  chk('end of tied Q4 opens OT coin toss', vis('ovOT') && ev('G.quarter')===5, 'ovOT='+vis('ovOT')+' q='+ev('G.quarter'));
  chk('coin-toss buttons name both teams', d.getElementById('otAwayBtn').textContent.includes('Shrine East'));

  // East wins toss, ball first
  window.otPickFirst('away');
  chk('East starts 1st & Goal at the 10 (ballOn 90)', ev("G.poss")==='away' && ev('G.ballOn')===90 && ev('G.down')===1, `poss=${ev('G.poss')} ball=${ev('G.ballOn')} down=${ev('G.down')}`);
  chk('OT possession has no kickoff pending', ev('G.kickoffPending')===false);

  // East scores TD+PAT (21)
  tdPat();
  chk('East 21 after OT TD+PAT', ev('G.score.away')===21, 'east='+ev('G.score.away'));
  chk('possession handed to West at the 10', ev('G.poss')==='home' && ev('G.ballOn')===90, `poss=${ev('G.poss')} ball=${ev('G.ballOn')}`);
  chk('otPossCount=1 after first score', ev('G.otPossCount')===1, 'cnt='+ev('G.otPossCount'));

  // --- Branch 1: West also scores -> re-tie -> OT2 coin toss ---
  tdPat();
  chk('West 21 (re-tied)', ev('G.score.home')===21, 'west='+ev('G.score.home'));
  chk('re-tie opens OT2 coin toss', vis('ovOT') && ev('G.quarter')===6, 'ovOT='+vis('ovOT')+' q='+ev('G.quarter'));

  // OT2: West first, West scores; East fails -> West wins, End Game opens
  window.otPickFirst('home');
  chk('OT2 West starts at the 10', ev('G.poss')==='home' && ev('G.ballOn')===90);
  tdPat();  // West 28
  chk('West 28 in OT2', ev('G.score.home')===28, 'west='+ev('G.score.home'));
  chk('East gets OT2 possession', ev('G.poss')==='away' && ev('G.otPossCount')===1, `poss=${ev('G.poss')} cnt=${ev('G.otPossCount')}`);
  turnoverOnDowns();  // East fails
  chk('East failed -> West wins, End Game overlay opens', vis('ovEnd'), 'ovEnd='+vis('ovEnd'));
  const p=pbp();
  chk('PBP announces OT winner', p.some(t=>/FINAL \(OT\).*WEST wins/i.test(t)), JSON.stringify(p.slice(-3)));
  chk('final score 21-28', ev('G.score.away')===21 && ev('G.score.home')===28, `${ev('G.score.away')}-${ev('G.score.home')}`);

  console.log('\n'+(fails?fails+' FAIL(s)':'OVERTIME ALL PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
