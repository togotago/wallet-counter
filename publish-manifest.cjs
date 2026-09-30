// Generate the manifest after the release has been committed to GitHub.
const fs=require('node:fs'),crypto=require('node:crypto');
const [version,ref]=process.argv.slice(2);
if(!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version||'') || !/^[a-f0-9]{40}$/.test(ref||''))throw Error('Usage: node publish-manifest.cjs VERSION COMMIT_SHA');
const path=`releases/WalletCounter-${version}.js`,code=fs.readFileSync(__dirname+'/'+path,'utf8');
const notes='Local spending counter, free SEK exchange-rate estimates, manual update checks and program rollback.';
fs.writeFileSync(__dirname+'/manifest.json',JSON.stringify({schema:1,launcher:1,version,ref,path,sha256:crypto.createHash('sha256').update(code).digest('hex'),notes},null,2)+'\n');
