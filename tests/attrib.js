const {JSDOM}=require('jsdom'); const fs=require('fs');
const html=require('./loadapp.js')();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
window.scrollTo=()=>{}; window.alert=()=>{};
const ev=c=>window.eval(c); const R=(s,i=0)=>`G.teams.${s}.roster[${i}]`;
const pbp=()=>JSON.parse(ev("JSON.stringify(G.pbp.map(x=>x.text.replace(/<[^>]+>/g,'')))"));
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
(async()=>{
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true'); await window.startGame(); await new Promise(r=>setTimeout(r,20));
  // West punting on 4th, EAST blocks and returns for TD
  ev("G.kickoffPending=false; G.poss='home'; G.ballOn=30; G.down=4; G.distance=8;");
  const eastB=ev('G.score.away');
  window.openKick();
  ev(`G.pend.sub='punt'; G.pend.puntPunter=${R('home',6)};
      G.pend.puntBlocked=true; G.pend.puntBlocker=${R('away',9)};
      G.pend.puntBlockRecov='recv'; G.pend.puntBlockRecoverer=${R('away',9)};
      G.pend.puntBlockTD=true;`);
  window.confirmKick();
  // clear PAT
  window.openKick(); ev(`G.pend.sub='pat';G.pend.patMode='kick';G.pend.patKicker=${R('away',6)};G.pend.patGood=true;`); window.confirmKick();
  chk('EAST scored blocked-punt return TD (+7)', ev('G.score.away')===eastB+7, `east ${eastB}->${ev('G.score.away')}`);
  chk('EAST credited a Def/ST TD', ev("teamTotals('away').defstTD")>=1, 'defstTD='+ev("teamTotals('away').defstTD"));
  const p=pbp();
  chk('West drive relabeled as "Returned for TD EAST"', p.some(t=>/WEST drive:.*Returned for TD EAST/i.test(t)), JSON.stringify(p.filter(t=>/drive:/.test(t)).slice(-2)));
  // teamTotals exposes redZone as a "made-att" string, not rzTD. A blocked-punt
  // return TD belongs to the DEFENSE, so the offense's red-zone line stays 0-0.
  chk('West NOT credited a red-zone TD', ev("teamTotals('home').redZone")==='0-0', "home.redZone="+ev("teamTotals('home').redZone"));
  console.log('\n'+(fails?fails+' FAIL(s)':'ATTRIBUTION PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
