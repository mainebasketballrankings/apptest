// The shootout only works end-to-end if the metadata actually reaches the
// database. sbPushEvent used to drop `meta` on the floor, so live.html could
// never tell a tiebreaker kick from an in-game penalty kick.
const {JSDOM}=require('jsdom');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
(async()=>{
  const posted=[];
  const stub=(url,opt)=>{
    const u=String(url), m=(opt&&opt.method)||'GET';
    if(m==='POST' && /game_events/.test(u)){ try{posted.push(JSON.parse(opt.body));}catch(e){} 
      return Promise.resolve({ok:true,status:201,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')}); }
    if(m!=='GET') return Promise.resolve({ok:true,status:204,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('[]')});
  };
  const dom=new JSDOM(require('./fieldload.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{};
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom, d=window.document, ev=c=>window.eval(c);
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  await new Promise(r=>setTimeout(r,150));

  window.setSport('soccer'); window.suSetMode('new');
  d.getElementById('su-playoff').checked=true;
  d.getElementById('su-home-name').value='ZZ Test North';
  d.getElementById('su-away-name').value='ZZ Test South';
  const mk=(n,f,l,gk)=>({num:String(n),first:f,last:l,fi:f[0],starter:true,gk:!!gk});
  ev(`SU.home.players=${JSON.stringify([mk(1,'Ann','Keeper',true),mk(2,'Bea','Bee'),mk(3,'Cia','See'),mk(4,'Dot','Dee'),mk(5,'Eve','Ee'),mk(6,'Fay','Ef')])};`);
  ev(`SU.away.players=${JSON.stringify([mk(1,'Cy','Net',true),mk(2,'Dee','Wing'),mk(3,'Eli','Ess'),mk(4,'Flo','Eff'),mk(5,'Gus','Jee'),mk(6,'Hui','Aych')])};`);
  await window.suKickOff(); await new Promise(r=>setTimeout(r,40));
  // real game (not test mode) so events actually push
  ev("G_test_mode=false; G_game_id='GID-1'; G_home_team_id='H'; G_away_team_id='A';");
  ev("GAME.home.score=1; GAME.away.score=1; GAME.period=4; GAME.clockSec=0;");

  window.soStart(); window.soSetFirst('away');
  const side=ev('soTurn()'); const pid=ev(`PL['${side}'][1].id`);
  window.soKick(pid,true);
  await new Promise(r=>setTimeout(r,60));

  const kick=posted.find(r=>r.event_type==='penalty_kick_made');
  chk('a penalty_kick_made row was pushed', !!kick, 'rows='+posted.length);
  let n={}; try{ n=JSON.parse(kick.notes); }catch(e){}
  chk('notes carry shootout:true', n.shootout===true, JSON.stringify(n).slice(0,120));
  chk('notes carry the round', n.round===1, 'round='+n.round);
  chk('notes carry the kick order', n.order===1, 'order='+n.order);
  chk('score snapshot still present and unchanged by the kick',
      n.score && n.score.home===1 && n.score.away===1, JSON.stringify(n.score));
  chk('runs=0 so the tiebreaker kick is not counted as a goal', kick.runs===0, 'runs='+kick.runs);

  // card metadata should also survive now
  posted.length=0;
  ev("selP=PL.home[1]; selSide='home';");
  const yi=ev("SP.btns.findIndex(b=>b.card==='yellow')");
  if(yi>=0){ window.doStat(yi); await new Promise(r=>setTimeout(r,60));
    const c=posted.find(r=>/card/.test(r.event_type));
    let cn={}; try{ cn=JSON.parse(c.notes); }catch(e){}
    chk('card metadata also reaches the database', cn.card==='yellow', JSON.stringify(cn).slice(0,90));
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'SHOOTOUT PUSH PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
