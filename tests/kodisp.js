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
const ballCx=d=>{const m=d.getElementById('fieldSVG').innerHTML.match(/<ellipse cx="([\d.]+)"/);return m?+m[1]:null;};
// X(y)=100+y*8 in the label frame; away is the LEFT team here
const X=y=>100+y*8;
(async()=>{
  const {window,d,ev}=await game();
  // WEST kicking off to EAST. FIELD_LABEL_FRAME='away' (East left, West right).
  ev("G.kickoffPending=true;G.poss='away';G.ballOn=25;G.down=1;G.distance=10;G.koFrom=40;");
  window.render();
  chk('scoreboard says Kickoff, not a down', d.getElementById('sbDD').textContent==='Kickoff', d.getElementById('sbDD').textContent);
  chk('label reads kick from WEST 40 (not EAST 25)', /kick from WEST 40/.test(d.getElementById('sbBallOn').textContent), d.getElementById('sbBallOn').textContent);
  // West's own 40 = 60 yards from East's goal (left) -> X(60)=580
  chk('ball drawn on WEST 40 (x=580)', Math.abs(ballCx(d)-X(60))<0.6, 'cx='+ballCx(d));

  // now an out-of-bounds re-kick moves it to the 35
  window.openKick(); ev(`G.pend.sub='kickoff';G.pend.koKicker=${R('home',6)};G.pend.koOOB=true;G.pend.koOOBChoice='rekick';`); window.confirmKick();
  chk('koFrom moved to 35', ev('G.koFrom')===35, 'koFrom='+ev('G.koFrom'));
  chk('label now reads kick from WEST 35', /kick from WEST 35/.test(d.getElementById('sbBallOn').textContent), d.getElementById('sbBallOn').textContent);
  // West's 35 = 65 from East goal -> X(65)=620
  chk('BALL MOVED to the 35 (x=620)', Math.abs(ballCx(d)-X(65))<0.6, 'cx='+ballCx(d));

  // safety free kick from the 20
  ev("G.kickoffPending=true;G.poss='away';G.koFrom=20;"); window.render();
  chk('safety free kick draws at WEST 20 (x=740)', Math.abs(ballCx(d)-X(80))<0.6, 'cx='+ballCx(d));
  chk('label reads kick from WEST 20', /kick from WEST 20/.test(d.getElementById('sbBallOn').textContent), d.getElementById('sbBallOn').textContent);

  // after the kickoff is fielded, normal down/distance returns
  window.openKick(); ev(`G.pend.sub='kickoff';G.pend.koKicker=${R('home',6)};G.pend.koReturner=${R('away',5)};G.pend.koRecAt=5;G.pend.koAdvTo=25;`); window.confirmKick();
  chk('after the kick: back to down & distance', /1st/.test(d.getElementById('sbDD').textContent), d.getElementById('sbDD').textContent);
  chk('after the kick: ball on EAST 25', /ball on EAST 25/.test(d.getElementById('sbBallOn').textContent), d.getElementById('sbBallOn').textContent);
  console.log('\n'+(fails?fails+' FAIL(s)':'KICKOFF DISPLAY PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
