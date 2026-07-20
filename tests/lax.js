// Lacrosse overtime: boys 4-minute sudden victory until resolved; girls (USA
// Lacrosse) 3-minute halves until resolved; sub-varsity plays ONE period and
// may therefore end level, unlike varsity lacrosse which has no ties.
const {JSDOM}=require('jsdom');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};
function boot(){
  const stub=(url,opt)=>{const m=(opt&&opt.method)||'GET';
    if(m!=='GET') return Promise.resolve({ok:true,status:201,json:()=>Promise.resolve([{id:'G1'}]),text:()=>Promise.resolve('')});
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('[]')});};
  const dom=new JSDOM(require('./fieldload.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{};
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d:window.document,ev:c=>window.eval(c)};
}
async function lax(ctx,{gender='boys', sub=false}={}){
  const {window,d,ev}=ctx;
  window.setSport('lacrosse'); window.suSetMode('new');
  d.getElementById('su-test').checked=true;
  if(sub) d.getElementById('su-sub').checked=true;
  d.getElementById('su-home-gender').value=gender;
  d.getElementById('su-away-gender') && (d.getElementById('su-away-gender').value=gender);
  d.getElementById('su-home-name').value='ZZ Test North';
  d.getElementById('su-away-name').value='ZZ Test South';
  const mk=(n,f,l,gk)=>({num:String(n),first:f,last:l,fi:f[0],starter:true,gk:!!gk});
  ev(`SU.home.players=${JSON.stringify([mk(1,'Ann','K',true),mk(2,'Bea','B'),mk(3,'Cia','C')])};`);
  ev(`SU.away.players=${JSON.stringify([mk(1,'Cy','N',true),mk(2,'Dee','W'),mk(3,'Eli','E')])};`);
  await window.suKickOff(); await new Promise(r=>setTimeout(r,40));
}
(async()=>{
  // ── boys varsity: 4-minute periods, repeat until resolved, no ties ──
  {
    const ctx=boot(); const {ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await lax(ctx,{gender:'boys'});
    chk('boys OT is 4:00', ev('otRules().secs')===240, String(ev('otRules().secs')));
    chk('boys OT repeats until resolved', ev('otRules().max')===99, String(ev('otRules().max')));
    chk('varsity lacrosse has no ties', ev('tiesAllowed()')===false);
    ev("GAME.period=5"); chk('OT clock seeds to 4:00', ev('periodSecs(5)')===240, String(ev('periodSecs(5)')));
  }
  // ── girls varsity: 3-minute halves, repeat until resolved ──
  {
    const ctx=boot(); const {ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await lax(ctx,{gender:'girls'});
    chk('girls OT is 3:00 halves', ev('otRules().secs')===180, String(ev('otRules().secs')));
    chk('girls OT repeats until resolved', ev('otRules().max')===99);
    chk('girls varsity still has no ties', ev('tiesAllowed()')===false);
    ev("GAME.period=5"); chk('girls OT clock seeds to 3:00', ev('periodSecs(5)')===180, String(ev('periodSecs(5)')));
  }
  // ── boys sub-varsity: ONE 4-minute period, may end level ──
  {
    const ctx=boot(); const {window,ev,d}=ctx;
    await new Promise(r=>setTimeout(r,150)); await lax(ctx,{gender:'boys', sub:true});
    chk('sub-varsity flag read from setup', ev('GAME.subVarsity')===true);
    chk('JV boys OT is 4:00', ev('otRules().secs')===240, String(ev('otRules().secs')));
    chk('JV plays ONE overtime only', ev('otRules().max')===1, String(ev('otRules().max')));
    chk('JV CAN end level', ev('tiesAllowed()')===true, 'ties='+ev('tiesAllowed()'));
    chk('JV chip visible while scoring', d.getElementById('sub-chip').style.display!=='none');
  }
  // ── girls sub-varsity: ONE 3-minute stop-time period ──
  {
    const ctx=boot(); const {ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await lax(ctx,{gender:'girls', sub:true});
    chk('JV girls OT is 3:00', ev('otRules().secs')===180, String(ev('otRules().secs')));
    chk('JV girls plays one period', ev('otRules().max')===1);
    chk('JV girls may end level', ev('tiesAllowed()')===true);
  }
  // ── the period ceiling follows the rules ──
  {
    const ctx=boot(); const {window,ev}=ctx;
    await new Promise(r=>setTimeout(r,150)); await lax(ctx,{gender:'boys', sub:true});
    ev("GAME.period=5");        // the single allowed OT
    window.chgPeriod(1);
    chk('JV cannot advance past its one overtime', ev('GAME.period')===5, 'period='+ev('GAME.period'));
  }
  // ── other sports keep their own ties rule ──
  {
    const ctx=boot(); const {window,d,ev}=ctx;
    await new Promise(r=>setTimeout(r,150));
    window.setSport('soccer'); window.suSetMode('new');
    d.getElementById('su-test').checked=true;
    d.getElementById('su-home-name').value='ZZ Test North'; d.getElementById('su-away-name').value='ZZ Test South';
    const mk=(n,f,l,gk)=>({num:String(n),first:f,last:l,fi:f[0],starter:true,gk:!!gk});
    ev(`SU.home.players=${JSON.stringify([mk(1,'A','K',true),mk(2,'B','B')])};`);
    ev(`SU.away.players=${JSON.stringify([mk(1,'C','N',true),mk(2,'D','W')])};`);
    await window.suKickOff(); await new Promise(r=>setTimeout(r,40));
    chk('soccer still allows regular-season ties', ev('tiesAllowed()')===true);
    chk('soccer OT unchanged at 5:00', ev('otRules().secs')===300, String(ev('otRules().secs')));
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'LACROSSE OT PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
