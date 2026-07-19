const {JSDOM}=require('jsdom'); const fs=require('fs');
const dom=new JSDOM(require('./loadapp.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
window.scrollTo=()=>{};window.alert=()=>{};const ev=c=>window.eval(c);const R=(s,i=0)=>`G.teams.${s}.roster[${i}]`;
const pbp=()=>JSON.parse(ev("JSON.stringify(G.pbp.map(x=>x.text.replace(/<[^>]+>/g,'')))"));
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
async function setup(){
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true'); await window.startGame(); await new Promise(r=>setTimeout(r,20));
}
(async()=>{
  await setup();
  // Set up a kickoff: WEST kicking off to EAST (recv=away=East, kicking=home=West)
  ev("G.kickoffPending=true; G.poss='away'; G.ballOn=25; G.down=1; G.distance=10; G.curDrive={team:'away',plays:0,startBallOn:25,yards:0};");
  // Onside — KICKING team (West) recovers at midfield (their frame 50)
  window.openKick();
  ev(`G.pend.sub='kickoff'; G.pend.koKicker=${R('home',6)}; G.pend.koOnside=true;
      G.pend.koOnsideRecov='kicking'; G.pend.koOnsideRecoverer=${R('home',5)}; G.pend.koOnsideSpot=48;`);
  window.confirmKick();
  chk('onside recovered by KICKING → West possession', ev('G.poss')==='home', 'poss='+ev('G.poss'));
  chk('West 1st & 10 at recovery spot (ballOn 48)', ev('G.down')===1 && ev('G.ballOn')===48, `down=${ev('G.down')} ball=${ev('G.ballOn')}`);
  chk('no kickoff pending after onside', ev('G.kickoffPending')===false);
  let p=pbp(); chk('PBP shows ONSIDE KICK recovered by West', p.some(t=>/ONSIDE KICK.*WEST/i.test(t)), JSON.stringify(p.slice(-2)));

  // Reset: onside RECEIVING team recovers (normal-ish)
  await setup();
  ev("G.kickoffPending=true; G.poss='away'; G.ballOn=25; G.down=1; G.distance=10; G.curDrive={team:'away',plays:0,startBallOn:25,yards:0};");
  window.openKick();
  ev(`G.pend.sub='kickoff'; G.pend.koKicker=${R('home',6)}; G.pend.koOnside=true;
      G.pend.koOnsideRecov='receiving'; G.pend.koOnsideRecoverer=${R('away',5)}; G.pend.koOnsideSpot=45;`);
  window.confirmKick();
  chk('onside recovered by RECEIVING → East keeps possession', ev('G.poss')==='away', 'poss='+ev('G.poss'));
  chk('East 1st & 10 at recovery spot (ballOn 45)', ev('G.down')===1 && ev('G.ballOn')===45, `down=${ev('G.down')} ball=${ev('G.ballOn')}`);
  chk('no kickoff pending', ev('G.kickoffPending')===false);
  p=pbp(); chk('PBP shows ONSIDE KICK recovered by East', p.some(t=>/ONSIDE KICK.*EAST/i.test(t)), JSON.stringify(p.slice(-2)));

  console.log('\n'+(fails?fails+' FAIL(s)':'ONSIDE KICK ALL PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
