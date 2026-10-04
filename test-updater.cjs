const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(__dirname+'/Wallet-Counter-Launcher.js','utf8');
const actualEngine=fs.readFileSync(__dirname+'/WalletCounter.js','utf8');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const fileMap=new Map(),directories=new Set(),requests=[],messages=[],outputs=[];
let seq=0,failWrite=false,partialWrite=false,network=new Map(),selections=[];
const fm={libraryDirectory:()=>'/local',joinPath:(a,b)=>a+'/'+b,createDirectory:p=>directories.add(p),
 fileExists:p=>fileMap.has(p)||directories.has(p),readString:p=>{if(!fileMap.has(p))throw Error('Missing');return fileMap.get(p)},
 writeString:(p,s)=>{if(failWrite && p.endsWith('/active.json')) {if(partialWrite)fileMap.set(p,'{broken');throw Error('Disk full')}fileMap.set(p,s)},move:(a,b)=>{if(fileMap.has(b))throw Error('Destination exists');if(!fileMap.has(a))throw Error('Source missing');fileMap.set(b,fileMap.get(a));fileMap.delete(a)},
 listContents:p=>[...fileMap.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(k=>k.slice(p.length+1))};
class Request{constructor(url){this.url=url}async loadString(){assert.equal(this.timeoutInterval,10);assert.equal(this.onRedirect({url:'https://evil.example'}),null);requests.push(this.url);const v=network.get(this.url.split('?')[0]);if(!v)throw Error('Offline');this.response={statusCode:v.status||200};return v.body}}
const globals={console,FileManager:{local:()=>fm},UUID:{string:()=>String(++seq)},Request,
 Alert:class{addAction(){}addCancelAction(){}async presentAlert(){messages.push(this.message);return 0}async presentSheet(){return selections.length?selections.shift():0}},
 Notification:class{async schedule(){}},config:{runsInApp:true,runsInWidget:false},args:{shortcutParameter:null},
 Script:{name:()=> 'Wallet Counter',complete(){},setShortcutOutput:s=>outputs.push(s)}};
const imported=new Map();
globals.importModule=p=>{if(imported.has(p))return imported.get(p);const c=vm.createContext({...globals,module:{exports:{}}});vm.runInContext(fm.readString(p),c);imported.set(p,c.module.exports);return c.module.exports};
const ctx=vm.createContext(globals);
vm.runInContext(source.replace('await launcherMain();','globalThis.api={sha256,validateManifest,validateDescriptor,compareVersions,readPointer,writePointer,loadRelease,installRelease,checkUpdates,rollbackRelease,launcherMain,codePath};'),ctx);
const api=ctx.api;
const ref='a'.repeat(40),repo='https://raw.githubusercontent.com/togotago/wallet-counter/';
function release(version,code=`module.exports={version:'${version}',run:async()=>{}};`){return{schema:1,launcher:1,version,sha256:digest(code),ref,path:`releases/WalletCounter-${version}.js`,notes:'Test release',code}}
function serve(r){network.set(repo+'main/manifest.json',{body:JSON.stringify(r)});network.set(repo+ref+'/'+r.path,{body:r.code})}
function snap(){return new Map([...fileMap].filter(([p])=>p.startsWith('/local/WalletCounter-v1/')))}
async function main(){
 for(const s of ['', 'abc', 'åäö SEK 🪙', 'x'.repeat(30000),actualEngine])assert.equal(api.sha256(s),digest(s));
 assert.equal(api.compareVersions('0.10.0','0.3.0'),1);
 const r1=release('0.3.0');serve(r1);
 for(const bad of [{...r1,ref:'main'},{...r1,path:'../../secret'},{...r1,sha256:'bad'},{...r1,launcher:2}])assert.throws(()=>api.validateManifest(bad));
 await api.installRelease(api.validateManifest(r1),null);
 assert.equal(api.readPointer().active.version,'0.3.0');
 const originalPointer=fileMap.get('/local/WalletCounter-updater-v1/active.json');
 const r2=release('0.4.0');serve(r2);
 network.set(repo+ref+'/'+r2.path,{body:'truncated code'});
 await assert.rejects(()=>api.installRelease(api.validateManifest(r2),api.readPointer()),/checksum/);
 assert.equal(fileMap.get('/local/WalletCounter-updater-v1/active.json'),originalPointer);
 const syntax=release('0.4.0','const broken = ;');serve(syntax);
 await assert.rejects(()=>api.installRelease(api.validateManifest(syntax),api.readPointer()));
 assert.equal(fileMap.get('/local/WalletCounter-updater-v1/active.json'),originalPointer);
 const contract=release('0.4.0',"module.exports={version:'0.4.0'};");serve(contract);
 await assert.rejects(()=>api.installRelease(api.validateManifest(contract),api.readPointer()),/module/);
 assert.equal(fileMap.get('/local/WalletCounter-updater-v1/active.json'),originalPointer);
 serve(r2);failWrite=true;
 await assert.rejects(()=>api.installRelease(api.validateManifest(r2),api.readPointer()),/Disk full/);
 failWrite=false;assert.equal(fileMap.get('/local/WalletCounter-updater-v1/active.json'),originalPointer);
 // Reproduce a partial pointer write and a failed restoration. Backup must still load.
 failWrite=true;partialWrite=true;
 await assert.rejects(()=>api.installRelease(api.validateManifest(r2),api.readPointer()),/Disk full/);
 assert.equal(api.readPointer().active.version,'0.3.0');
 failWrite=false;partialWrite=false;
 fileMap.delete('/local/WalletCounter-updater-v1/active.json');
 assert.equal(api.readPointer().active.version,'0.3.0','missing pointer recovers backup');
 api.writePointer(api.readPointer());
 assert.equal(fileMap.get('/local/WalletCounter-updater-v1/active.json'),originalPointer);

 selections=[-1];assert.equal(await api.checkUpdates(),false);assert.equal(api.readPointer().active.version,'0.3.0');
 selections=[0];assert.equal(await api.checkUpdates(),true);
 assert.equal(api.readPointer().active.version,'0.4.0');assert.equal(api.readPointer().previous.version,'0.3.0');
 assert.equal(await api.rollbackRelease(),true);assert.equal(api.readPointer().active.version,'0.3.0');
 const lower=release('0.2.0');serve(lower);const n=requests.length;assert.equal(await api.checkUpdates(),false);assert.equal(requests.length,n+1);
 network.clear();const before=fileMap.get('/local/WalletCounter-updater-v1/active.json');assert.equal(await api.checkUpdates(),false);assert.equal(fileMap.get('/local/WalletCounter-updater-v1/active.json'),before);
 const actual=release('0.3.6',actualEngine);serve(actual);await api.installRelease(api.validateManifest(actual),null);
 fileMap.set('/local/WalletCounter-v1/settings.json',JSON.stringify({schema:1,monthlyDefault:600000,months:{},notifications:false}));
 const oldEvent=JSON.stringify({schema:1,id:'old',type:'purchase',source:'manual',amount:50,currency:'SEK',sekMinor:5000,merchant:'Fixture',createdAt:new Date().toISOString(),month:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit'}).format(new Date())});
 fileMap.set('/local/WalletCounter-v1/events/old.json',oldEvent);
 const oldData=snap(),networkCount=requests.length;
 network.clear();globals.config.runsInApp=false;globals.args.shortcutParameter={action:'capture',amount:20,currency:'SEK',merchant:'Fixture store'};
 await api.launcherMain();
 assert.equal(requests.length,networkCount,'offline SEK capture must never check updates');
 for(const [p,s]of oldData)assert.equal(fileMap.get(p),s,'existing settings/event bytes must remain unchanged');
 const purchases=[...fileMap].filter(([p])=>p.startsWith('/local/WalletCounter-v1/events/')&&p.endsWith('.json')).map(([,s])=>JSON.parse(s));
 assert.equal(purchases.length,2);assert.equal(purchases.find(p=>p.id!=='old').sekMinor,2000);
 assert.ok(outputs.at(-1).includes('remaining'));
 const beforeZero=purchases.length;
 globals.args.shortcutParameter={action:'capture',amount:0,currency:'SEK',merchant:'SL transit'};
 await api.launcherMain();
 const afterZero=[...fileMap].filter(([p])=>p.startsWith('/local/WalletCounter-v1/events/')&&p.endsWith('.json')).map(([,s])=>JSON.parse(s));
 assert.equal(afterZero.length,beforeZero+1);
 const tap=afterZero.find(p=>p.merchant==='SL transit');
 assert.equal(tap.sekMinor,null);assert.equal(tap.amountUnavailable,true);
 assert.ok(outputs.at(-1).includes('no spending deducted'));
 assert.equal(requests.length,networkCount);
 globals.args.shortcutParameter={action:'capture',amount:-1,currency:'',merchant:'Sl'};
 await api.launcherMain();
 globals.args.shortcutParameter={action:'capture',amount:43,currency:'SEK',merchant:'Sl'};
 await api.launcherMain();
 const sl=[...fileMap].filter(([p])=>p.startsWith('/local/WalletCounter-v1/events/')&&p.endsWith('.json'))
   .map(([,s])=>JSON.parse(s)).filter(p=>p.slFareMinor != null);
 assert.equal(sl.length,2);assert.equal(sl.reduce((n,p)=>n+p.sekMinor,0),4300);
 assert.equal(sl.find(p=>p.slTransferOf).slTransferOf,sl.find(p=>!p.slTransferOf).id);
 assert.equal(requests.length,networkCount,'SL capture through unchanged launcher stays offline');
 globals.args.shortcutParameter={action:'capture',amount:45,currency:'SEK',merchant:''};
 await api.launcherMain();
 const unknown=[...fileMap].filter(([p])=>p.startsWith('/local/WalletCounter-v1/events/')&&p.endsWith('.json'))
   .map(([,s])=>JSON.parse(s)).filter(p=>p.merchantUnavailable);
 assert.equal(unknown.length,1);assert.equal(unknown[0].sekMinor,4500);
 assert.equal(unknown[0].merchant,'Unknown merchant');assert.equal(unknown[0].slFareMinor,undefined);
 assert.equal(requests.length,networkCount,'unnamed SEK capture stays offline');
 for(const [p,s]of oldData)assert.equal(fileMap.get(p),s);

 console.log('PASS: SHA-256 UTF-8 vectors, fixed repo/immutable ref, manifest validation, corrupt/syntax/contract failures, strict move semantics, retry of downloaded release, partial/missing pointer backup recovery, cancel, upgrade, rollback, downgrade refusal, offline update, real-engine offline SEK, unnamed purchase and SL ticket/transfer capture, preserved existing records.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
