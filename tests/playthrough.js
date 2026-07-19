const {JSDOM}=require('jsdom'); const fs=require('fs');
const html=require('./loadapp.js')();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
window.scrollTo=()=>{}; window.alert=()=>{}; window.jspdf=require('jspdf');
const ev=c=>window.eval(c);
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
const R=(s,i=0)=>`G.teams.${s}.roster[${i}]`;
const pbp=()=>JSON.parse(ev("JSON.stringify(G.pbp.map(x=>x.text.replace(/<[^>]+>/g,'')))"));
(async()=>{
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true'); await window.startGame(); await new Promise(r=>setTimeout(r,20));
  const errs=[]; const safe=(label,fn)=>{ try{ fn(); }catch(e){ errs.push(label+': '+e.message); } };

  // FG by West + check drive summary ordering (summary AFTER field goal line)
  ev("G.kickoffPending=false; G.poss='home'; G.ballOn=70; G.down=4; G.distance=3;");
  safe('fg', ()=>{ window.openKick(); ev(`G.pend.sub='fg'; G.pend.fgKicker=${R('home',6)}; G.pend.fgGood=true; G.pend.fgBlocked=false;`); window.confirmKick(); });
  chk('FG scored (home 3)', ev('G.score.home')===3, 'home='+ev('G.score.home'));
  { const p=pbp(); const iFG=p.findIndex(t=>/FIELD GOAL/i.test(t)); const iS=p.findIndex(t=>/WEST drive:.*Field goal/i.test(t));
    chk('#3 FG drive-summary AFTER field-goal line', iS>iFG&&iFG>=0, `FG@${iFG} SUM@${iS}`); }

  // EAST receives kickoff (post-FG). Log a normal kickoff return.
  safe('ko', ()=>{ window.openKick(); ev(`G.pend.sub='kickoff'; G.pend.koKicker=${R('home',6)}; G.pend.koReturner=${R('away',5)}; G.pend.koRecAt=5; G.pend.koAdvTo=25; G.pend.koFumble=false;`); window.confirmKick(); });
  chk('post-KO EAST on offense ~own 25', ev('G.poss')==='away', 'poss='+ev('G.poss'));

  // EAST run, then penalty (false start), then punt
  safe('run', ()=>{ window.openRun(); ev(`G.pend.rusher=${R('away',1)}; G.pend.toSpot=${ev('G.ballOn')+4};`); window.confirmRun(); });
  safe('punt', ()=>{ ev("G.down=4; G.distance=6;"); window.openKick(); ev(`G.pend.sub='punt'; G.pend.puntPunter=${R('away',6)}; G.pend.puntLand=${ev('G.ballOn')+35}; G.pend.puntEnd=${ev('G.ballOn')+35}; G.pend.puntBlocked=false; G.pend.puntSafety=false; G.pend.puntTouchback=false; G.pend.puntFumble=false;`); window.confirmKick(); });
  chk('after punt West on offense', ev('G.poss')==='home', 'poss='+ev('G.poss'));

  // undo the punt
  const scoreBefore=ev('G.score.home');
  safe('undo', ()=>{ window.doUndo(); });
  chk('undo did not throw / score stable', errs.filter(e=>/undo/.test(e)).length===0 && ev('G.score.home')===scoreBefore);

  // advance quarters to halftime and beyond (ends-change + FIELD_FRAME flips)
  safe('adv1', ()=>window.advanceQuarter());
  safe('adv2', ()=>window.advanceQuarter());  // halftime
  chk('reached Q3 (halftime processed)', ev('G.quarter')===3, 'q='+ev('G.quarter'));
  safe('adv3', ()=>window.advanceQuarter());
  chk('FIELD_FRAME flips relative to label in Q4', ev('FIELD_FRAME')!==ev('FIELD_LABEL_FRAME'), `FF=${ev('FIELD_FRAME')} LF=${ev('FIELD_LABEL_FRAME')}`);

  // safety
  ev("G.kickoffPending=false; G.poss='home'; G.ballOn=2; G.down=1; G.distance=10;");
  const eastBefore=ev('G.score.away');
  safe('safety', ()=>{ window.openRun(); ev(`G.pend.rusher=${R('home',1)}; G.pend.toSpot=0;`); window.confirmRun(); });
  chk('safety scored 2 for EAST', ev('G.score.away')===eastBefore+2, `east ${eastBefore}->${ev('G.score.away')}`);

  // finalize + PDF
  let pdfOK=false,pdfErr='';
  try{ ev("_gameFinalized=false;"); const blob=await window.generatePDF({returnBlob:true}); pdfOK=!!blob; }catch(e){ pdfErr=e.message; }
  chk('full-game PDF generates', pdfOK, pdfErr);

  chk('no runtime errors across playthrough', errs.length===0, errs.join(' || '));
  console.log('\n'+(fails?fails+' FAIL(s)':'PLAYTHROUGH ALL PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
