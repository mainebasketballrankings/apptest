const {JSDOM}=require('jsdom'); const fs=require('fs');
function boot(){
  const dom=new JSDOM(require('./loadapp.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
  const {window}=dom,d=window.document;
  window.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
  window.Image=class{constructor(){this.w=10;this.h=10;setTimeout(()=>this.onload&&this.onload(),0);}};
  window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
  window.scrollTo=()=>{};window.alert=()=>{};window.jspdf=require('jspdf');
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
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
(async()=>{
  // Defensive pass interference on 3rd & 12 → nullify, spot ball, automatic 1st
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=30;G.down=3;G.distance=12;");
    window.openPass();
    ev(`G.pend.sub='incomp';G.pend.passer=${R('home',0)};
        G.pend.addPen=true;G.pend.penName='Pass Interference (Def)';G.pend.penYds=15;G.pend.penTeam='away';G.pend.penAuto=true;`);
    window.confirmPass();
    chk('DPI: automatic 1st down', ev('G.down')===1, 'down='+ev('G.down'));
    chk('DPI: ball advanced 15 to the 45', ev('G.ballOn')===45, 'ball='+ev('G.ballOn'));
    chk('DPI: passer charged NO attempt (play wiped)', (ev(`(G.stats.home[${R('home',0)}.name]||{}).pa`)||0)===0, 'pa='+ev(`(G.stats.home[${R('home',0)}.name]||{}).pa`));
  }
  // Dead-ball foul (penNullify=false): play STANDS and penalty marked off after
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=20;G.down=1;G.distance=10;");
    const nm=ev(`${R('home',1)}.name`);
    window.openRun();
    ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=32;
        G.pend.addPen=true;G.pend.penNullify=false;G.pend.penName='Unsportsmanlike Conduct';G.pend.penYds=15;G.pend.penTeam='home';G.pend.penAuto=false;`);
    window.confirmRun();
    chk('dead-ball: rushing yards DO count', ev(`(G.stats.home['${nm}']||{}).ryd`)===12, 'ryd='+ev(`(G.stats.home['${nm}']||{}).ryd`));
    chk('dead-ball: first down earned, then walked back', ev('G.down')===1, 'down='+ev('G.down'));
  }
  // Report still generates after all this
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=40;G.down=1;G.distance=10;");
    window.openRun(); ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=55;`); window.confirmRun();
    let ok=false,err='';
    try{ const b=await window.generatePDF({returnBlob:true}); ok=!!b; }catch(e){ err=e.message; }
    chk('PDF report still generates', ok, err);
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'PENALTY EDGE CASES PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
