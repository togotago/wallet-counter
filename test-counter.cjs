const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const files = new Map();
const dirs = new Set();
let clock = '2026-09-30T11:30:00.000Z', seq = 0;
class Clock extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return new Date(clock).getTime(); } }
const fm = {
  libraryDirectory: () => '/local', temporaryDirectory: () => '/tmp', joinPath: (a,b) => a+'/'+b,
  createDirectory(p) { dirs.add(p); }, fileExists: p => files.has(p) || dirs.has(p), readString: p => files.get(p),
  writeString: (p,s) => files.set(p,s),
  move(a,b) { if(files.has(b))throw Error('Destination exists'); if(!files.has(a))throw Error('Source missing'); files.set(b,files.get(a)); files.delete(a); },
  listContents(p) { return [...files.keys()].filter(k => k.startsWith(p+'/') && !k.slice(p.length+1).includes('/')).map(k => k.slice(p.length+1)); }
};
const notifications = [], outputs = [];
let fxRows = null, fxStatus = 200, requests = 0;
class MockRequest {
  constructor(url) { assert.equal(url, 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=SEK'); }
  async loadJSON() { requests++; assert.equal(this.timeoutInterval,5); if (fxRows === null) throw Error('Offline'); this.response={statusCode:fxStatus}; return fxRows; }
}
const context = vm.createContext({Date: Clock, Intl, console, FileManager: {local: () => fm},
  Request: MockRequest, UUID: {string: () => 'id-'+String(++seq).padStart(5,'0')},
  Notification: class {
    constructor() { this.actions=[]; }
    addAction(title,url,destructive=false) { this.actions.push({title,url,destructive}); }
    async schedule() { notifications.push({identifier:this.identifier,title:this.title,body:this.body,openURL:this.openURL,actions:this.actions}); }
    static async removeDelivered() {}
  },
  Script: {name: () => 'Wallet Counter', setShortcutOutput: s => outputs.push(s), complete() {}},
  config: {runsInApp:false,runsInWidget:false}, args: {shortcutParameter:null,queryParameters:{}}
});
const src = fs.readFileSync(path.join(__dirname,'WalletCounter.js'),'utf8');
vm.runInContext(src.replace('module.exports = {version: VERSION, run: async controller => { updateController = controller; await main(); }};', 'globalThis.WC = {parseAmount, monthKey, minor, materialize, summary, normalizeInput, emptyWalletCapture, capture, handleSlPrompt, current, settingsSave, settingsRead, appendEvent, effectiveSettings, eventsRead, fxEstimate, fxRefresh, usableRate, slFare};'), context);
const w = context.WC;
async function run() {
  assert.equal(w.parseAmount('149,50'),149.5);
  assert.equal(w.parseAmount('SEK 1 249,50'),1249.5);
  assert.equal(w.parseAmount('1,249.50'),1249.5);
  assert.equal(w.parseAmount('1.249,50'),1249.5);
  for (const bad of ['1,249','12,00,00','NaN','-4','0','ten',{},Infinity]) assert.throws(() => w.parseAmount(bad));
  assert.equal(w.monthKey(new Date('2026-09-30T21:59:59Z')),'2026-09');
  assert.equal(w.monthKey(new Date('2026-09-30T22:00:00Z')),'2026-10');
  assert.equal(w.monthKey(new Date('2026-12-31T23:00:00Z')),'2027-01');
  assert.equal(w.monthKey(new Date('2026-10-31T23:00:00Z')),'2026-11');
  const purchase = {action:'test',amount:'149,50',currency:'SEK',merchant:'ICA'};
  await w.capture(purchase);
  assert.equal(w.eventsRead().length,0,'diagnostic capture must not count as spending');
  w.settingsSave({schema:1,monthlyDefault:600000,months:{'2026-09':600000},notifications:true});
  await w.capture({...purchase,action:'capture'});
  assert.equal(w.current().sum.remaining,585050);
  clock='2026-09-30T11:30:05.000Z';
  await w.capture({...purchase,action:'capture'});
  assert.equal(w.current().sum.spent,29900,'suspected duplicates are preserved');
  assert.equal(w.current().sum.unresolved,1);
  const duplicate=w.current().sum.tx.find(t=>t.duplicateOf);
  w.appendEvent({type:'void',target:duplicate.id});
  assert.equal(w.current().sum.remaining,585050);
  await w.capture({action:'capture',amount:25,currency:'EUR',merchant:'Barcelona Cafe'});
  assert.equal(w.current().sum.spent,14950,'foreign purchase must not be silently treated as SEK');
  const foreign=w.current().sum.tx.find(t=>t.currency==='EUR');
  w.appendEvent({type:'conversion',target:foreign.id,sekMinor:28000});
  assert.equal(w.current().sum.spent,42950);
  w.appendEvent({type:'refund',source:'manual',month:'2026-09',amount:50,currency:'SEK',sekMinor:5000,merchant:'Refund'});
  assert.equal(w.current().sum.spent,37950);
  // Next-month default must not change September's target.
  w.settingsSave({...w.current().settings,monthlyDefault:500000});
  assert.equal(w.current().sum.allowance,600000);
  clock='2026-09-30T22:00:00.000Z';
  assert.equal(w.current().sum.allowance,500000);
  assert.equal(w.current().sum.spent,0);
  await w.capture({action:'capture',amount:10,currency:'SEK',merchant:'October store'});
  clock='2026-11-01T12:00:00.000Z';
  const s=w.current().settings;
  s.monthlyDefault=400000; s.months['2026-11']=400000; w.settingsSave(s);
  assert.equal(w.summary(w.eventsRead(),w.current().settings,'2026-10').allowance,500000,'October target stays pinned');
  const n=w.eventsRead().length;
  await assert.rejects(w.capture({action:'capture',amount:30,currency:'',merchant:'Bad input'}));
  assert.equal(w.eventsRead().length,n);
  assert.equal(w.emptyWalletCapture({action:'capture',amount:0,currency:'',merchant:''}),true);
  assert.equal(w.emptyWalletCapture({action:'capture',amount:'0,00',currency:'',name:' '}),true);
  assert.equal(w.emptyWalletCapture({action:'capture',amount:30,currency:'',merchant:''}),false,'positive partial payload stays strict');
  assert.equal(w.emptyWalletCapture({action:'test',amount:0,currency:'',merchant:''}),false,'diagnostics never become SL prompts');
  const emptyBefore=w.eventsRead().length, emptySpent=w.current().sum.spent;
  await w.capture({action:'capture',amount:0,currency:'',merchant:''});
  const emptyPrompt=w.eventsRead().find(e=>e.type==='sl_prompt');
  assert.ok(emptyPrompt,'empty Wallet capture creates a pending SL prompt');
  assert.equal(w.eventsRead().length,emptyBefore+1);
  assert.equal(w.current().sum.spent,emptySpent,'empty capture never changes spending before confirmation');
  assert.equal(notifications.at(-1).title,'Was this an SL tap?');
  assert.deepEqual(notifications.at(-1).actions.map(a=>a.title),['Yes, log SL','No']);
  assert.ok(outputs.at(-1).includes('no spending deducted yet'));
  await w.handleSlPrompt(emptyPrompt.id,'no');
  assert.equal(w.current().sum.spent,emptySpent,'declining SL prompt keeps spending unchanged');
  assert.ok(w.eventsRead().some(e=>e.type==='sl_prompt_response'&&e.target===emptyPrompt.id&&e.response==='no'));
  await w.handleSlPrompt(emptyPrompt.id,'no');
  assert.equal(w.current().sum.spent,emptySpent,'replaying a declined prompt is harmless');
  // Corrections in the same millisecond must apply after their purchase.
  const reconciled=w.materialize([{schema:1,type:'conversion',id:'a',createdAt:clock,target:'z',sekMinor:100},
    {schema:1,type:'purchase',id:'z',createdAt:clock,sekMinor:null}]);
  assert.equal(reconciled[0].sekMinor,100);
  // SEK and test mode never request rates. Foreign purchases use reference estimates.
  clock='2026-11-01T12:00:00.000Z';
  const beforeRequests=requests;
  await w.capture({action:'test',amount:20,currency:'EUR',merchant:'Test only'});
  await w.capture({action:'capture',amount:12.34,currency:'SEK',merchant:'Native SEK'});
  assert.equal(requests,beforeRequests);
  fxRows=[{date:'2026-10-30',base:'SEK',quote:'EUR',rate:0.1},
    {date:'2026-10-30',base:'SEK',quote:'GBP',rate:0.08},
    {date:'2026-10-30',base:'SEK',quote:'USD',rate:0.125}];
  const spentBeforeFX=w.current().sum.spent;
  await w.capture({action:'capture',amount:20,currency:'EUR',merchant:'Spain'});
  assert.equal(w.current().sum.spent,spentBeforeFX+20000);
  const eur=w.current().sum.tx.find(t=>t.merchant==='Spain');
  assert.equal( eur.amount,20); assert.equal(eur.currency,'EUR'); assert.equal(eur.fxEstimated,true);
  assert.equal(eur.fx.rate,10);assert.equal(eur.fx.rateDate,'2026-10-30');
  const networkCount=requests;
  fxRows=null;
  await w.capture({action:'capture',amount:10,currency:'GBP',merchant:'London offline'});
  assert.equal(w.current().sum.tx.find(t=>t.merchant==='London offline').sekMinor,12500);
  assert.equal(requests,networkCount,'warm cache needs no network');
  clock='2026-11-02T12:00:00.000Z';
  await w.capture({action:'capture',amount:10,currency:'USD',merchant:'Offline fallback'});
  assert.equal(w.current().sum.tx.find(t=>t.merchant==='Offline fallback').sekMinor,8000);
  // Manual correction replaces the estimate without adding a second purchase.
  w.appendEvent({type:'conversion',target:eur.id,sekMinor:21000,fxEstimated:false});
  const corrected=w.current().sum.tx.find(t=>t.id===eur.id);
  assert.equal(corrected.sekMinor,21000);assert.equal(corrected.fxEstimated,false);assert.equal(corrected.fx,null);
  const previous=w.eventsRead().length;
  await w.capture({action:'capture',amount:5,currency:'XYZ',merchant:'Unsupported'});
  assert.equal(w.eventsRead().length,previous+1,'unsupported purchase is saved without conversion');
  assert.equal(w.current().sum.tx.find(t=>t.merchant==='Unsupported').sekMinor,null);
  clock='2026-11-08T12:00:00.000Z';
  await w.capture({action:'capture',amount:20,currency:'EUR',merchant:'Expired offline'});
  assert.equal(w.current().sum.tx.find(t=>t.merchant==='Expired offline').sekMinor,null);
  for (const rate of [0,-1,Infinity,NaN,'0.1']) assert.equal(w.usableRate({rate,date:'2026-11-08'}),false);
  assert.equal(w.usableRate({rate:1,date:'2026-11-30'}),false);
  assert.equal(w.usableRate({rate:1,date:'2026-02-30'}),false);
  fxRows={error:'bad'};await assert.rejects(w.fxRefresh());
  fxRows=[{date:'2026-11-08',base:'USD',quote:'EUR',rate:0.1}];await assert.rejects(w.fxRefresh());
  fxRows=[{date:'2026-11-08',base:'SEK',quote:'EUR',rate:0.1}];fxStatus=500;await assert.rejects(w.fxRefresh());fxStatus=200;
  await w.capture({action:'capture',amount:1.234,currency:'EUR',merchant:'Rounding'});
  assert.equal(w.current().sum.tx.find(t=>t.merchant==='Rounding').sekMinor,1234);
  // The rate is pinned: later refreshes cannot retroactively alter the purchase.
  fxRows=[{date:'2026-11-08',base:'SEK',quote:'EUR',rate:0.2}];await w.fxRefresh();
  assert.equal(w.current().sum.tx.find(t=>t.merchant==='Rounding').sekMinor,1234);
  // Transit authorizations must remain pending and never guess a fare.
  const beforeTransit = w.current().sum.spent, beforeTransitRequests = requests;
  const zero = {action:'capture',amount:0,currency:'SEK',merchant:'SL transit'};
  await w.capture(zero);
  const tap = w.current().sum.tx.find(t => t.merchant === 'SL transit');
  assert.equal(tap.amount,0); assert.equal(tap.amountUnavailable,true);
  assert.equal(tap.pendingReason,'wallet_zero_amount'); assert.equal(tap.sekMinor,null);
  assert.equal(w.current().sum.spent,beforeTransit);
  assert.equal(requests,beforeTransitRequests,'zero SEK tap must not request rates');
  assert.equal(notifications.at(-1).title,'Wallet tap needs review');
  assert.ok(outputs.at(-1).includes('no spending deducted'));
  assert.throws(()=>w.parseAmount(0),'manual zero remains invalid');
  assert.throws(()=>w.normalizeInput({...zero,amount:-1}));
  assert.throws(()=>w.normalizeInput({...zero,amount:null}));
  assert.throws(()=>w.normalizeInput({...zero,amount:NaN}));
  assert.throws(()=>w.normalizeInput({...zero,currency:''}));
  assert.equal(w.normalizeInput({...zero,merchant:''}).merchant,'Unknown merchant');
  await w.capture({...zero,amount:'0,00',currency:'GBP',merchant:'Foreign transit'});
  assert.equal(requests,beforeTransitRequests,'zero foreign tap must not request rates');
  assert.equal(w.current().sum.spent,beforeTransit);
  w.appendEvent({type:'conversion',target:tap.id,sekMinor:4300,fxEstimated:false});
  assert.equal(w.current().sum.spent,beforeTransit+4300,'manual charge applied once');
  w.appendEvent({type:'void',target:tap.id});
  assert.equal(w.current().sum.spent,beforeTransit,'undo pending/corrected tap works');
  const beforeDiagnostic=w.eventsRead().length;
  await w.capture({...zero,action:'test'});
  assert.equal(w.eventsRead().length,beforeDiagnostic,'zero diagnostic does not create spending');
  assert.ok(notifications.length>0);
  // SL is an explicit single-card approximation; no Wallet amount parsing or network.
  clock='2026-12-15T10:00:00.000Z';
  const preserved = new Map(files), requestsBeforeSL=requests;
  const sl={action:'capture', merchant:' Sl ', amount:-1, currency:''};
  await w.capture(sl);
  let tickets=w.current().sum.tx.filter(t=>t.slFareMinor != null);
  const first=tickets[0];
  assert.equal(first.sekMinor,4300); assert.equal(first.slEstimated,true);
  assert.equal(first.slTransferOf,null); assert.equal(w.current().sum.unresolved,0);
  assert.equal(w.current().sum.spent,4300); assert.equal(w.current().sum.estimated,1);
  clock='2026-12-15T10:40:00.000Z';
  await w.capture({...sl,amount:43,currency:'SEK'});
  assert.equal(w.current().sum.spent,4300);
  let transfer=w.current().sum.tx.find(t=>t.slTransferOf);
  assert.equal(transfer.slTransferOf,first.id); assert.equal(transfer.sekMinor,0);
  assert.equal(transfer.duplicateOf,null);
  clock='2026-12-15T11:14:59.999Z';
  // Reload the engine against the same storage to simulate an app restart.
  const restart=vm.createContext({...context});
  vm.runInContext(src.replace('module.exports = {version: VERSION, run: async controller => { updateController = controller; await main(); }};', 'globalThis.WC = {capture, current};'),restart);
  await restart.WC.capture({...sl,amount:{unreadable:true},currency:null});
  assert.equal(restart.WC.current().sum.spent,4300,'transfers do not slide the window');
  clock='2026-12-15T11:15:00.000Z';
  await w.capture({...sl,amount:0});
  assert.equal(w.current().sum.spent,8600,'exactly 75 minutes starts a new ticket');
  const second=w.current().sum.tx.find(t=>t.slFareMinor && !t.slTransferOf && t.id!==first.id);
  w.appendEvent({type:'conversion',target:second.id,sekMinor:2600,fxEstimated:false});
  assert.equal(w.current().sum.tx.find(t=>t.id===second.id).slEstimated,false);
  clock='2026-12-15T11:20:00.000Z';
  await w.capture(sl);
  assert.equal(w.current().sum.spent,6900,'correction preserves the ticket anchor');
  w.appendEvent({type:'void',target:second.id});
  clock='2026-12-15T11:21:00.000Z';
  await w.capture(sl);
  assert.equal(w.current().sum.spent,8600,'undone ticket cannot suppress a new fare');
  const eventsBeforeTest=w.eventsRead().length;
  await w.capture({...sl,action:'test'});
  assert.equal(w.eventsRead().length,eventsBeforeTest,'SL diagnostics create no window or charge');
  for(const merchant of ['Sl cafe','S.L.','SL transit'])
    assert.throws(()=>w.normalizeInput({...sl,merchant}),'matching must be exact');
  await w.capture({action:'capture',merchant:'Regular store',amount:19,currency:'SEK'});
  assert.equal(w.current().sum.spent,10500,'normal purchases still count inside SL window');
  w.settingsSave({...w.current().settings,slFareMinor:2600});
  clock='2026-12-15T13:00:00.000Z';
  await w.capture(sl);
  assert.equal(w.current().sum.spent,13100,'edited fare applies only to new tickets');
  clock='2026-12-31T22:30:00.000Z';
  await w.capture(sl);
  const decemberSpent=w.current().sum.spent;
  clock='2026-12-31T23:00:00.000Z'; // Stockholm January 1, same ticket.
  await w.capture(sl);
  assert.equal(w.current().sum.spent,0,'month reset does not end the ticket');
  assert.equal(w.current().sum.unresolved,0);
  assert.equal(w.summary(w.eventsRead(),w.current().settings,'2026-12').spent,decemberSpent);
  clock='2026-12-31T23:45:00.000Z';
  await w.capture(sl);
  assert.equal(w.current().sum.spent,2600);
  assert.equal(requests,requestsBeforeSL,'SL never fetches FX');
  for(const [p,bytes] of preserved) if(p.includes('/events/'))
    assert.equal(files.get(p),bytes,'older event files remain byte-for-byte unchanged');
  const beforeUnknown = w.current().sum.spent, beforeUnknownRequests = requests;
  for(const merchant of [undefined, '', '  ', null, {}]) {
    const input = w.normalizeInput({action:'capture', amount:45, currency:'SEK', merchant});
    assert.equal(input.merchant,'Unknown merchant'); assert.equal(input.merchantUnavailable,true);
    assert.equal(input.sl,false,'missing merchant must never imply SL');
  }
  await w.capture({action:'capture',amount:45,currency:'SEK',merchant:''});
  const unknown = w.current().sum.tx.find(t=>t.merchantUnavailable);
  assert.equal(unknown.sekMinor,4500); assert.equal(unknown.merchant,'Unknown merchant');
  assert.equal(w.current().sum.spent,beforeUnknown+4500);
  assert.ok(outputs.at(-1).includes('Wallet supplied no merchant name'));
  await w.capture({action:'capture',amount:0,currency:'SEK'});
  assert.equal(w.current().sum.spent,beforeUnknown+4500,'unnamed zero stays pending, no guessed fare');
  assert.equal(requests,beforeUnknownRequests);
  const beforeUnknownTest = w.eventsRead().length;
  await w.capture({action:'test',amount:45,currency:'SEK'});
  assert.equal(w.eventsRead().length,beforeUnknownTest);
  assert.equal(w.normalizeInput({action:'capture',amount:45,currency:'SEK',merchant:' ',name:'Wallins'}).merchant,'Wallins');
  assert.equal(w.normalizeInput({action:'capture',amount:-1,name:'Sl'}).sl,true);
  for(const amount of [-1,null,NaN,{}]) assert.throws(()=>w.normalizeInput({action:'capture',amount,currency:'SEK'}));
  assert.throws(()=>w.normalizeInput({action:'capture',amount:45,currency:''}));
  fxRows=[{date:'2027-01-01',base:'SEK',quote:'EUR',rate:0.1}];
  const beforeUnknownFX=w.current().sum.spent;
  await w.capture({action:'capture',amount:5,currency:'EUR',merchant:' '});
  const unknownFX=w.current().sum.tx.find(t=>t.merchantUnavailable && t.currency==='EUR');
  assert.equal(unknownFX.sekMinor,5000);assert.equal(unknownFX.fxEstimated,true);
  assert.equal(w.current().sum.spent,beforeUnknownFX+5000);
  // Completely empty Wallet payloads can be confirmed later as SL while keeping the original tap time.
  w.settingsSave({...w.current().settings,slFareMinor:4300});
  clock='2027-01-03T10:00:00.000Z';
  const promptBase=w.current().sum.spent;
  await w.capture({action:'capture',amount:0,currency:'',merchant:'',name:''});
  const p1=w.eventsRead().filter(e=>e.type==='sl_prompt').at(-1);
  clock='2027-01-03T10:10:00.000Z';
  await w.handleSlPrompt(p1.id,'yes');
  let promptTicket=w.current().sum.tx.find(x=>x.slPromptOf===p1.id);
  assert.equal(promptTicket.createdAt,'2027-01-03T10:00:00.000Z','confirmed SL uses original Wallet tap time');
  assert.equal(promptTicket.sekMinor,4300); assert.equal(w.current().sum.spent,promptBase+4300);
  const afterFirstPrompt=w.current().sum.spent;
  await w.handleSlPrompt(p1.id,'yes');
  assert.equal(w.current().sum.spent,afterFirstPrompt,'replaying yes cannot double-log the same prompt');
  clock='2027-01-03T10:40:00.000Z';
  await w.capture({action:'capture',amount:'0,00',currency:'',merchant:''});
  const p2=w.eventsRead().filter(e=>e.type==='sl_prompt').at(-1);
  clock='2027-01-03T10:55:00.000Z';
  await w.handleSlPrompt(p2.id,'yes');
  const promptTransfer=w.current().sum.tx.find(x=>x.slPromptOf===p2.id);
  assert.equal(promptTransfer.createdAt,'2027-01-03T10:40:00.000Z');
  assert.equal(promptTransfer.sekMinor,0); assert.equal(promptTransfer.slTransferOf,promptTicket.id);
  assert.equal(w.current().sum.spent,afterFirstPrompt,'late confirmation still uses the original 75-minute window');
  clock='2027-01-04T10:00:00.000Z';
  await w.capture({action:'capture',amount:0,currency:'',merchant:''});
  const stale=w.eventsRead().filter(e=>e.type==='sl_prompt').at(-1);
  clock='2027-01-05T10:00:01.000Z';
  const beforeStale=w.current().sum.spent;
  await w.handleSlPrompt(stale.id,'yes');
  assert.equal(w.current().sum.spent,beforeStale,'prompts older than 24 hours cannot create a charge');
  assert.ok(w.eventsRead().some(e=>e.type==='sl_prompt_response'&&e.target===stale.id&&e.response==='expired'));
  clock='2027-01-06T10:00:00.000Z';
  await w.capture({action:'capture',amount:0,currency:'',merchant:''});
  const early=w.eventsRead().filter(e=>e.type==='sl_prompt').at(-1);
  assert.equal(early.allowanceAtCapture,w.current().sum.allowance,'prompt snapshots the tap-month allowance');
  clock='2027-01-06T10:40:00.000Z';
  await w.capture({action:'capture',amount:0,currency:'',merchant:''});
  const late=w.eventsRead().filter(e=>e.type==='sl_prompt').at(-1);
  clock='2027-01-06T10:41:00.000Z';
  await w.handleSlPrompt(late.id,'yes');
  const afterLate=w.current().sum.spent;
  clock='2027-01-06T10:42:00.000Z';
  await w.handleSlPrompt(early.id,'yes');
  assert.equal(w.current().sum.spent,afterLate,'older prompt cannot double-charge after a later SL ticket was already logged');
  assert.ok(w.eventsRead().some(e=>e.type==='sl_prompt_response'&&e.target===early.id&&e.response==='conflict'));
  console.log('PASS: empty Wallet fallback prompts for SL, no/yes handling, replay safety, original-tap 75-minute window, out-of-order conflict guard, and 24-hour expiry.');
  console.log('PASS: unnamed SEK/FX capture, Name fallback, unnamed zero pending, diagnostics without spending, no SL inference, invalid amount/currency still rejected.');
  console.log('PASS: SL fixed window, exact boundary, restart, cross-month/year, transfer links, corrections/undo, edited fare, exact merchant match, ignored negative/missing SL values, no FX, preserved history;  parsing, Stockholm month boundaries, test/live capture, duplicates, conversion, refunds, allowance history invalid input, FX inversion/rounding, EUR/GBP/USD, offline cache/expiry, malformed rates, manual FX corrections pinned estimates, zero transit taps, no guessed fare, manual correction/undo and unchanged strict validation.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
