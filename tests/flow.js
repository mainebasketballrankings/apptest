const {JSDOM}=require('jsdom'); const fs=require('fs');
const html=require('./loadapp.js')();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
window.scrollTo=()=>{}; window.alert=()=>{};
const ev=c=>window.eval(c);
const pbpText=()=>ev("JSON.stringify(G.pbp.map(x=>x.text.replace(/<[^>]+>/g,'')))");
const R=(s)=>ev(`G.teams.${s}.roster.find(p=>p.name).name`);
let fails=0; const chk=(n,c,x='')=>{ if(!c)fails++; console.log((c?'PASS':'FAIL'),n,x?('| '+x):''); };

(async()=>{
  await new Promise(r=>setTimeout(r,60));
  window.toggleTestMode();
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  ev('G_test_mode=true');
  await window.startGame();
  await new Promise(r=>setTimeout(r,20));

  // ---------- #3: drive-summary ordering on a rushing TD + PAT ----------
  ev("G.kickoffPending=false; G.poss='home'; G.ballOn=45; G.down=1; G.distance=10;");
  // first-down run 45->62
  window.openRun(); ev("G.pend.rusher=G.teams.home.roster.find(p=>p.name); G.pend.toSpot=62;"); window.confirmRun();
  chk('run gained first down (down reset to 1)', ev('G.down')===1, 'down='+ev('G.down'));
  // set up goal-to-go and score rushing TD
  ev("G.ballOn=95; G.down=1; G.distance=5;");
  window.openRun(); ev("G.pend.rusher=G.teams.home.roster.find(p=>p.name); G.pend.toSpot=100;"); window.confirmRun();
  chk('home score +6 after rush TD', ev('G.score.home')>=6, 'home='+ev('G.score.home'));
  chk('pendingPAT true after TD', ev('G.pendingPAT')===true);
  // kick the PAT
  window.openKick(); ev("G.pend.sub='pat'; G.pend.patMode='kick'; G.pend.patKicker=G.teams.home.roster.find(p=>p.name); G.pend.patGood=true;"); window.confirmKick();
  chk('home score 7 after PAT', ev('G.score.home')===7, 'home='+ev('G.score.home'));
  const pbp=JSON.parse(pbpText());
  const idxTD=pbp.findIndex(t=>/TOUCHDOWN WEST/i.test(t));
  const idxPAT=pbp.findIndex(t=>/Extra point WEST/i.test(t));
  const idxSum=pbp.findIndex(t=>/WEST drive:.*Touchdown/i.test(t));
  console.log('  PBP tail:', JSON.stringify(pbp.slice(Math.max(0,idxTD-1))));
  chk('#3 drive-summary AFTER touchdown', idxSum>idxTD && idxTD>=0, `TD@${idxTD} SUM@${idxSum}`);
  chk('#3 drive-summary AFTER PAT', idxSum>idxPAT && idxPAT>=0, `PAT@${idxPAT} SUM@${idxSum}`);
  chk('#3 only ONE drive-summary for that drive', pbp.filter(t=>/WEST drive:.*Touchdown/i.test(t)).length===1);

  // ---------- #2: kickoff fumble, kicking team returns for TD ----------
  // After the PAT, HOME(West) kicked off -> EAST receives, kickoffPending true, poss=away
  chk('post-PAT kickoffPending & EAST receiving', ev('G.kickoffPending')===true && ev('G.poss')==='away', 'poss='+ev('G.poss'));
  const westBefore=ev('G.score.home');
  window.openKick();
  ev(`G.pend.sub='kickoff'; G.pend.koKicker=G.teams.home.roster.find(p=>p.name);
      G.pend.koReturner=G.teams.away.roster.find(p=>p.name); G.pend.koRecAt=5; G.pend.koAdvTo=22;
      G.pend.koFumble=true; G.pend.koFumLost=true; G.pend.koFumRecoverer=G.teams.home.roster.find(p=>p.name);
      G.pend.koFumAdvTo=100;`);  // West recovers and returns to end zone
  window.confirmKick();
  const pbp2=JSON.parse(pbpText());
  chk('#2 kicking team (West) scored TD off kickoff fumble', ev('G.score.home')>=westBefore+6, `home ${westBefore}->${ev('G.score.home')}`);
  chk('#2 PBP shows fumble return TD for WEST', pbp2.some(t=>/FUMBLE/i.test(t)&&/TD WEST/i.test(t)), JSON.stringify(pbp2.slice(-4)));

  // plain kicking-team recovery (no TD) -> possession flips to West, no score
  ev("G.pendingPAT=false;"); // clear the PAT from the scoop TD to isolate next test
  // set up a fresh kickoff: EAST receiving again
  ev("G.kickoffPending=true; G.poss='away'; G.ballOn=25; G.down=1; G.distance=10;");
  const homeB=ev('G.score.home');
  window.openKick();
  ev(`G.pend.sub='kickoff'; G.pend.koKicker=G.teams.home.roster.find(p=>p.name);
      G.pend.koReturner=G.teams.away.roster.find(p=>p.name); G.pend.koRecAt=8; G.pend.koAdvTo=20;
      G.pend.koFumble=true; G.pend.koFumLost=true; G.pend.koFumRecoverer=G.teams.home.roster.find(p=>p.name);
      G.pend.koFumAdvTo=45;`);  // West recovers at their own 45, no score
  window.confirmKick();
  chk('#2 plain recovery: possession flips to West (home)', ev('G.poss')==='home', 'poss='+ev('G.poss'));
  chk('#2 plain recovery: no points added', ev('G.score.home')===homeB, `home=${ev('G.score.home')}`);

  console.log('\n'+(fails?fails+' FAIL(s)':'FLOW #2/#3 ALL PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e); process.exit(2);});
