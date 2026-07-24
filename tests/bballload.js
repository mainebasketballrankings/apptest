// Loads scorer.html (basketball). Once it moves onto the shared core this will
// inline mbr-core.js the way loadapp.js/fieldload.js do; until then it is a
// straight read, so the harness works before AND after the port.
const fs=require('fs'), path=require('path');
const APP=path.join(__dirname,'..');
module.exports=function(){
  const html=fs.readFileSync(path.join(APP,'scorer.html'),'utf8');
  const tag='<script src="mbr-core.js?v=5"></script>';
  if(!html.includes(tag)) return html;                    // pre-port
  const core=fs.readFileSync(path.join(APP,'mbr-core.js'),'utf8');
  return html.replace(tag, ()=> '<script>\n'+core+'\n</script>');
};
