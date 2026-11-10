function prepareTestSheet() {
  if (SHEET_NAME !== '動作確認_20261110') throw Error('TEST_ONLY');
  const book=SpreadsheetApp.openById(SHEET_ID);
  let sheet=book.getSheetByName(SHEET_NAME);
  if(!sheet){sheet=book.insertSheet(SHEET_NAME);sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);sheet.setFrozenRows(1);}
  console.log('TEST_SHEET_READY: '+sheet.getSheetId());
}
function runIntegrationTests() {
  if (SHEET_NAME !== '動作確認_20261110') throw Error('TEST_ONLY');
  prepareTestSheet();
  const sheet=sheet_();
  const start=sheet.getLastRow();
  const base={kind:'講座申し込み',slot:'',name:'動作確認テスト_申込ではありません',kana:'どうさかくにんてすと',email:'labplus-test@example.com',phone:'00000000000',business:'機能テスト '+Utilities.getUuid(),message:'テストデータ。請求・案内不要。',attendance:'まだ分からない',payment:'',confirmed:'on',request_id:Utilities.getUuid(),attempt:Utilities.getUuid()};
  const post=p=>JSON.parse(doPost({parameter:p}).getContent());
  const assert=(ok,name)=>{if(!ok)throw Error('FAIL: '+name);console.log('PASS: '+name)};
  assert(post(base).ok,'course + optional payment');
  assert(post(base).ok && sheet.getLastRow()===start+1,'same ID no duplicate');
  const duplicate={...base,request_id:Utilities.getUuid()};
  assert(post(duplicate).ok && sheet.getLastRow()===start+1,'same contents/new ID no duplicate');
  assert(post({...base,name:'変更された内容'}).code==='ID_CONFLICT' && sheet.getLastRow()===start+1,'ID conflict no write');
  const invalid={...base,request_id:Utilities.getUuid(),email:'invalid'};
  assert(post(invalid).state==='rejected' && sheet.getLastRow()===start+1,'invalid input no write');
  const consult={...base,request_id:Utilities.getUuid(),kind:'個別相談',slot:'2099-01-01 12:00',name:'個別相談_動作確認テスト',payment:'銀行振込'};
  assert(post(consult).ok && sheet.getLastRow()===start+2,'consultation all fields');
  assert(post({...consult,request_id:Utilities.getUuid(),slot:'2026-11-01 12:00'}).code==='SLOT_UNAVAILABLE' && sheet.getLastRow()===start+2,'past slot no write');
  const formula={...base,request_id:Utilities.getUuid(),name:'=1+1',phone:'+810000000000',message:'@test',business:'formula safety test'};
  assert(post(formula).ok,'formula-like strings saved as text');
  const result=receipt_(sheet,base.request_id,fingerprint_(normalize_(base)));
  assert(result.ok,'receipt from actual saved row');
  console.log(JSON.stringify({result:'ALL_PASS',addedRows:sheet.getLastRow()-start,courseId:base.request_id,consultId:consult.request_id}));
}
