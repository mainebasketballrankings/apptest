const {JSDOM}=require('jsdom'); const fs=require('fs');
const dom=new JSDOM(require('./loadapp.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
window.scrollTo=()=>{};window.alert=()=>{};const ev=c=>window.eval(c);
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
(async()=>{
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  d.getElementById('homeNameInp').value='Shrine West';d.getElementById('awayNameInp').value='Shrine East';
  d.getElementById('homeAbbrInp').value='WEST';d.getElementById('awayAbbrInp').value='EAST';
  d.getElementById('fieldDirSel').value='away';d.getElementById('openKickSel').value='home';d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true');await window.startGame();await new Promise(r=>setTimeout(r,20));
  // burn timeouts in 1st half
  ev("G.timeouts.away=0; G.timeouts.home=1; G.quarter=2; G.clock=0; G.curDrive=null;");
  window.advanceQuarter(); // -> halftime (Q3)
  chk('halftime resets both teams to 3 timeouts', ev('G.timeouts.away')===3 && ev('G.timeouts.home')===3, `${ev('G.timeouts.away')}/${ev('G.timeouts.home')}`);
  // go to OT tied
  ev("G.quarter=4; G.clock=0; G.score.away=14; G.score.home=14; G.timeouts.away=2; G.timeouts.home=3; G.curDrive=null; G.kickoffPending=false;");
  window.advanceQuarter();
  chk('OT period sets 1 timeout each', ev('G.timeouts.away')===1 && ev('G.timeouts.home')===1, `${ev('G.timeouts.away')}/${ev('G.timeouts.home')}`);
  console.log('\n'+(fails?fails+' FAIL(s)':'TIMEOUT RESET PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
