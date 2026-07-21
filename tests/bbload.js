// Loads baseball_scorer.html, inlining mbr-core.js once the port lands so the
// harness works before AND after.
const fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..');
module.exports=function(){
  const html=fs.readFileSync(path.join(APP,'baseball_scorer.html'),'utf8');
  const tag='<script src="mbr-core.js?v=4"></script>';
  if(!html.includes(tag)) return html;
  const core=fs.readFileSync(path.join(APP,'mbr-core.js'),'utf8');
  return html.replace(tag, ()=> '<script>\n'+core+'\n</script>');
};
