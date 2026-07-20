// Regression test for the 1000-row cap: Supabase truncates any single response
// at 1000 rows regardless of `limit`, which silently hid every school after
// "Wi" (Wiscasset, Wisdom, Woodland, Yarmouth, York) from every autocomplete.
const {JSDOM}=require('jsdom');
let fails=0; const chk=(n,c,x='')=>{if(!c)fails++;console.log((c?'PASS':'FAIL'),n,x?('| '+x):'');};

// 1038 fake team rows, mirroring production: the interesting names sort last.
const TAIL=['Wiscasset','Wisdom','Woodland','Yarmouth','York','ZZ Test North','ZZ Test South'];
const ALL=[];
for(let i=0;i<1031;i++) ALL.push({id:'id'+i, school_name:'Aaa School '+String(i).padStart(4,'0')});
TAIL.forEach((n,i)=>ALL.push({id:'tail'+i, school_name:n}));
ALL.sort((a,b)=>a.school_name.localeCompare(b.school_name));

function boot(cap){
  const reqs=[];
  const stub=(url)=>{
    const u=String(url); reqs.push(u);
    let data=[];
    if(/teams\?select=id,school_name/.test(u)){
      const lim=+((u.match(/limit=(\d+)/)||[])[1]||1000);
      const off=+((u.match(/offset=(\d+)/)||[])[1]||0);
      // the server NEVER returns more than `cap` rows, whatever limit says
      data=ALL.slice(off, off+Math.min(lim,cap));
    }
    return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(data),text:()=>Promise.resolve('[]')});
  };
  const dom=new JSDOM(require('./loadapp.js')(),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/',
    beforeParse(w){ w.fetch=stub; w.scrollTo=()=>{}; w.alert=()=>{};
      w.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}}; }});
  const {window}=dom;
  try{ window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({addColorStop(){}})}); }catch(e){}
  return {window,d:window.document,reqs};
}

(async()=>{
  const {window,d,reqs}=boot(1000);
  await new Promise(r=>setTimeout(r,150));
  const schools=await window.MBR.loadSchools();
  chk('paginated past the 1000-row cap', reqs.filter(u=>/offset=/.test(u)).length>=2,
      reqs.filter(u=>/teams\?select=id/.test(u)).length+' requests');
  chk('found all 1038 schools', schools.length===1038, String(schools.length));
  for(const n of ['Yarmouth','York','Wiscasset','ZZ Test North','ZZ Test South']){
    chk(`"${n}" is present`, schools.includes(n));
  }
  // and the autocomplete actually surfaces them
  const inp=d.getElementById('awayNameInp');
  inp.value='ZZ'; window.schoolAC(inp,'away');
  await new Promise(r=>setTimeout(r,80));
  const box=d.getElementById('awayAC');
  chk('autocomplete shows ZZ Test', /ZZ Test North/.test(box.innerHTML), box.innerHTML.slice(0,80));
  inp.value='York'; window.schoolAC(inp,'away');
  await new Promise(r=>setTimeout(r,80));
  chk('autocomplete shows York', /York/.test(d.getElementById('awayAC').innerHTML));
  console.log('\n'+(fails?fails+' FAIL(s)':'SCHOOL LIST PAGINATION PASS'));
  process.exit(fails?1:0);
})().catch(e=>{console.error('ERR',e&&e.stack||e);process.exit(2);});
