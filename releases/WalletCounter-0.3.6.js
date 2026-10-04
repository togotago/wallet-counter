// Wallet Counter engine v0.3.6 — loaded by the Wallet Counter launcher.
// Purchase data stays local. Only public ECB exchange rates are requested.
// Shortcut input: {action: 'test'|'capture', amount: '149.50', currency: 'SEK', merchant: 'ICA'}

const VERSION = '0.3.6';
let updateController = null;
const ZONE = 'Europe/Stockholm';

function monthKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, year: 'numeric', month: '2-digit'
  }).formatToParts(date);
  return parts.find(p => p.type === 'year').value + '-' + parts.find(p => p.type === 'month').value;
}

function parseAmount(input, allowZero = false) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0 || (!allowZero && input === 0) || input > 100000000) throw new Error('Amount must be a positive number.');
    return input;
  }
  if (typeof input !== 'string') throw new Error('Pass the Amount property, not the whole Wallet transaction.');
  let s = input.trim().replace(/\u2212/g, '-');
  s = s.replace(/\b[A-Z]{3}\b/gi, '').replace(/\bkr\b/gi, '').replace(/[€£$]/g, '').trim();
  s = s.replace(/[\s\u00a0\u202f]/g, '');
  if (!/^[0-9]+([.,][0-9]+)*$/.test(s)) throw new Error('Cannot read amount: ' + input);
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    const pair = s.split(decimal);
    if (pair.length !== 2 || !new RegExp('^\\d{1,3}(\\' + grouping + '\\d{3})+$').test(pair[0]) || !/^\d{1,2}$/.test(pair[1]))
      throw new Error('Ambiguous amount. Pass an unformatted numeric Amount.');
    s = pair[0].split(grouping).join('') + '.' + pair[1];
  } else if (comma >= 0 || dot >= 0) {
    const sep = comma >= 0 ? ',' : '.';
    const pair = s.split(sep);
    // Three fractional digits are ambiguous (12,500 could mean 12.5 or 12500).
    if (pair.length !== 2 || !/^\d{1,2}$/.test(pair[1])) throw new Error('Ambiguous amount. Pass an unformatted numeric Amount.');
    s = pair[0] + '.' + pair[1];
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 100000000) throw new Error('Amount must be a positive number.');
  return n;
}

function minor(n) {
  const m = Math.round(n * 100);
  if (!Number.isSafeInteger(m)) throw new Error('Amount is too large.');
  return m;
}
function money(m) {
  return new Intl.NumberFormat('sv-SE', {maximumFractionDigits: 0}).format(m / 100) + ' SEK';
}
function normalizedMerchant(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9åäö]/g, ''); }
function rawDictionary(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { return null; }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}
function blankField(v) { return v == null || (typeof v === 'string' && !v.trim()); }
function zeroOrMissingAmount(v) {
  if (blankField(v)) return true;
  try { return parseAmount(v, true) === 0; } catch (_) { return false; }
}
function emptyWalletCapture(raw) {
  const v = rawDictionary(raw);
  return !!v && String(v.action || '').toLowerCase() === 'capture' && zeroOrMissingAmount(v.amount) &&
    blankField(v.currency) && blankField(v.merchant) && blankField(v.name);
}

