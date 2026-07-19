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
(async()=>{
  const {window,d,ev}=await game();
  ev("G.kickoffPending=false;G.poss='home';G.ballOn=30;G.down=1;G.distance=10;");
  window.openRun();
  const body=d.getElementById('ovPlayBody').innerHTML;
  chk('run overlay shows gain chips', /gain-chip/.test(body) && />\+4</.test(body));
  chk('chips include losses and big gains', />-5</.test(body) && />\+20</.test(body));
  // one tap = spot set, no picker
  window.setRunGain(34);
  chk('tapping +4 sets toSpot to 34', ev('G.pend.toSpot')===34, 'toSpot='+ev('G.pend.toSpot'));
  chk('active chip reflected after tap', /gain-chip active/.test(d.getElementById('ovPlayBody').innerHTML));
  ev(`G.pend.rusher=${R('home',1)};`); window.confirmRun();
  chk('play saved with +4 gain', ev(`(G.stats.home[${R('home',1)}.name]||{}).ryd`)===4, 'ryd='+ev(`(G.stats.home[${R('home',1)}.name]||{}).ryd`));
  chk('down/distance advanced correctly', ev('G.down')===2 && ev('G.distance')===6, `${ev('G.down')} & ${ev('G.distance')}`);
  // pass completion chips
  ev("G.ballOn=40;G.down=1;G.distance=10;");
  window.openPass(); ev("G.pend.sub='comp';"); window.renderPass();
  chk('pass overlay shows gain chips', /gain-chip/.test(d.getElementById('ovPlayBody').innerHTML));
  window.setPassGain(52);
  chk('tapping +12 sets pass toSpot', ev('G.pend.toSpot')===52, 'toSpot='+ev('G.pend.toSpot'));
  // sack chips are negative
  window.openPass(); ev("G.pend.sub='sack';"); window.renderPass();
  const sb=d.getElementById('ovPlayBody').innerHTML;
  chk('sack overlay shows loss chips', /gain-chip/.test(sb) && />-7</.test(sb));
  chk('sack chips have no positive gains', !/>\+10</.test(sb));
  console.log('\n'+(fails?fails+' FAIL(s)':'GAIN CHIPS PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
