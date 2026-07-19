const {JSDOM}=require('jsdom'); const fs=require('fs');
const html=require('./loadapp.js')();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
window.scrollTo=()=>{};window.alert=()=>{};const ev=c=>window.eval(c);const R=(s,i=0)=>`G.teams.${s}.roster[${i}]`;
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
function tdPat(){ const s=ev('G.poss'); ev(`G.ballOn=95;G.down=1;G.distance=5;`);
  window.openRun(); ev(`G.pend.rusher=${R(s,1)}; G.pend.toSpot=100;`); window.confirmRun();
  window.openKick(); ev(`G.pend.sub='pat';G.pend.patMode='kick';G.pend.patKicker=${R(s,6)};G.pend.patGood=true;`); window.confirmKick(); }
function fieldBallX(){ const svg=d.getElementById('fieldSVG').innerHTML; const m=svg.match(/<ellipse cx="([\d.]+)"/); return m?+m[1]:null; }
(async()=>{
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true'); await window.startGame(); await new Promise(r=>setTimeout(r,20));
  ev("G.quarter=4; G.clock=0; G.score.away=14; G.score.home=14; G.kickoffPending=false; G.poss='home'; G.curDrive=null;");
  window.advanceQuarter();
  window.otPickFirst('home');  // West first
  chk('West OT: ball at 10, no kickoff', ev('G.ballOn')===90 && ev('G.kickoffPending')===false);
  const xWest=fieldBallX();
  tdPat();  // West scores, hands to East
  chk('after West OT score -> East possession', ev('G.poss')==='away' && ev('G.otPossCount')===1);
  chk('East OT: ball at the 10 (ballOn 90)', ev('G.ballOn')===90, 'ball='+ev('G.ballOn'));
  chk('KICKOFF NOT pending after OT hand-off (the bug)', ev('G.kickoffPending')===false, 'koPending='+ev('G.kickoffPending'));
  window.render && window.render();
  const xEast=fieldBallX();
  // ball must be drawn near an end zone (x<=180 or x>=820 in 100..900 field), NOT near midfield (~500 / the 40)
  chk('ball drawn near an end zone, not the kickoff spot', xEast!=null && (xEast<=180 || xEast>=820), 'ballCx='+xEast);
  // ddLabel should read 1st & Goal
  chk('down/distance = 1st & Goal', ev('ddLabel()')==='1st & Goal', ev('ddLabel()'));
  console.log('\n'+(fails?fails+' FAIL(s)':'OT DISPLAY FIX PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