function normalizeInput(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { throw new Error('Shortcut input must be a Dictionary or JSON text.'); }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Pass a Dictionary with action, amount, currency and merchant.');
  const action = String(raw.action || '').toLowerCase();
  if (!['test', 'capture'].includes(action)) throw new Error('Set action to test or capture.');
  const merchantName = [raw.merchant, raw.name].find(v => typeof v === 'string' && v.trim());
  const merchant = merchantName ? merchantName.trim().slice(0, 180) : 'Unknown merchant';
  // SL uses a configured fare, so its provisional Wallet amount is not parsed.
  const sl = merchant.toLowerCase() === 'sl';
  const amount = sl ? 0 : parseAmount(raw.amount, true);
  const currency = sl ? 'SEK' : String(raw.currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Missing currency code. Pass Currency Code, for example SEK.');
  return {action, amount, currency, merchant, merchantUnavailable: !merchantName, sl, card: typeof raw.card === 'string' ? raw.card.slice(0, 100) : ''};
}

// One card/device: transfers never become anchors or extend the first tap's window.
function slFare(transactions, now, fareMinor = 4300) {
  const ticket = transactions.find(t => t.source === 'wallet' && t.slFareMinor != null && !t.slTransferOf &&
    now.getTime() >= Date.parse(t.createdAt) && now.getTime() - Date.parse(t.createdAt) < 75 * 60000);
  return {sekMinor: ticket ? 0 : fareMinor, slFareMinor: fareMinor,
    slEstimated: !ticket, slTransferOf: ticket ? ticket.id : null};
}

function materialize(events) {
  const tx = new Map();
  events = events.slice().sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  // Load purchases first: a correction can be written in the same millisecond.
  for (const e of events) {
    if (e.type === 'purchase' || e.type === 'refund') tx.set(e.id, {...e, voided: false});
  }
  for (const e of events) {
    if (e.type === 'void' && tx.has(e.target)) tx.get(e.target).voided = true;
    else if (e.type === 'conversion' && tx.has(e.target)) Object.assign(tx.get(e.target), {sekMinor: e.sekMinor, fxEstimated: e.fxEstimated === true, fx: e.fx || null, slEstimated: false});
    else if (e.type === 'review' && tx.has(e.target)) tx.get(e.target).reviewed = true;
  }
  return [...tx.values()].filter(t => !t.voided);
}
function duplicateOf(existing, item, now) {
  return existing.find(t => t.type === 'purchase' && t.source === 'wallet' &&
    t.currency === item.currency && t.amount === item.amount &&
    normalizedMerchant(t.merchant) === normalizedMerchant(item.merchant) &&
    t.card === item.card && Math.abs(now.getTime() - new Date(t.createdAt).getTime()) < 90000);
}
function summary(events, settings, month = monthKey()) {
  const all = materialize(events);
  const tx = all.filter(t => t.month === month);
  const spent = tx.reduce((n,t) => n + (t.sekMinor == null ? 0 : t.sekMinor) * (t.type === 'refund' ? -1 : 1), 0);
  const allowance = Object.prototype.hasOwnProperty.call(settings.months, month) ? settings.months[month] : null;
  const unresolved = tx.filter(t => t.sekMinor == null || (t.duplicateOf && !t.reviewed)).length;
  return {tx, spent, allowance, remaining: allowance == null ? null : allowance - spent, unresolved, estimated: tx.filter(t => t.fxEstimated || t.slEstimated).length};
}

const fm = FileManager.local();
const root = fm.joinPath(fm.libraryDirectory(), 'WalletCounter-v1');
const eventDir = fm.joinPath(root, 'events');
const settingsPath = fm.joinPath(root, 'settings.json');
const debugPath = fm.joinPath(root, 'debug-log.jsonl');
const DEBUG_MAX_LINES = 120;
function ensureStorage() { fm.createDirectory(eventDir, true); }
function debugField(value) {
  if (value === undefined) return {type: 'undefined'};
  if (value === null) return {type: 'null', value: null};
  if (typeof value === 'string') return {type: 'string', value: value.slice(0, 180)};
  if (typeof value === 'number') return {type: 'number', value: Number.isFinite(value) ? value : String(value)};
  if (typeof value === 'boolean') return {type: 'boolean', value};
  return {type: Array.isArray(value) ? 'array' : typeof value};
}
function debugInput(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); }
    catch (_) { return {rawType: 'string', raw: debugField(raw)}; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {rawType: Array.isArray(value) ? 'array' : typeof value};
  return {rawType: 'object', keys: Object.keys(value).slice(0, 30), action: debugField(value.action),
    amount: debugField(value.amount), currency: debugField(value.currency), merchant: debugField(value.merchant),
    name: debugField(value.name), card: {type: typeof value.card, present: typeof value.card === 'string' && !!value.card.trim()}};
}
function debugLog(event, details = {}) {
  try {
    ensureStorage();
    const line = JSON.stringify({at: new Date().toISOString(), version: VERSION, event, ...details});
    const lines = fm.fileExists(debugPath) ? fm.readString(debugPath).split('\n').filter(Boolean).slice(-(DEBUG_MAX_LINES - 1)) : [];
    lines.push(line);
    fm.writeString(debugPath, lines.join('\n') + '\n');
  } catch (e) { console.log('Debug log unavailable: ' + e.message); }
}
function debugLines() {
  if (!fm.fileExists(debugPath)) return [];
  return fm.readString(debugPath).split('\n').filter(Boolean);
}
function settingsRead() {
  if (!fm.fileExists(settingsPath)) return {schema: 1, monthlyDefault: null, months: {}, notifications: true};
  const s = JSON.parse(fm.readString(settingsPath));
  if (s.schema !== 1 || typeof s.months !== 'object' || s.months === null) throw new Error('Settings format is invalid. Export data before repairing it.');
  return s;
}
function writeJSON(path, data) {
  fm.writeString(path, JSON.stringify(data));
}
function settingsSave(s) { ensureStorage(); writeJSON(settingsPath, s); }
function eventsRead() {
  if (!fm.fileExists(eventDir)) return [];
  return fm.listContents(eventDir).filter(n => n.endsWith('.json')).map(n => {
    const e = JSON.parse(fm.readString(fm.joinPath(eventDir, n)));
    if (e.schema !== 1 || !e.id || !e.createdAt || !e.type) throw new Error('A transaction file is invalid. Export data before repairing it.');
    return e;
  });
}
function appendEvent(fields, createdAt = new Date().toISOString()) {
  const when = new Date(createdAt);
  if (!Number.isFinite(when.getTime())) throw new Error('Invalid event time.');
  ensureStorage();
  const e = {...fields, schema: 1, id: UUID.string(), createdAt: when.toISOString()};
  writeJSON(fm.joinPath(eventDir, e.id + '.json'), e);
  return e;
}
function effectiveSettings(s, events) {
  const result = {...s, months: {...s.months}};
  if (s.monthlyDefault != null) {
    // Capture records pin each month's allowance without making capture write shared settings.
    for (const e of events.slice().sort((a,b) => a.createdAt.localeCompare(b.createdAt))) {
      if (e.month && e.allowanceAtCapture != null && !Object.prototype.hasOwnProperty.call(result.months, e.month))
        result.months[e.month] = e.allowanceAtCapture;
    }
    if (!Object.prototype.hasOwnProperty.call(result.months, monthKey())) result.months[monthKey()] = s.monthlyDefault;
  }
  return result;
}
function current() {
  const events = eventsRead(), settings = effectiveSettings(settingsRead(), events);
  return {events, settings, sum: summary(events, settings)};
}
async function notify(title, body) {
  try {
    const n = new Notification(); n.title = title; n.body = body;
    n.openURL = 'scriptable:///run?scriptName=' + encodeURIComponent(Script.name());
    await n.schedule();
  } catch (e) { console.log('Notification unavailable: ' + e.message); }
}
function actionURL(action, promptId) {
  return 'scriptable:///run?scriptName=' + encodeURIComponent(Script.name()) + '&wcAction=' +
    encodeURIComponent(action) + '&prompt=' + encodeURIComponent(promptId);
}
async function slPromptNotification(prompt) {
  try {
    const n = new Notification();
    n.identifier = 'wallet-counter-sl-' + prompt.id;
    n.threadIdentifier = 'wallet-counter-sl';
    n.title = 'Was this an SL tap?';
    n.body = 'Wallet gave no amount, currency or merchant. Log this as an SL tap?';
    n.addAction('Yes, log SL', actionURL('sl-yes', prompt.id));
    n.addAction('No', actionURL('sl-no', prompt.id));
    n.openURL = actionURL('sl-open', prompt.id);
    await n.schedule(); return true;
  } catch (e) {
    debugLog('sl_prompt_notification_failed', {promptId: prompt.id, error: {message: e.message}});
    return false;
  }
}
async function dismissSlPrompt(promptId) {
  try {
    if (typeof Notification.removeDelivered === 'function')
      await Notification.removeDelivered(['wallet-counter-sl-' + promptId]);
  } catch (_) {}
}
const SL_PROMPT_MAX_AGE = 24 * 60 * 60 * 1000;
async function handleSlPrompt(promptId, response) {
  if (typeof promptId !== 'string' || !promptId || promptId.length > 100) throw new Error('Invalid SL confirmation.');
  let st = current();
  const prompt = st.events.find(e => e.type === 'sl_prompt' && e.id === promptId);
  if (!prompt) { await notify('SL confirmation unavailable', 'This Wallet prompt no longer exists. No spending was added.'); return; }
  const resolved = st.events.find(e => (e.type === 'purchase' && e.slPromptOf === prompt.id) ||
    (e.type === 'sl_prompt_response' && e.target === prompt.id));
  if (resolved) { debugLog('sl_prompt_replayed', {promptId, response}); await dismissSlPrompt(promptId); return; }
  if (response === 'open') {
    const i = await choice('Was this an SL tap?', 'Wallet provided no purchase details for this tap.', ['Yes, log SL', 'No']);
    if (i < 0) return;
    response = i === 0 ? 'yes' : 'no';
  }
  if (!['yes', 'no'].includes(response)) throw new Error('Invalid SL confirmation choice.');
  if (response === 'no') {
    appendEvent({type: 'sl_prompt_response', target: prompt.id, response: 'no'});
    debugLog('sl_prompt_declined', {promptId});
    await dismissSlPrompt(promptId); return;
  }
  const tapMs = Date.parse(prompt.createdAt), age = Date.now() - tapMs;
  if (!Number.isFinite(tapMs) || age < -60000 || age > SL_PROMPT_MAX_AGE) {
    appendEvent({type: 'sl_prompt_response', target: prompt.id, response: 'expired'});
    debugLog('sl_prompt_expired', {promptId, age});
    await dismissSlPrompt(promptId);
    await notify('SL confirmation expired', 'The tap was not logged because the prompt is more than 24 hours old.');
    return;
  }
  const tapTime = new Date(prompt.createdAt);
  const transactions = materialize(st.events);
  const transit = slFare(transactions, tapTime, st.settings.slFareMinor || 4300);
  const laterSl = !transit.slTransferOf && transactions.find(t => t.slFareMinor != null &&
    Date.parse(t.createdAt) > tapMs && Date.parse(t.createdAt) - tapMs < 75 * 60000);
  if (laterSl) {
    appendEvent({type: 'sl_prompt_response', target: prompt.id, response: 'conflict'});
    debugLog('sl_prompt_conflict', {promptId, laterSlId: laterSl.id});
    await dismissSlPrompt(promptId);
    await notify('SL tap needs review', 'A later SL tap is already logged inside this tap’s 75-minute window. Nothing was added to avoid double-counting.');
    return;
  }
  const month = monthKey(tapTime);
  const allowanceAtCapture = prompt.allowanceAtCapture != null ? prompt.allowanceAtCapture : summary(st.events, st.settings, month).allowance;
  const saved = appendEvent({type: 'purchase', source: 'wallet', month,
    amount: transit.sekMinor / 100, currency: 'SEK', merchant: 'SL', merchantUnavailable: false, card: prompt.card || '',
    sekMinor: transit.sekMinor, amountUnavailable: false, pendingReason: null, duplicateOf: null, reviewed: false,
    allowanceAtCapture, slPromptOf: prompt.id, ...transit}, prompt.createdAt);
  debugLog('sl_prompt_confirmed', {promptId, result: {id: saved.id, sekMinor: transit.sekMinor,
    slTransfer: !!transit.slTransferOf, originalTapAt: prompt.createdAt}});
  await dismissSlPrompt(promptId);
  await notify('SL tap logged', transit.slTransferOf ? 'Transfer inside the existing 75-minute window. No additional fare deducted.' :
    money(transit.sekMinor) + ' estimated for a new 75-minute SL ticket.');
}
async function handleURLAction(q) {
  const action = q && q.wcAction;
  if (!action) return false;
  if (!['sl-yes', 'sl-no', 'sl-open'].includes(action)) throw new Error('Unknown Wallet Counter action.');
  await handleSlPrompt(q.prompt, action.slice(3));
  return true;
}
async function message(title, body) {
  const a = new Alert(); a.title = title; a.message = body; a.addAction('OK'); await a.presentAlert();
}
async function choice(title, body, labels) {
  const a = new Alert(); a.title = title; a.message = body;
  labels.forEach(x => a.addAction(x)); a.addCancelAction('Cancel'); return await a.presentSheet();
}
async function ask(title, body, fields) {
  const a = new Alert(); a.title = title; a.message = body;
  fields.forEach(f => a.addTextField(f[0], f[1] || ''));
  a.addAction('Save'); a.addCancelAction('Cancel');
  if (await a.presentAlert() < 0) return null;
  return fields.map((_,i) => a.textFieldValue(i));
}

