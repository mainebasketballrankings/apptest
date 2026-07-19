const {JSDOM}=require('jsdom'); const fs=require('fs');
function boot(){
  const dom=new JSDOM(require('./loadapp.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
  const {window}=dom, d=window.document;
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
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };
const pbp=ev=>JSON.parse(ev("JSON.stringify(G.pbp.map(x=>x.text.replace(/<[^>]+>/g,'')))"));
(async()=>{
  // ---- kicker / punter memory ----
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=40;G.down=4;G.distance=8;");
    const punter=ev(`${R('home',6)}.name`);
    window.openKick(); ev(`G.pend.sub='punt';G.pend.puntPunter=${R('home',6)};G.pend.puntLand=75;G.pend.puntEnd=75;`); window.confirmKick();
    chk('punter remembered for that side', ev("(G.punter.home||{}).name")===punter, ev("(G.punter.home||{}).name"));
    // next punt for same team prefills
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=30;G.down=4;G.distance=9;");
    window.openKick();
    chk('next punt PREFILLS the punter', ev("(G.pend.puntPunter||{}).name")===punter, ev("(G.pend.puntPunter||{}).name"));
    ev("G.pend=null;");
    // FG kicker memory
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=70;G.down=4;G.distance=3;");
    const k=ev(`${R('home',7)}.name`);
    window.openKick(); ev(`G.pend.sub='fg';G.pend.fgKicker=${R('home',7)};G.pend.fgGood=true;`); window.confirmKick();
    chk('placekicker remembered', ev("(G.kicker.home||{}).name")===k, ev("(G.kicker.home||{}).name"));
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=65;G.down=4;G.distance=2;");
    window.openKick();
    chk('next FG prefills the kicker', ev("(G.pend.fgKicker||{}).name")===k);
    chk('PAT tab also prefills the kicker', ev("(G.pend.patKicker||{}).name")===k);
  }
  // ---- kickoff out of bounds ----
  {
    const {window,ev}=await game();  // WEST kicks to EAST
    ev("G.kickoffPending=true;G.poss='away';G.ballOn=25;G.down=1;G.distance=10;");
    window.openKick(); ev(`G.pend.sub='kickoff';G.pend.koKicker=${R('home',6)};G.pend.koOOB=true;G.pend.koOOBChoice='spot';`); window.confirmKick();
    chk('KO out of bounds (take it): EAST ball at own 35', ev('G.poss')==='away' && ev('G.ballOn')===35 && ev('G.kickoffPending')===false, `poss=${ev('G.poss')} ball=${ev('G.ballOn')} ko=${ev('G.kickoffPending')}`);
    chk('KO OOB charges 5 penalty yds to WEST', ev("teamTotals('home').penalties")==='1-5', ev("teamTotals('home').penalties"));
  }
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=true;G.poss='away';G.ballOn=25;G.down=1;G.distance=10;");
    window.openKick(); ev(`G.pend.sub='kickoff';G.pend.koKicker=${R('home',6)};G.pend.koOOB=true;G.pend.koOOBChoice='rekick';`); window.confirmKick();
    chk('KO out of bounds (re-kick): kickoff stays pending', ev('G.kickoffPending')===true);
    chk('re-kick PBP notes the penalty', pbp(ev).some(t=>/out of bounds.*5 yd penalty.*re-kick/i.test(t)), JSON.stringify(pbp(ev).slice(-1)));
  }
  // ---- fake punt ----
  {
    const {window,ev}=await game();
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=40;G.down=4;G.distance=3;");
    window.openKick(); ev("G.pend.sub='punt';");
    window.fakeKick('run');
    chk('fake opens the RUN overlay', ev("(G.pend||{}).type")==='run', ev("(G.pend||{}).type"));
    chk('down & distance preserved through the fake', ev('G.down')===4 && ev('G.distance')===3, `${ev('G.down')} & ${ev('G.distance')}`);
    ev(`G.pend.rusher=${R('home',1)};G.pend.toSpot=48;`); window.confirmRun();
    chk('fake punt converts to 1st down', ev('G.down')===1, 'down='+ev('G.down'));
    chk('PBP tags it as a fake punt', pbp(ev).some(t=>/Fake punt/i.test(t)), JSON.stringify(pbp(ev).slice(-1)));
  }
  // ---- picker role grouping ----
  {
    const {window,d,ev}=await game();
    // give the roster real positions
    ev(`G.teams.home.roster.forEach((p,i)=>{ p.pos = ['OL','QB','RB','DL','WR','LB','OL','DB','TE','OL','DL'][i%11]; });`);
    ev("G.kickoffPending=false;G.poss='home';G.ballOn=40;G.down=1;G.distance=10;");
    window.openRun();
    window.pickFor('rusher','home','Select Rusher');
    const html=d.getElementById('pickerList').innerHTML;
    chk('picker shows a Likely section', /Likely/.test(html) && /Everyone else/.test(html));
    const likelyChunk = html.split('Everyone else')[0];
    chk('RB/QB appear in Likely', /RB/.test(likelyChunk) && /QB/.test(likelyChunk));
    chk('OL does NOT appear in Likely', !/>OL</.test(likelyChunk), likelyChunk.match(/>[A-Z]{2,3}</g)?.join(',')||'');
    // defensive role
    ev("G.pend=null;"); window.openRun();
    window.pickFor('tackler','away','Tackled by');
    const h2=d.getElementById('pickerList').innerHTML;
    chk('defensive picker renders without error', h2.length>0);
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'NEW FEATURES ALL PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
