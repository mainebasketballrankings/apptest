const fs=require('fs'), path=require('path');
module.exports=function(){ return fs.readFileSync(path.join(__dirname,'..','field_scorer.html'),'utf8'); };