// ECB quotes are foreign units per SEK; invert to obtain SEK per foreign unit.
const FX_URL = 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=SEK';
const fxPath = fm.joinPath(root, 'fx-cache.json');
const FX_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
function usableRate(row, now = Date.now()) {
  if (!row || typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate <= 0 || row.rate > 1e9 ||
      typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return false;
  const date = Date.parse(row.date + 'T00:00:00Z');
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === row.date &&
    date <= now + 86400000 && now - date <= FX_MAX_AGE;
}
function fxRead() {
  try {
    const c = JSON.parse(fm.readString(fxPath));
    return c.schema === 1 && c.rates && typeof c.rates === 'object' ? c : null;
  } catch (_) { return null; }
}
async function fxRefresh() {
  const req = new Request(FX_URL); req.timeoutInterval = 5;
  const rows = await req.loadJSON();
  if (!req.response || req.response.statusCode !== 200 || !Array.isArray(rows)) throw new Error('Exchange-rate service unavailable.');
  const rates = {};
  for (const row of rows) {
    if (row.base !== 'SEK' || typeof row.quote !== 'string' || !/^[A-Z]{3}$/.test(row.quote) || !usableRate(row)) continue;
    rates[row.quote] = {rate: 1 / row.rate, date: row.date};
  }
  if (!Object.keys(rates).length) throw new Error('No recent valid ECB rates received.');
  const cache = {schema: 1, fetchedAt: new Date().toISOString(), rates};
  ensureStorage(); writeJSON(fxPath, cache); return cache;
}
async function fxEstimate(currency, amount) {
  let cache = fxRead();
  const fetched = cache ? Date.parse(cache.fetchedAt) : NaN;
  const warm = Number.isFinite(fetched) && Date.now() >= fetched && Date.now() - fetched < 12 * 60 * 60 * 1000;
  let cached = true;
  if (!warm || !usableRate(cache && cache.rates[currency])) {
    try { cache = await fxRefresh(); cached = false; }
    catch (e) { console.log('Exchange-rate refresh unavailable: ' + e.message); }
  }
  const row = cache && cache.rates[currency];
  if (!usableRate(row)) return null;
  const sekMinor = minor(amount * row.rate);
  if (sekMinor <= 0) return null;
  return {sekMinor, fxEstimated: true, fx: {provider: 'ECB via Frankfurter', rate: row.rate, rateDate: row.date, cached}};
}

async function capture(raw) {
  const rawDebug = debugInput(raw);
  try {
    if (emptyWalletCapture(raw)) {
      const v = rawDictionary(raw) || {}, state = current();
      const prompt = appendEvent({type: 'sl_prompt', source: 'wallet', month: monthKey(), allowanceAtCapture: state.sum.allowance,
        card: typeof v.card === 'string' ? v.card.slice(0, 100) : ''});
      debugLog('capture_sl_prompt', {input: rawDebug, promptId: prompt.id});
      const delivered = await slPromptNotification(prompt);
      const text = delivered ? 'Wallet supplied no purchase details. Asked whether this was an SL tap; no spending deducted yet.' :
        'Wallet supplied no purchase details. No spending was deducted, but the SL confirmation notification could not be delivered.';
      Script.setShortcutOutput(text); return;
    }
    const input = normalizeInput(raw);
    if (input.action === 'test') {
      ensureStorage();
      writeJSON(fm.joinPath(root, 'last-capture-test.json'), {...input, observedAt: new Date().toISOString()});
      debugLog('capture_test', {input: rawDebug, normalized: {amount: input.amount, currency: input.currency,
        merchant: input.merchant, merchantUnavailable: input.merchantUnavailable, sl: input.sl}});
      const text = (input.sl ? 'SL fare estimate' : input.amount + ' ' + input.currency + ' at ' + input.merchant) + '. TEST ONLY: no spending added.';
      await notify('Wallet capture test passed', text);
      Script.setShortcutOutput(text); return;
    }
    const state = current(), now = new Date();
    const transactions = materialize(state.events);
    const transit = input.sl ? slFare(transactions, now, state.settings.slFareMinor || 4300) : null;
    const amountUnavailable = !input.sl && input.amount === 0;
    const dup = input.sl ? null : duplicateOf(transactions, input, now);
    const saved = appendEvent({type: 'purchase', source: 'wallet', month: monthKey(now),
      amount: transit ? transit.sekMinor / 100 : input.amount, currency: input.currency, merchant: input.merchant, merchantUnavailable: input.merchantUnavailable, card: input.card,
      sekMinor: !amountUnavailable && input.currency === 'SEK' ? minor(input.amount) : null,
      amountUnavailable, pendingReason: amountUnavailable ? 'wallet_zero_amount' : null,
      duplicateOf: dup ? dup.id : null, reviewed: false, allowanceAtCapture: state.sum.allowance,
      ...(transit || {})});
    // Save the purchase before requesting rates. A network failure cannot lose it.
    let estimate = null;
    if (!input.sl && !amountUnavailable && input.currency !== 'SEK') {
      try {
        estimate = await fxEstimate(input.currency, input.amount);
        if (estimate) appendEvent({type: 'conversion', target: saved.id, ...estimate});
      } catch (e) { estimate = null; console.log('Conversion not applied: ' + e.message); }
    }
    const after = current().sum;
    debugLog('capture_saved', {input: rawDebug, normalized: {amount: input.amount, currency: input.currency,
      merchant: input.merchant, merchantUnavailable: input.merchantUnavailable, sl: input.sl},
      result: {id: saved.id, sekMinor: transit ? transit.sekMinor : saved.sekMinor, amountUnavailable,
        slTransfer: !!(transit && transit.slTransferOf), duplicate: !!dup, fxEstimated: !!estimate, remaining: after.remaining}});
    let text = after.remaining == null ? 'Saved. Open Wallet Counter to set your allowance.' : money(after.remaining) + ' remaining this month.';
    if (transit) text += transit.slTransferOf ? ' SL transfer: no additional fare; the original 75-minute window is unchanged.' : ' SL estimated: ' + money(transit.sekMinor) + ' deducted for a new 75-minute ticket.';
    else if (amountUnavailable) text += ' Wallet supplied a zero amount. Tap saved for review; no spending deducted. Set the actual SEK charge in Recent purchases, or undo this tap if it did not create a separate charge.';
    else if (estimate) text += ' ' + input.amount + ' ' + input.currency + ' deducted as approximately ' + money(estimate.sekMinor) + ' (ECB ' + estimate.fx.rateDate + ').';
    else if (input.currency !== 'SEK') text += ' No usable rate: convert ' + input.amount + ' ' + input.currency + ' in Recent purchases; it is not yet deducted.';
    if (input.merchantUnavailable) text += ' Wallet supplied no merchant name; saved as Unknown merchant.';
    if (dup) text += ' Possible duplicate: both purchases remain counted until reviewed.';
    if (state.settings.notifications || amountUnavailable || input.currency !== 'SEK' || dup) await notify(amountUnavailable ? 'Wallet tap needs review' : 'Wallet Counter', text);
    Script.setShortcutOutput(text);
  } catch (e) {
    debugLog('capture_failed', {input: rawDebug, error: {message: e.message,
      stack: typeof e.stack === 'string' ? e.stack.split('\n').slice(0, 3).join(' | ').slice(0, 600) : ''}});
    throw e;
  }
}

async function setAllowance(firstRun = false) {
  const st = current();
  const v = await ask('Monthly allowance', 'Enter your monthly limit in SEK. No money is moved.',
    [['Allowance in SEK', st.sum.allowance == null ? '' : String(st.sum.allowance / 100)]]);
  if (!v) return;
  const amount = minor(parseAmount(v[0]));
  const selection = firstRun ? 0 : await choice('Apply allowance', 'Previous months keep their targets.',
    ['This month and future months', 'Next month onward']);
  if (selection < 0) return;
  const s = st.settings;
  // Pin current month before changing the future default.
  if (st.sum.allowance != null) s.months[monthKey()] = st.sum.allowance;
  s.monthlyDefault = amount;
  if (selection === 0) s.months[monthKey()] = amount;
  settingsSave(s);
}
async function manualEntry(refund = false) {
  const v = await ask(refund ? 'Add refund' : 'Add purchase', 'Amount is in SEK. Applied to the current month.',
    [['Amount in SEK', ''], ['Merchant / note', '']]);
  if (!v) return;
  const amount = parseAmount(v[0]), st = current();
  appendEvent({type: refund ? 'refund' : 'purchase', source: 'manual', month: monthKey(),
    amount, currency: 'SEK', sekMinor: minor(amount), merchant: v[1].trim() || 'Manual entry',
    card: '', allowanceAtCapture: st.sum.allowance});
}
async function recent() {
  const st = current();
  const tx = materialize(st.events).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25);
  if (!tx.length) { await message('No purchases yet', 'Test captures do not count as spending.'); return; }
  const labels = tx.map(t => (t.sekMinor == null ? '⚠ ' : t.fxEstimated || t.slEstimated ? '≈ ' : '') + t.merchant + ' · ' +
    (t.sekMinor == null ? t.amountUnavailable ? 'Amount unavailable' : t.amount + ' ' + t.currency : money(t.sekMinor)) +
    (t.slTransferOf ? ' · transfer' : t.slEstimated ? ' · SL estimated' : '') + (t.duplicateOf && !t.reviewed ? ' · CHECK' : ''));
  const i = await choice('Recent purchases', 'Newest first. Export includes your full history.', labels);
  if (i < 0) return;
  const t = tx[i];
  const action = await choice(t.merchant, t.createdAt + '\n' + (t.amountUnavailable ? 'Wallet reported zero; final charge unavailable.' : t.amount + ' ' + t.currency) + '\nMonth: ' + t.month +
    (t.slTransferOf ? '\nSL transfer linked to ticket ' + t.slTransferOf + '; original window unchanged.' : t.slEstimated ? '\nSL estimated fare; 75 minutes from this tap. Wallet amount ignored.' : '') +
    (t.fxEstimated ? '\nEstimated with ' + t.fx.provider + ': ' + t.fx.rate + ' SEK per unit, dated ' + t.fx.rateDate : ''),
    ['Set / correct SEK amount', 'Keep and mark reviewed', 'Undo this entry']);
  if (action === 0) {
    const v = await ask('SEK amount', 'Enter the total SEK value, not an exchange rate.',
      [['Amount in SEK', t.sekMinor == null ? '' : String(t.sekMinor / 100)]]);
    if (v) appendEvent({type: 'conversion', target: t.id, sekMinor: minor(parseAmount(v[0])), fxEstimated: false});
  } else if (action === 1) appendEvent({type: 'review', target: t.id});
  else if (action === 2) {
    if (await choice('Undo entry?', 'Removes it from the counter. The audit record stays in the export.', ['Undo']) === 0)
      appendEvent({type: 'void', target: t.id});
  }
}
async function history() {
  const st = current();
  const months = [...new Set([monthKey(), ...Object.keys(st.settings.months), ...st.events.map(e => e.month).filter(Boolean)])].sort().reverse();
  const text = months.map(m => {
    const s = summary(st.events, st.settings, m);
    return m + ': ' + money(s.spent) + ' spent / ' + (s.allowance == null ? 'no target recorded' : money(s.allowance)) +
      (s.unresolved ? ' · ' + s.unresolved + ' to review' : '');
  }).join('\n');
  await message('Monthly history', text);
}
async function exportData() {
  const st = current();
  const file = fm.joinPath(fm.temporaryDirectory(), 'WalletCounter-export-' + monthKey() + '.json');
  fm.writeString(file, JSON.stringify({version: VERSION, exportedAt: new Date().toISOString(), settings: st.settings, events: st.events}, null, 2));
  await ShareSheet.present([file]);
}
async function debugMenu() {
  const lines = debugLines();
  const i = await choice('Debug log · v' + VERSION, lines.length + ' local entries. Raw Wallet fields are logged only for troubleshooting.',
    ['View recent', 'Share / copy full log', 'Clear log']);
  if (i === 0) {
    await message('Recent debug log · v' + VERSION, lines.length ? lines.slice(-8).join('\n\n') : 'No entries yet. Make a Wallet purchase and check again.');
  } else if (i === 1) {
    const file = fm.joinPath(fm.temporaryDirectory(), 'WalletCounter-debug-' + monthKey() + '.txt');
    fm.writeString(file, 'Wallet Counter v' + VERSION + '\nGenerated ' + new Date().toISOString() + '\n\n' + (lines.join('\n') || 'No debug entries yet.') + '\n');
    await ShareSheet.present([file]);
  } else if (i === 2 && await choice('Clear debug log?', 'Purchase history is not affected.', ['Clear']) === 0) {
    ensureStorage(); fm.writeString(debugPath, '');
  }
}

