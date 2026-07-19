const {JSDOM}=require('jsdom'); const fs=require('fs');
const html=require('./loadapp.js')();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
window.scrollTo=()=>{}; window.alert=()=>{};
const ev=c=>window.eval(c);
const pbp=()=>JSON.parse(ev("JSON.stringify(G.pbp.map(x=>x.text.replace(/<[^>]+>/g,'')))"));
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
(async()=>{
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  ['awayName','homeName'].forEach(()=>{});
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true'); await window.startGame(); await new Promise(r=>setTimeout(r,20));

  // ----- Blocked PUNT with blocker credit -----
  // West punting on 4th; EAST is the receiving/blocking team. defSide()=away here.
  ev("G.kickoffPending=false; G.poss='home'; G.ballOn=30; G.down=4; G.distance=8;");
  const blockerName=ev("G.teams.away.roster.find(p=>p.name).name");
  window.openKick();
  ev(`G.pend.sub='punt'; G.pend.puntPunter=G.teams.home.roster.find(p=>p.name);
      G.pend.puntBlocked=true; G.pend.puntBlocker=G.teams.away.roster.find(p=>p.name);
      G.pend.puntBlockRecov='recv'; G.pend.puntBlockRecoverer=G.teams.away.roster.find(p=>p.name);
      G.pend.puntBlockSpot=60; G.pend.puntBlockTD=false;`);
  window.confirmKick();
  const p1=pbp();
  chk('#5 blocked punt PBP names blocker', p1.some(t=>/BLOCKED by /i.test(t)), JSON.stringify(p1.slice(-2)));
  chk('#5 blocked-punt blocker credited blk=1', ev(`(G.stats.away['${blockerName}']||{}).blk`)===1, 'blk='+ev(`(G.stats.away['${blockerName}']||{}).blk`));

  // ----- Blocked FG with blocker credit -----
  ev("G.kickoffPending=false; G.poss='home'; G.ballOn=70; G.down=4; G.distance=3;");
  const fgBlocker=ev("G.teams.away.roster.find(p=>p.name).name");
  window.openKick();
  ev(`G.pend.sub='fg'; G.pend.fgKicker=G.teams.home.roster.find(p=>p.name);
      G.pend.fgBlocked=true; G.pend.fgBlocker=G.teams.away.roster.find(p=>p.name);
      G.pend.fgBlockRecov='def'; G.pend.fgBlockRecoverer=G.teams.away.roster.find(p=>p.name);
      G.pend.fgBlockSpot=40; G.pend.fgBlockTD=false;`);
  window.confirmKick();
  const p2=pbp();
  chk('#5 blocked FG PBP names blocker', p2.some(t=>/Field goal.*BLOCKED by /i.test(t)), JSON.stringify(p2.slice(-2)));
  chk('#5 blocked-FG blocker credited blk>=1', ev(`(G.stats.away['${fgBlocker}']||{}).blk`)>=1, 'blk='+ev(`(G.stats.away['${fgBlocker}']||{}).blk`));

  console.log('\n'+(fails?fails+' FAIL(s)':'FLOW #5 ALL PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e);process.exit(2);});
