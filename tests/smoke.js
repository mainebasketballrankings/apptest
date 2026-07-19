const {JSDOM}=require('jsdom'); const fs=require('fs');
const html=require('./loadapp.js')();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom, d=window.document;
window.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve([]),text:()=>Promise.resolve('')});
window.Image=class{constructor(){setTimeout(()=>this.onload&&this.onload(),0);}};
window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){},getImageData:()=>({data:[]}),fillText(){},measureText:()=>({width:10}),save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},closePath(){},setTransform(){},translate(){},scale(){},rotate(){},clearRect(){},rect(){},clip(){},createLinearGradient:()=>({addColorStop(){}}),fillStyle:'',strokeStyle:'',lineWidth:1,font:'',textAlign:'',textBaseline:''});
window.scrollTo=()=>{}; window.alert=()=>{};
const ev=c=>window.eval(c);
(async()=>{
  await new Promise(r=>setTimeout(r,60));
  console.log('build=',ev("typeof MBR_BUILD!=='undefined'?MBR_BUILD:'?'"));
  console.log('G reachable=', ev("typeof G")==='object');
  window.toggleTestMode();
  d.getElementById('awayNameInp').value='Shrine East'; d.getElementById('homeNameInp').value='Shrine West';
  d.getElementById('awayAbbrInp').value='EAST'; d.getElementById('homeAbbrInp').value='WEST';
  d.getElementById('fieldDirSel').value='away'; d.getElementById('openKickSel').value='home'; d.getElementById('qlenSel').value='12';
  try{ ev('G_test_mode=true'); }catch(e){}
  await window.startGame();
  await new Promise(r=>setTimeout(r,20));
  console.log('after start: poss=',ev('G.poss'),'ballOn=',ev('G.ballOn'),'quarter=',ev('G.quarter'),'kickoffPending=',ev('G.kickoffPending'));
  console.log('rosters away/home=',ev('G.teams.away.roster.length'),'/',ev('G.teams.home.roster.length'));
  console.log('tstat keys=',ev('Object.keys(G.tstat.away).join(",")'));
  console.log('SMOKE OK');
})().catch(e=>console.error('ERR',e));