async function widget() {
  const st = current(), s = st.sum;
  const w = new ListWidget(); w.backgroundColor = new Color('10221E'); w.setPadding(16,16,16,16);
  w.url = 'scriptable:///run?scriptName=' + encodeURIComponent(Script.name());
  function line(text, size, color, bold = false) {
    const t = w.addText(text); t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
    t.textColor = new Color(color); t.minimumScaleFactor = 0.6; t.lineLimit = 1; return t;
  }
  line('SPENDING · ' + monthKey(), 11, 'A4C8BA', true); w.addSpacer(8);
  line(s.remaining == null ? 'Set allowance' : money(s.remaining), config.widgetFamily === 'small' ? 25 : 32,
    s.remaining != null && s.remaining < 0 ? 'FF9F9F' : 'E9FFF4', true);
  line(s.remaining == null ? 'Tap to get started' : s.unresolved ? 'Estimated remaining · review needed' : s.estimated ? 'Remaining · includes estimates' : 'Remaining this month', 11, 'A4C8BA');
  w.addSpacer(10);
  if (s.allowance != null) {
    const width = config.widgetFamily === 'small' ? 115 : 270;
    const d = new DrawContext(); d.size = new Size(width, 6); d.opaque = false;
    d.setFillColor(new Color('294C40')); d.fillRect(new Rect(0,0,width,6));
    const portion = Math.max(0, Math.min(1, s.remaining / s.allowance));
    d.setFillColor(new Color(s.remaining < 0 ? 'FF9F9F' : '78DDB0')); d.fillRect(new Rect(0,0,width*portion,6));
    w.addImage(d.getImage()); w.addSpacer(5);
    line(money(s.spent) + ' spent of ' + money(s.allowance), 10, 'A4C8BA');
  }
  w.addSpacer();
  if (s.unresolved) line(s.unresolved + ' entries need review', 10, 'FFD88A', true);
  const dt = new Intl.DateTimeFormat('en-GB', {timeZone: ZONE, hour:'2-digit', minute:'2-digit'}).format(new Date());
  line('Rendered ' + dt + ' · tap to manage', 9, '87A99B');
  w.refreshAfterDate = new Date(Date.now() + 15*60*1000);
  return w;
}
async function menu() {
  if (settingsRead().monthlyDefault == null) await setAllowance(true);
  const st = current();
  const title = st.sum.remaining == null ? 'Wallet Counter' : money(st.sum.remaining) + ' remaining';
  const i = await choice(title, 'v' + VERSION + ' · Monthly SEK allowance · resets on the 1st · no rollover',
    ['Preview widget', 'Change allowance', 'Add purchase / opening spend', 'Add refund', 'Recent purchases / corrections',
      'Monthly history', 'Export backup', 'Debug log', 'Toggle purchase notifications', 'View capture test', 'Refresh exchange rates', 'Check for updates', 'Restore previous version', 'Change SL fare']);
  if (i === 0) await (await widget()).presentMedium();
  else if (i === 1) await setAllowance();
  else if (i === 2) await manualEntry();
  else if (i === 3) await manualEntry(true);
  else if (i === 4) await recent();
  else if (i === 5) await history();
  else if (i === 6) await exportData();
  else if (i === 7) await debugMenu();
  else if (i === 8) { const s = st.settings; s.notifications = !s.notifications; settingsSave(s); await message('Notifications', s.notifications ? 'Enabled.' : 'Normal capture notifications disabled. Review warnings remain enabled.'); }
  else if (i === 9) {
    const path = fm.joinPath(root, 'last-capture-test.json');
    await message('Capture test', fm.fileExists(path) ? fm.readString(path) : 'No test captured. Use action=test in the Wallet automation.');
  } else if (i === 10) {
    try {
      const c = await fxRefresh();
      await message('Exchange rates ready', Object.keys(c.rates).length + ' currencies cached. EUR/GBP/USD ready: ' + ['EUR','GBP','USD'].filter(x => usableRate(c.rates[x])).join(', ') + '.\nDaily ECB estimates, not your card settlement rate. Offline rates expire after 7 days.');
    } catch (e) { await message('Exchange rates unavailable', e.message + '\nExisting purchases are unchanged. Try again while online.'); }
  }
  else if (i === 11 && updateController) await updateController.check();
  else if (i === 12 && updateController) await updateController.rollback();
  else if (i === 13) {
    const v = await ask('SL estimated fare', 'One card/device. Applies to new 75-minute tickets; existing entries stay unchanged.',
      [['Fare in SEK', String((st.settings.slFareMinor || 4300) / 100)]]);
    if (v) { const s = st.settings; s.slFareMinor = minor(parseAmount(v[0])); settingsSave(s); }
  }
}

async function main() {
  try {
    if (config.runsInWidget) { Script.setWidget(await widget()); }
    else if (args.shortcutParameter != null) await capture(args.shortcutParameter);
    else if (await handleURLAction(args.queryParameters || {})) {}
    else if (config.runsInApp) await menu();
    else throw new Error('No Shortcut input. Open the script in Scriptable for setup.');
  } catch (e) {
    const text = 'Check Wallet Counter: ' + e.message + ' Open Wallet Counter → Debug log for details.';
    if (config.runsInWidget) {
      const w = new ListWidget(); w.addText('Wallet Counter needs attention'); w.addText(e.message);
      w.url = 'scriptable:///run?scriptName=' + encodeURIComponent(Script.name()); Script.setWidget(w);
    } else if (config.runsInApp && args.shortcutParameter == null) await message('Wallet Counter error', text);
    else { await notify('Purchase not confirmed', text); Script.setShortcutOutput(text); throw e; }
  } finally { Script.complete(); }
}
module.exports = {version: VERSION, run: async controller => { updateController = controller; await main(); }};
