// Google sign-in lives in the shared core. The critical property is that being
// SIGNED OUT changes nothing — MBR scoring is deliberately login-free — while
// being signed in makes requests carry the user's token so auth.uid() resolves.
const {JSDOM}=require('jsdom'); const fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};

function boot(hash){
  const seen=[];
  const core=fs.readFileSync(path.join(APP,'mbr-core.js'),'utf8');
  const dom=new JSDOM('<html><body></body></html>',{runScripts:'dangerously',url:'https://app.mainebasketballrankings.com/scorer.html'+(hash||'')});
  const {window}=dom;
  window.fetch=(u,o)=>{ seen.push({u:String(u), auth:(o&&o.headers&&o.headers.Authorization)||null});
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({id:'U1',email:'coach@example.com',user_metadata:{full_name:'A Coach'}}),text:()=>Promise.resolve('')}); };
  window.eval(core);
  return {window, MBR:window.MBR, seen};
}
const ANON_PREFIX='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

(async()=>{
  // ── signed out: nothing changes ──
  {
    const {MBR,seen}=boot();
    chk('core still loads', typeof MBR==='object');
    chk('starts signed out', MBR.isSignedIn()===false);
    await MBR.sbFetch('teams?select=id&limit=1');
    chk('signed out -> requests use the anon key', (seen[0].auth||'').includes(ANON_PREFIX),
        (seen[0].auth||'').slice(0,28));
  }
  // ── returning from Google: the token is captured and scrubbed ──
  {
    const exp=Math.floor(Date.now()/1000)+3600;
    const {window,MBR,seen}=boot('#access_token=USERTOKEN123&refresh_token=REF456&expires_at='+exp+'&token_type=bearer');
    chk('token captured from the redirect', MBR.isSignedIn()===true);
    chk('token scrubbed from the address bar', window.location.hash==='' || !/access_token/.test(window.location.hash),
        window.location.hash);
    await MBR.sbFetch('games?select=id&limit=1');
    chk('signed in -> requests carry the USER token', (seen[0].auth||'')==='Bearer USERTOKEN123', seen[0].auth);
    const me=await MBR.currentUser();
    chk('the signed-in user is identified', me && me.email==='coach@example.com', JSON.stringify(me));
    chk('display name preferred over email', me && me.name==='A Coach', me&&me.name);
    MBR.signOut();
    chk('sign out clears the session', MBR.isSignedIn()===false);
  }
  // ── an expired token must NOT be used as-is ──
  {
    const stale=Math.floor(Date.now()/1000)-10;
    const {MBR,seen}=boot('#access_token=STALE&refresh_token=R&expires_at='+stale);
    await MBR.sbFetch('teams?select=id&limit=1');
    chk('expired token falls back rather than sending a dead one',
        !(seen[0].auth||'').includes('STALE'), seen[0].auth);
  }
  // ── the sign-in redirect is well formed ──
  {
    const {MBR}=boot();
    const u=MBR.authUrl('https://app.mainebasketballrankings.com/scorer.html');
    chk('points at Supabase, provider=google', /supabase\.co\/auth\/v1\/authorize\?provider=google/.test(u), u);
    chk('sends the user back where they started', /redirect_to=.*scorer\.html/.test(decodeURIComponent(u)), u);
    chk('return URL is encoded', /redirect_to=https%3A/.test(u), u);
    const bare=MBR.authUrl();
    chk('defaults to the current page', /scorer\.html/.test(decodeURIComponent(bare)), bare);
  }
  console.log('\n'+(fails?fails+' FAIL(s)':'GOOGLE SIGN-IN PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
