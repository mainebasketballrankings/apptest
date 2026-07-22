// live.html football: lost fumbles must count as turnovers (the Lobster Bowl
// finished 0-0 on turnovers with a fumble in the log), and the two team panels
// must not share a grid cell on mobile.
const {JSDOM}=require('jsdom'); const fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
const HOME='H', AWAY='A', GID='22222222-3333-4444-5555-666666666666';
const S=o=>JSON.stringify(o);
let t=0;
function ev(type, side, name, num, notes){
  t+=1000;
  return {id:'e'+t, game_id:GID, event_type:type, team_id: side==='home'?HOME:AWAY,
    player_name:name||null, player_num:num||null, period:1, clock_seconds:600, runs:0,
    notes:S(Object.assign({down:1,distance:10,ballOn:40,poss:side,score:{home:0,away:0}},notes||{})),
    created_at:new Date(Date.now()+t).toISOString()};
}
function boot(rows){
  const GAME={id:GID, sport_id:'fa905ca5-f416-409b-81ac-777179ee5576', game_date:'2026-07-18',
    status:'active', home_team_id:HOME, away_team_id:AWAY, home_score:0, away_score:0, season_year:2026,
    home_team:{id:HOME,school_name:'Shrine West'}, away_team:{id:AWAY,school_name:'Shrine East'}};
  const stub=(url)=>{const u=String(url);let data=[];
    if(/\/games\?/.test(u)) data=[GAME]; else if(/game_events/.test(u)) data=rows;
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(data),text:()=>Promise.resolve('[]')});};
  const dom=new JSDOM(fs.readFileSync(path.join(APP,'live.html'),'utf8'),
    {runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/?game_id='+GID+'&sport=football',
     beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{}; w.WebSocket=function(){this.close=()=>{};};
       w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d:window.document,evl:c=>window.eval(c)};
}
(async()=>{
  // EAST loses a fumble; WEST recovers. EAST also recovers one of its own.
  const rows=[
    ev('run','away','Doucette',7,{gain:0}),
    ev('fumble','away','Doucette',7,{lost:true, recoveredBy:'Porter', recoveredByNum:2}),
    ev('run','away','Morin',2,{gain:0}),
    ev('fumble','away','Morin',2,{lost:false, recoveredBy:'Morin', recoveredByNum:2}),
    ev('interception','home','Hersey',10,{}),
  ];
  const {window,d,evl}=boot(rows);
  await new Promise(r=>setTimeout(r,900));

  chk('lost fumble counts as a turnover for the fumbling side', evl('FB.tstat.away.to')>=1, 'away.to='+evl('FB.tstat.away.to'));
  chk('recovering your OWN fumble is not a turnover', evl('FB.tstat.away.to')===1, 'away.to='+evl('FB.tstat.away.to'));
  chk('interception still counts against the offense', evl('FB.tstat.home.to')===1, 'home.to='+evl('FB.tstat.home.to'));
  chk('turnovers are no longer 0-0', (evl('FB.tstat.away.to')+evl('FB.tstat.home.to'))>0);

  // the mobile layout must not stack the two panels
  const css=fs.readFileSync(path.join(APP,'live.html'),'utf8');
  const mob=css.slice(css.indexOf('@media(max-width:500px)'), css.indexOf('@media(max-width:500px)')+2200);
  chk('mobile: panels are NOT both in the same grid cell',
      !/#home-panel,\s*#away-panel\{grid-area:home;\}/.test(mob), 'both assigned to "home"');
  chk('mobile: home panel has its own row', /#home-panel\{grid-area:home;\}/.test(mob));
  chk('mobile: away panel has its own row', /#away-panel\{grid-area:away;\}/.test(mob));
  chk('mobile grid still declares both areas', /grid-template-areas:"centre" "home" "away"/.test(mob));

  // ── fumbles must READ properly in the play-by-play, not just count ──
  {
    const rows2=[
      ev('fumble','away','Doucette',7,{lost:true, recoveredBy:'Porter', recoveredByNum:2, recoverTeam:'WEST'}),
      ev('fumble','away','Morin',2,{lost:false, recoveredBy:'Morin'}),
      ev('fumble','home','Ayoob',33,{lost:true, recoveredBy:'Cota', recoveredByNum:40, retYds:35, td:true}),
      ev('fumble','away','Bowden',1,{lost:true, touchback:true}),
    ];
    const c=boot(rows2);
    await new Promise(r=>setTimeout(r,900));
    const feed=c.d.getElementById('fb-feed-list');
    const txt=feed?feed.textContent:'';
    chk('fumble no longer renders as a bare word', !/—\s*fumble\s*$/m.test(txt) && /FUMBLE/.test(txt), txt.slice(0,90));
    chk('lost fumble names the recovering team', /WEST ball/.test(txt), txt.slice(0,140));
    chk('own recovery is marked as such', /own ball/.test(txt));
    chk('scoop-and-score shows the return TD', /35 yd return/.test(txt) && /TD/.test(txt));
    chk('end-zone recovery reads as a touchback', /touchback/i.test(txt));
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'LIVE FOOTBALL FIXES PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
