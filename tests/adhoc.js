const {JSDOM}=require('jsdom');
let posted=[];   // capture what would be written to Supabase
function boot(){
  const stub=(url,opt)=>{
    const u=String(url), m=(opt&&opt.method)||'GET';
    if(m==='POST' && /\/rest\/v1\/games/.test(u)){
      posted.push(JSON.parse(opt.body));
      return Promise.resolve({ok:true,status:201,json:()=>Promise.resolve([{id:'NEWGAME-123'}]),text:()=>Promise.resolve('')});
    }
    let data=[];
    // resolveTeamId now filters server-side: teams?school_name=eq.X&sport_id=eq.Y&select=id&limit=1
    if(/teams\?school_name=eq\./.test(u)){
      const nm=decodeURIComponent((u.match(/school_name=eq\.([^&]+)/)||[])[1]||'');
      data = nm==='Nowhere High' ? [] : [{id:'TEAM-'+nm.replace(/\W/g,'')}];
    } else if(/teams\?select=/.test(u)) data=[{id:'T1',school_name:'Bangor'}];
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(data),text:()=>Promise.resolve('[]')});
  };
  const dom=new JSDOM(require('./loadapp.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{};
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}};
    }});
  const {window}=dom,d=window.document;
  window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})});
  return {window,d,ev:c=>window.eval(c)};
}
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
(async()=>{
  const {window,d,ev}=boot();
  await new Promise(r=>setTimeout(r,120));
  chk('core loaded (badge reports it)', /core ok/.test(d.getElementById('buildBadge').textContent), d.getElementById('buildBadge').textContent);
  chk('unscheduled button present', !!d.getElementById('adhocBtn'));

  // no names entered -> refuses
  await window.createUnscheduledGame();
  chk('refuses with no school names', /Enter both school names/.test(d.getElementById('adhocStatus').textContent));

  // unmatchable school -> clear error, no row written
  d.getElementById('awayNameInp').value='Nowhere High';
  d.getElementById('homeNameInp').value='Bangor';
  await window.createUnscheduledGame(); await new Promise(r=>setTimeout(r,50));
  chk('unmatched school -> named error', /Couldn't match Nowhere High/.test(d.getElementById('adhocStatus').textContent), d.getElementById('adhocStatus').textContent);
  chk('no game row written on failure', posted.length===0, JSON.stringify(posted));

  // happy path
  d.getElementById('awayNameInp').value='Lawrence';
  d.getElementById('homeNameInp').value='Skowhegan';
  d.getElementById('gameDateInp').value='2026-09-11';
  d.getElementById('gameLocInp').value='Clark Field';
  await window.createUnscheduledGame(); await new Promise(r=>setTimeout(r,60));
  chk('game row written', posted.length===1, JSON.stringify(posted));
  const row=posted[0]||{};
  chk('correct sport_id', row.sport_id==='fa905ca5-f416-409b-81ac-777179ee5576', row.sport_id);
  chk('season_year 2026 for a Sept 2026 game (no year roll)', row.season_year===2026, String(row.season_year));
  chk('tracking_level is full_stats (not "full")', row.tracking_level==='full_stats', row.tracking_level);
  chk('home/away not swapped', row.home_team_id==='TEAM-Skowhegan' && row.away_team_id==='TEAM-Lawrence', `${row.away_team_id} at ${row.home_team_id}`);
  chk('date + venue carried', row.game_date==='2026-09-11' && row.location==='Clark Field', `${row.game_date} ${row.location}`);
  chk('status scheduled', row.status==='scheduled', row.status);
  chk('G_game_id adopted', ev('G_game_id')==='NEWGAME-123', ev('G_game_id'));
  chk('button disabled after success', d.getElementById('adhocBtn').disabled===true);

  // now startGame should no longer refuse
  d.getElementById('awayAbbrInp').value='LAW'; d.getElementById('homeAbbrInp').value='SKO';
  await window.startGame(); await new Promise(r=>setTimeout(r,40));
  chk('startGame proceeds (no "No game selected")', ev('typeof G')==='object' && ev('G.quarter')===1, 'q='+ev('G.quarter'));
  console.log('\n'+(fails?fails+' FAIL(s)':'AD-HOC GAME CREATION PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
