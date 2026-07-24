// Loads field_scorer.html with mbr-core.js inlined (same reason as loadapp.js —
// jsdom can't resolve a relative <script src>, and the replacement must be a
// function so the core's `${...}` aren't treated as $-substitution patterns).
const fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..');
module.exports=function(){
  const html=fs.readFileSync(path.join(APP,'field_scorer.html'),'utf8');
  const core=fs.readFileSync(path.join(APP,'mbr-core.js'),'utf8');
  const tag='<script src="mbr-core.js?v=5"></script>';
  if(!html.includes(tag)) throw new Error('core script tag not found in field_scorer.html');
  return html.replace(tag, ()=> '<script>\n'+core+'\n</script>');
};
