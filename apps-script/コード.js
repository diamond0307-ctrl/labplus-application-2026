const SHEET_ID = '1n57ImnsYXWICTWysdUlrIO84_H-XSVoy8XR3lKDRf40';
const SHEET_NAME = '受付一覧';
const FIELDS = ['kind','slot','name','kana','email','phone','business','message','attendance','payment','confirmed'];
const HEADERS = ['受付日時','受付内容','お名前','ふりがな','メールアドレス','電話番号','事業内容','相談内容・質問','相談希望日時','初回参加','支払方法','審査状況','書類送付状況','確認事項への同意','リクエストID','申込内容ハッシュ'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

// 希望日時は申込者が入力する。日本時間の実在する未来の日時のみ受け付ける。
function validConsultationDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return false;
  const time = Date.parse(value.replace(' ', 'T') + ':00+09:00');
  return Number.isFinite(time) && time > Date.now() && new Date(time + 9*60*60*1000).toISOString().slice(0,16).replace('T',' ') === value;
}
function jsonp_(callback, data) {
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(data).replace(/</g,'\\u003c') + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function sheet_() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw Error('SHEET_MISSING');
  const headers = sheet.getRange(1,1,1,HEADERS.length).getDisplayValues()[0];
  if (HEADERS.slice(0,13).some((h,i) => headers[i] !== h)) throw Error('HEADER_MISMATCH');
  // 既存13列を維持。追加予定の3列に別データがあれば上書きせず停止する。
  if (headers.slice(13).some((h,i) => h && h !== HEADERS[i+13])) throw Error('HEADER_MISMATCH');
  return sheet;
}
function prepareColumns_(sheet) {
  if (sheet.getLastRow() > 1) {
    const values = sheet.getRange(1,14,sheet.getLastRow(),3).getDisplayValues();
    for (let c=0;c<3;c++) if (!values[0][c] && values.slice(1).some(r => r[c])) throw Error('HEADER_MISMATCH');
  }
  sheet.getRange(1,14,1,3).setValues([HEADERS.slice(13)]);
}
function findRow_(sheet,column,value) {
  if (!value || sheet.getLastRow()<2) return 0;
  const match = sheet.getRange(2,column,sheet.getLastRow()-1,1).createTextFinder(value).matchEntireCell(true).matchCase(true).useRegularExpression(false).findNext();
  return match ? match.getRow() : 0;
}
function receipt_(sheet,id,hash) {
  const byId = findRow_(sheet,15,id);
  if (byId && hash && sheet.getRange(byId,16).getDisplayValue() !== hash) return {id,ok:false,state:'rejected',code:'ID_CONFLICT'};
  const row = byId || (hash && findRow_(sheet,16,hash));
  if (!row) return {id,ok:false,state:'pending'};
  const values = sheet.getRange(row,1,1,16).getDisplayValues()[0];
  if (!values[0] || !values[14] || !HASH.test(values[15]) || values[13] !== '同意済み') throw Error('INCOMPLETE_ROW');
  return {id,ok:true,state:'saved',receipt_id:values[14]};
}
function cacheKey_(id) { return 'labplus:' + SHEET_NAME + ':' + id; }
function doGet(e) {
  const p = e && e.parameter || {};
  if (p.action === 'config') return jsonp_('labplusConfigure',{slots:[],mode:'manual'});
  const id = UUID.test(p.id || '') ? p.id : '';
  if (!id) return jsonp_('labplusReceive',{id:'',ok:false,state:'rejected',code:'INVALID_ID'});
  try {
    const result = receipt_(sheet_(),id,HASH.test(p.fingerprint || '') ? p.fingerprint : '');
    if (result.state !== 'pending') return jsonp_('labplusReceive',result);
    const cached = CacheService.getScriptCache().get(cacheKey_(id));
    const failure = cached && JSON.parse(cached);
    return jsonp_('labplusReceive',failure && failure.attempt === p.attempt ? failure : result);
  } catch (err) {
    console.error(JSON.stringify({id,stage:'receipt',code:'STORAGE_ERROR'}));
    return jsonp_('labplusReceive',{id,ok:false,state:'unknown',code:'STORAGE_ERROR'});
  }
}
function normalize_(p) {
  const data = {};
  FIELDS.forEach(k => data[k] = String(p[k] || '').replace(/\r\n?/g, '\n').trim());
  data.slot = data.kind === '個別相談' ? data.slot.replace('T',' ') : '';
  return data;
}
function fingerprint_(data) {
  const canonical = JSON.stringify(FIELDS.map(k => data[k]));
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,canonical,Utilities.Charset.UTF_8).map(b => ('0'+((b+256)%256).toString(16)).slice(-2)).join('');
}
function validationCode_(d) {
  if (['kind','name','kana','email','phone','business','attendance','confirmed'].some(k => !d[k]) || FIELDS.some(k => d[k].length > 2000)) return 'INVALID_FIELDS';
  if (!['講座申し込み','個別相談'].includes(d.kind) || !['参加できる','参加できない','まだ分からない'].includes(d.attendance) || !['','銀行振込','クレジットカード'].includes(d.payment) || d.confirmed !== 'on') return 'INVALID_FIELDS';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return 'INVALID_FIELDS';
  if (d.kind === '個別相談' && !validConsultationDate_(d.slot)) return 'SLOT_UNAVAILABLE';
  return '';
}
function doPost(e) {
  const p = e && e.parameter || {};
  const id = p.request_id || '';
  let lock, result;
  try {
    if (!UUID.test(id)) throw Error('INVALID_ID');
    const data = normalize_(p), hash = fingerprint_(data);
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const sheet = sheet_();
    // 同じID・内容の再試行は、相談日時が過ぎていても既存受付を返す。
    result = receipt_(sheet,id,hash);
    if (result.state === 'pending') {
      const code = validationCode_(data);
      if (code) {
        result = {id,ok:false,state:'rejected',code,attempt:p.attempt || ''};
      } else {
        prepareColumns_(sheet);
        const clean = v => /^[=+\-@]/.test(v) ? "'" + v : v;
        const row = [Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss'),data.kind,clean(data.name),clean(data.kana),clean(data.email),clean(data.phone),clean(data.business),clean(data.message),data.slot,data.attendance,data.payment,'未審査','未送付','同意済み',id,hash];
        const target = sheet.getRange(sheet.getLastRow()+1,1,1,row.length);
        target.setNumberFormat('@');
        // データ・同意・IDを同じ行へ一度に書く。別の完了フラグを保存根拠にしない。
        target.setValues([row]);
        SpreadsheetApp.flush();
        const saved = target.getDisplayValues()[0];
        const expected = row.map((v,i) => [2,3,4,5,6,7].includes(i) && v.startsWith("'") ? v.slice(1) : v);
        if (saved.some((v,i) => v !== expected[i])) throw Error('READBACK_MISMATCH');
        result = receipt_(sheet,id,hash);
      }
    }
    if (result.state === 'rejected') {
      result.attempt = p.attempt || '';
      CacheService.getScriptCache().put(cacheKey_(id),JSON.stringify(result),21600);
      console.warn(JSON.stringify({id,stage:'validation',code:result.code}));
    } else {
      CacheService.getScriptCache().remove(cacheKey_(id));
      console.info(JSON.stringify({id,stage:'saved',receipt_id:result.receipt_id}));
    }
  } catch (err) {
    // setValues/flush失敗時も書き込み済みの可能性がある。未保存と断定しない。
    result = {id:UUID.test(id) ? id : '',ok:false,state:'unknown',code:'STORAGE_ERROR'};
    console.error(JSON.stringify({id:result.id,stage:'submit',code:String(err.message || 'STORAGE_ERROR')}));
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
