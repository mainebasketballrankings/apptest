// Loads football_scorer.html with mbr-core.js inlined, so the test runner
// executes exactly the code the browser does without needing a web server.
// NOTE: the replacement must be a FUNCTION — a plain string would let the core's
// `${...}` template literals be treated as $-substitution patterns.
const fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..');
module.exports=function(){
  const html=fs.readFileSync(path.join(APP,'football_scorer.html'),'utf8');
  const core=fs.readFileSync(path.join(APP,'mbr-core.js'),'utf8');
  const tag='<script src="mbr-core.js?v=5"></script>';
  if(!html.includes(tag)) throw new Error('core script tag not found in football_scorer.html');
  return html.replace(tag, ()=> '<script>\n'+core+'\n</script>');
};
