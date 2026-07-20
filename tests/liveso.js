// live.html must render the shootout grid AND must not let tiebreaker kicks
// touch the match score — they decide the game but are not goals.
const {JSDOM}=require('jsdom'); const fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
const HOME='H-TEAM', AWAY='A-TEAM', GID='11111111-2222-3333-4444-555555555555';
const S=o=>JSON.stringify(o);
function ev(type, side, name, num, notes, period){
  return {id:Math.random().toString(36).slice(2), game_id:GID, event_type:type,
    team_id: side==='home'?HOME:AWAY, player_name:name||null, player_num:num||null,
    period:period||2, clock_seconds:0, runs:0, notes:S(notes||{}), created_at:new Date(Date.now()+Math.random()).toISOString()};
}
function boot(rows){
  const GAME={id:GID, sport_id:'ff80a695-0e78-4432-98f2-141b2b571e0e', game_date:'2026-10-20',
    status:'active', home_team_id:HOME, away_team_id:AWAY, home_score:1, away_score:1, season_year:2026,
    home_team:{id:HOME,school_name:'ZZ Test North'}, away_team:{id:AWAY,school_name:'ZZ Test South'}};
  const stub=(url)=>{const u=String(url);let data=[];
    if(/\/games\?/.test(u)) data=[GAME];
    else if(/game_events/.test(u)) data=rows;
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(data),text:()=>Promise.resolve('[]')});};
  const html=fs.readFileSync(path.join(APP,'live.html'),'utf8');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
    url:'https://x/?game_id='+GID+'&sport=soccer',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{}; w.WebSocket=function(){this.close=()=>{};};
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d:window.document,evl:c=>window.eval(c)};
}
(async()=>{
  // a 1-1 game decided 4-3 on kicks, away winning
  const kicks=[];
  const seq=[['away',true],['home',true],['away',true],['home',false],
             ['away',false],['home',true],['away',true],['home',true],
             ['away',true],['home',false]];
  seq.forEach(([side,made],i)=>{
    kicks.push(ev(made?'penalty_kick_made':'penalty_kick_miss', side, (side==='home'?'Home':'Away')+' Kicker'+(i+1), String(i+1),
      {shootout:true, round:1, order:i+1, made, score:{home:1,away:1}}, 5));
  });
  kicks.push(ev('goal','away',null,null,{shootout_winner:true, so_home:3, so_away:4, goal:true, score:{home:1,away:2}},5));
  const ctx=boot(kicks);
  await new Promise(r=>setTimeout(r,900));
  const {window,d,evl}=ctx;

  chk('shootout panel is visible', d.getElementById('so-panel').style.display!=='none',
      'display='+d.getElementById('so-panel').style.display);
  const grid=d.getElementById('so-grid').innerHTML;
  chk('grid rendered with both teams', /ZZ|ZTN|ZTS|HOME|AWAY/i.test(grid) && grid.includes('<table'), grid.slice(0,60));
  chk('made kicks marked', (grid.match(/●/g)||[]).length===7, 'made marks='+(grid.match(/●/g)||[]).length);
  chk('missed kicks marked', (grid.match(/✕/g)||[]).length===3, 'miss marks='+(grid.match(/✕/g)||[]).length);
  chk('header names the winner and tally', /wins 4–3/.test(d.getElementById('so-hdr').textContent),
      d.getElementById('so-hdr').textContent);

  // the crucial one: kicks must NOT inflate the match score
  const hs=evl('FD.home.score'), as=evl('FD.away.score');
  chk('shootout kicks did NOT become goals — away 1 + 1 awarded = 2', as===2, 'away='+as);
  chk('home score untouched at 1', hs===1, 'home='+hs);
  chk('shots not inflated by tiebreaker kicks', evl('FD.home.shots')===0 && evl('FD.away.shots')<=1,
      `h=${evl('FD.home.shots')} a=${evl('FD.away.shots')}`);
  chk('tally captured', evl('FD.so.away')===4 && evl('FD.so.home')===3, `${evl('FD.so.away')}-${evl('FD.so.home')}`);
  chk('winner recorded', evl("FD.so.winner")==='away');

  // a normal game shows no panel
  const ctx2=boot([ev('goal','home','Somebody','9',{},1)]);
  await new Promise(r=>setTimeout(r,700));
  chk('no panel when there was no shootout', ctx2.d.getElementById('so-panel').style.display==='none',
      'display='+ctx2.d.getElementById('so-panel').style.display);

  console.log('\n'+(fails?fails+' FAIL(s)':'LIVE SHOOTOUT GRID PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
