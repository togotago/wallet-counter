// Wallet Counter launcher v1.0.1. Paste once into the existing Wallet Counter script.
// Program updates come only from this repository. Purchase data stays local.
const REPOSITORY = 'togotago/wallet-counter';
const CHANNEL = 'main';
const RAW_ROOT = 'https://raw.githubusercontent.com/' + REPOSITORY + '/';
const MANIFEST_URL = RAW_ROOT + CHANNEL + '/manifest.json';
const ufm = FileManager.local();
const updateRoot = ufm.joinPath(ufm.libraryDirectory(), 'WalletCounter-updater-v1');
const pointerPath = ufm.joinPath(updateRoot, 'active.json');
const pointerBackupPath = pointerPath + '.backup';

// SHA-256 over UTF-8. Checks download completeness and local code integrity.
// This is not a signature: the repository owner is the trusted publisher.
function sha256(text) {
  const bytes = unescape(encodeURIComponent(text));
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const words = [];
  for (let i=0;i<bytes.length;i++) words[i>>2] = (words[i>>2] || 0) | bytes.charCodeAt(i) << (24-(i%4)*8);
  words[bytes.length>>2] = (words[bytes.length>>2] || 0) | 0x80 << (24-(bytes.length%4)*8);
  const end = (((bytes.length+8)>>6)+1)*16;
  words[end-2] = Math.floor(bytes.length*8 / 0x100000000);
  words[end-1] = bytes.length*8;
  const rr = (x,n) => (x>>>n)|(x<<(32-n));
  for(let offset=0;offset<end;offset+=16) {
    const w = Array.from({length:64}, (_,i) => i<16 ? words[offset+i] || 0 : 0);
    for(let i=16;i<64;i++) {
      const s0=rr(w[i-15],7)^rr(w[i-15],18)^(w[i-15]>>>3);
      const s1=rr(w[i-2],17)^rr(w[i-2],19)^(w[i-2]>>>10);
      w[i]=(w[i-16]+s0+w[i-7]+s1)|0;
    }
    let [a,b,c,d,e,f,g,z]=h;
    for(let i=0;i<64;i++) {
      const t1=(z+(rr(e,6)^rr(e,11)^rr(e,25))+((e&f)^(~e&g))+k[i]+w[i])|0;
      const t2=((rr(a,2)^rr(a,13)^rr(a,22))+((a&b)^(a&c)^(b&c)))|0;
      z=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
    }
    h=h.map((v,i)=>(v+[a,b,c,d,e,f,g,z][i])|0);
  }
  return h.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
}
function validVersion(v) { return typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v); }
function compareVersions(a,b) {
  const aa=a.split('.').map(Number), bb=b.split('.').map(Number);
  for(let i=0;i<3;i++) if(aa[i]!==bb[i]) return aa[i]>bb[i] ? 1 : -1;
  return 0;
}
function validateDescriptor(d) {
  if(!d || !validVersion(d.version) || !/^[a-f0-9]{64}$/.test(d.sha256 || '')) throw Error('Invalid release metadata.');
  return {version:d.version,sha256:d.sha256};
}
function validateManifest(m) {
  if(!m || m.schema!==1 || m.launcher!==1) throw Error('This release requires a different launcher.');
  const d=validateDescriptor(m);
  if(m.path !== 'releases/WalletCounter-'+d.version+'.js') throw Error('Invalid release path.');
  if(typeof m.ref !== 'string' || !/^[a-f0-9]{40}$/.test(m.ref)) throw Error('Release must point to an immutable Git commit.');
  return {...d,path:m.path,ref:m.ref,notes:typeof m.notes==='string' ? m.notes.slice(0,1000) : ''};
}
function codePath(d) { return ufm.joinPath(updateRoot, 'WalletCounter-'+d.version+'-'+d.sha256+'.js'); }
function readPointer() {
  for(const path of [pointerPath,pointerBackupPath]) {
    if(!ufm.fileExists(path)) continue;
    try {
      const p=JSON.parse(ufm.readString(path));
      if(p.schema!==1) throw Error('Update settings are invalid.');
      return {schema:1,active:validateDescriptor(p.active),previous:p.previous ? validateDescriptor(p.previous) : null};
    } catch(e) { if(path===pointerBackupPath || !ufm.fileExists(pointerBackupPath)) throw e; }
  }
  return null;
}
function writePointer(p) {
  ufm.createDirectory(updateRoot,true);
  const previous=readPointer();
  if(previous) ufm.writeString(pointerBackupPath,JSON.stringify(previous));
  // Commit only after the complete release file is saved and checked.
  // writeString explicitly supports replacement; move does not on some devices.
  try { ufm.writeString(pointerPath,JSON.stringify(p)); }
  catch(e) {
    if(previous) try { ufm.writeString(pointerPath,JSON.stringify(previous)); } catch(_) {}
    throw e; // readPointer can recover the backup if a write was interrupted.
  }
}
function loadRelease(d) {
  const path=codePath(d);
  if(!ufm.fileExists(path) || sha256(ufm.readString(path))!==d.sha256) throw Error('Saved release is missing or damaged.');
  const engine=importModule(path);
  if(!engine || engine.version!==d.version || typeof engine.run!=='function') throw Error('Invalid Wallet Counter module.');
  return engine;
}
async function fetchText(url) {
  const r=new Request(url);r.timeoutInterval=10;
  // No credentials or redirects to another host. Download only from the fixed repo.
  r.onRedirect=()=>null;
  const text=await r.loadString();
  if(!r.response || r.response.statusCode!==200) throw Error('GitHub unavailable (HTTP '+(r.response && r.response.statusCode)+').');
  if(typeof text!=='string' || text.length>500000) throw Error('Invalid or oversized download.');
  return text;
}
async function installRelease(m,p) {
  const text=await fetchText(RAW_ROOT+m.ref+'/'+m.path);
  if(sha256(text)!==m.sha256) throw Error('Download checksum did not match. Current version kept.');
  // Syntax check without running the new code.
  new Function('module','exports',text);
  const d=validateDescriptor(m),path=codePath(d);
  ufm.createDirectory(updateRoot,true);
  ufm.writeString(path,text); // Also permits retrying an already downloaded release.
  loadRelease(d); // Validate the contract before switching the active pointer.
  writePointer({schema:1,active:d,previous:p ? p.active : null});
}
async function updateMessage(title,body) {
  const a=new Alert();a.title=title;a.message=body;a.addAction('OK');await a.presentAlert();
}
async function updateChoice(title,body,labels) {
  const a=new Alert();a.title=title;a.message=body;labels.forEach(x=>a.addAction(x));a.addCancelAction('Cancel');return await a.presentSheet();
}
async function checkUpdates(initial=false) {
  try {
    const p=readPointer();
    const m=validateManifest(JSON.parse(await fetchText(MANIFEST_URL+'?t='+Date.now())));
    if(p && compareVersions(m.version,p.active.version)<=0) {
      await updateMessage('Up to date','Installed: '+p.active.version+'. No newer release available.');return false;
    }
    if(!initial && await updateChoice('Install '+m.version+'?',m.notes+'\nAllowance and purchases stay on this phone. The previous program version stays available.', ['Install update'])!==0) return false;
    await installRelease(m,p);
    await updateMessage('Installed '+m.version,initial ? 'Wallet Counter is ready. Setup opens next.' : 'The new version will run next time. No Shortcut changes are needed.');
    return true;
  } catch(e) {
    await updateMessage('Update not installed',e.message+'\nAny existing installed version is unchanged.');return false;
  }
}
async function rollbackRelease() {
  const p=readPointer();
  if(!p || !p.previous) { await updateMessage('No previous version','A backup becomes available after your next update.');return false; }
  loadRelease(p.previous);
  if(await updateChoice('Restore '+p.previous.version+'?','This changes the program only. It does not undo spending or change your allowance.', ['Restore previous version'])!==0) return false;
  writePointer({schema:1,active:p.previous,previous:p.active});
  await updateMessage('Previous version restored','It will run next time.');return true;
}
async function launcherMain() {
  try {
    let p=readPointer();
    if(!p) {
      if(!config.runsInApp || args.shortcutParameter!=null) throw Error('Open Wallet Counter in Scriptable while online to finish installation.');
      if(!await checkUpdates(true)) return;
      p=readPointer();
    }
    let engine;
    try { engine=loadRelease(p.active); }
    catch(e) {
      if(config.runsInApp && args.shortcutParameter==null && p.previous) {
        if(await rollbackRelease()) return;
      }
      throw e;
    }
    await engine.run({check:()=>checkUpdates(false),rollback:rollbackRelease});
  } catch(e) {
    const text='Wallet Counter: '+e.message;
    if(config.runsInWidget) {
      const w=new ListWidget();w.addText('Wallet Counter needs attention');w.addText(e.message);w.url='scriptable:///run?scriptName='+encodeURIComponent(Script.name());Script.setWidget(w);
    } else if(config.runsInApp && args.shortcutParameter==null) await updateMessage('Wallet Counter error',text);
    else {
      try {const n=new Notification();n.title='Purchase not confirmed';n.body=text;await n.schedule();}catch(_){}
      Script.setShortcutOutput(text);throw e;
    }
  } finally {Script.complete();}
}
await launcherMain();
