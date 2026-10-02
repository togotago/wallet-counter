const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const files = new Map(), dirs = new Set();
let clock = '2026-10-02T17:00:00.000Z', seq = 0;
class Clock extends Date { constructor(...a){super(...(a.length?a:[clock]));} static now(){return new Date(clock).getTime();} }
const fm={libraryDirectory:()=>'/local',temporaryDirectory:()=>'/tmp',joinPath:(a,b)=>a+'/'+b,
  createDirectory:p=>dirs.add(p),fileExists:p=>files.has(p)||dirs.has(p),readString:p=>files.get(p),writeString:(p,s)=>files.set(p,s),
  listContents:p=>[...files.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(k=>k.slice(p.length+1))};
const context=vm.createContext({Date:Clock,Intl,console,FileManager:{local:()=>fm},UUID:{string:()=> 'id-'+String(++seq).padStart(5,'0')},
  Notification:class{async schedule(){}},Request:class{async loadJSON(){throw Error('unexpected network')}},
  Script:{name:()=> 'Wallet Counter',setShortcutOutput(){},complete(){}},config:{runsInApp:false,runsInWidget:false},args:{shortcutParameter:null}});
const src=fs.readFileSync(path.join(__dirname,'WalletCounter.js'),'utf8');
const marker='module.exports = {version: VERSION, run: async controller => { updateController = controller; await main(); }};';
vm.runInContext(src.replace(marker,'globalThis.WC={capture,current,settingsSave,eventsRead,debugLines,debugLog};'),context);
const w=context.WC;
(async()=>{
  w.settingsSave({schema:1,monthlyDefault:1000000,months:{'2026-10':1000000},notifications:false});
  await w.capture({action:'capture',amount:45,currency:'SEK'});
  const tx=w.current().sum.tx[0];
  assert.equal(tx.merchant,'Unknown merchant');assert.equal(tx.sekMinor,4500);
  let logs=w.debugLines().map(JSON.parse), last=logs.at(-1);
  assert.equal(last.event,'capture_saved');assert.equal(last.version,'0.3.5');
  assert.equal(last.input.amount.value,45);assert.equal(last.input.merchant.type,'undefined');
  assert.equal(last.normalized.merchant,'Unknown merchant');assert.equal(last.result.sekMinor,4500);
  const count=w.eventsRead().length;
  await assert.rejects(w.capture({action:'capture',amount:12,currency:'',merchant:'Bad'}));
  assert.equal(w.eventsRead().length,count);last=w.debugLines().map(JSON.parse).at(-1);
  assert.equal(last.event,'capture_failed');assert.match(last.error.message,/Missing currency code/);
  await w.capture({action:'capture',merchant:' Sl ',amount:-1,currency:''});
  last=w.debugLines().map(JSON.parse).at(-1);assert.equal(last.normalized.sl,true);assert.equal(last.result.sekMinor,4300);
  for(let i=0;i<130;i++)w.debugLog('rotation_test',{i});
  logs=w.debugLines().map(JSON.parse);assert.equal(logs.length,120);assert.equal(logs[0].i,10);assert.equal(logs.at(-1).i,129);
  console.log('PASS: debug capture success/failure fields, missing merchant, SL, and 120-line rotation.');
})().catch(e=>{console.error(e);process.exit(1)});
