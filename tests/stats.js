const {JSDOM}=require('jsdom'); const fs=require('fs');
const html=require('./loadapp.js')();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
window.scrollTo=()=>{}; window.alert=()=>{};
// jspdf for the report test
window.jspdf = require('jspdf');
const ev=c=>window.eval(c);
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
const R=(s,i=0)=>`G.teams.${s}.roster[${i}]`;
(async()=>{
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true'); await window.startGame(); await new Promise(r=>setTimeout(r,20));

  // give West a drive: 1st&10 at own 25. Pass complete for 8 (no 1st). Then 3rd&2 conversion run. Then TD pass.
  ev("G.kickoffPending=false; G.poss='home'; G.ballOn=25; G.down=1; G.distance=10;");
  // 1st&10: pass complete +8 -> 3rd? no, 2nd&2
  window.openPass(); ev(`G.pend.sub='comp'; G.pend.passer=${R('home',0)}; G.pend.receiver=${R('home',3)}; G.pend.toSpot=33;`); window.confirmPass();
  chk('after +8 pass: 2nd & 2', ev('G.down')===2 && ev('G.distance')===2, `d=${ev('G.down')} dist=${ev('G.distance')}`);
  // 2nd&2: incomplete
  window.openPass(); ev(`G.pend.sub='incomp'; G.pend.passer=${R('home',0)};`); window.confirmPass();
  chk('after incomplete: 3rd & 2', ev('G.down')===3 && ev('G.distance')===2, `d=${ev('G.down')} dist=${ev('G.distance')}`);
  // 3rd&2: run for first down (33->40)
  window.openRun(); ev(`G.pend.rusher=${R('home',1)}; G.pend.toSpot=40;`); window.confirmRun();
  chk('3rd-down run converts to 1st', ev('G.down')===1, `d=${ev('G.down')}`);
  chk('3rd-down eff = 1-1 (home)', ev("teamTotals('home').third")==='1-1', ev("teamTotals('home').third"));
  chk('rushing 1st down counted', ev("teamTotals('home').fdRush")>=1, 'fdRush='+ev("teamTotals('home').fdRush"));
  // move to red zone and score TD pass
  ev("G.ballOn=85; G.down=1; G.distance=10;");
  window.openPass(); ev(`G.pend.sub='comp'; G.pend.passer=${R('home',0)}; G.pend.receiver=${R('home',4)}; G.pend.toSpot=100;`); window.confirmPass();
  chk('TD pass scored', ev('G.score.home')>=6, 'home='+ev('G.score.home'));
  chk('red zone made-att = 1-1', ev("teamTotals('home').redZone")==='1-1', ev("teamTotals('home').redZone"));
  // PAT
  window.openKick(); ev(`G.pend.sub='pat'; G.pend.patMode='kick'; G.pend.patKicker=${R('home',6)}; G.pend.patGood=true;`); window.confirmKick();

  // check totals shape
  const tt=JSON.parse(ev("JSON.stringify(teamTotals('home'))"));
  console.log('  home totals:', JSON.stringify({plays:tt.totalPlays,yds:tt.totalYds,ypp:tt.yardsPerPlay,pass:tt.passYds,ca:tt.passCA,yppass:tt.yardsPerPass,rush:tt.rushYds,att:tt.rushAtt,yprush:tt.yardsPerRush,third:tt.third,rz:tt.redZone,drives:tt.totalDrives,fdPass:tt.fdPass,fdRush:tt.fdRush}));
  // total plays should be rushAtt(1)+passAtt(3: comp,incomp,comp-TD)+sacks(0)=4
  chk('total plays = 4', tt.totalPlays===4, 'plays='+tt.totalPlays);
  chk('total yards computed', typeof tt.totalYds==='number', 'yds='+tt.totalYds);
  chk('yards/play is decimal string', /^\d+\.\d$/.test(tt.yardsPerPlay), tt.yardsPerPlay);

  // build the live team-compare HTML (no throw) and check it has expanded labels
  const tc=ev("buildTeamCompare()");
  chk('team-compare has 3rd down efficiency row', /3rd down efficiency/.test(tc));
  chk('team-compare has Red Zone row', /Red Zone/.test(tc));
  chk('team-compare has Possession row', /Possession/.test(tc));

  // generate the PDF report (returnBlob) to catch runtime errors in the report code
  let pdfOK=false, pdfErr='';
  try{ const blob=await window.generatePDF({returnBlob:true}); pdfOK=!!blob; }catch(e){ pdfErr=e.message; }
  chk('PDF report generates without error', pdfOK, pdfErr);

  console.log('\n'+(fails?fails+' FAIL(s)':'STATS + REPORT ALL PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
