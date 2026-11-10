'use strict';
const form=document.querySelector('#form');
const consult=document.querySelector('#consult');
const slot=document.querySelector('#slot');
const status=document.querySelector('#status');
const submit=document.querySelector('#submit');
const retry=document.querySelector('#retry');
const reference=document.querySelector('#receipt-reference');
const endpoint='https://script.google.com/macros/s/AKfycbwBc9W3sUDxezuVm9Vhyh1JsSDx6wg1kyJhbAs0zrnYA-ryUJ6Yj7kvp2fKBy5wSSzI/exec';
const fields=['kind','slot','name','kana','email','phone','business','message','attendance','payment','confirmed'];
let state='idle', request=null, snapshot=null, timer, poll, checking=false, configured=false, slots=[];
const frame=document.createElement('iframe');
frame.name='labplus-receiver';frame.hidden=true;document.body.append(frame);
const uuid=()=>crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c)/4).toString(16));
const pendingScripts=new Set();
function loadScript(query) {
  const script=document.createElement('script');
  const cleanup=()=>{clearTimeout(expiry);script.remove();pendingScripts.delete(script)};
  const expiry=setTimeout(cleanup,15000);
  script.onload=script.onerror=cleanup;
  script.src=endpoint+'?'+new URLSearchParams({...query,t:String(Date.now())});
  pendingScripts.add(script);document.body.append(script);
}
function updateConsult() {
  const isConsult=form.elements.kind.value==='個別相談';
  consult.classList.toggle('hidden',!isConsult);
  slot.required=isConsult;slot.disabled=state!=='idle' || !slots.length;
  if(!isConsult)slot.value='';
  if(state==='idle')submit.disabled=isConsult && (!configured || !slots.length);
}
window.labplusConfigure=data=>{
  if(!data || !Array.isArray(data.slots))return;
  slots=data.slots.filter(value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value) && Date.parse(value.replace(' ','T')+':00+09:00')>Date.now());
  slot.replaceChildren(new Option('希望日時を選択してください',''));
  for(const value of slots)slot.add(new Option(value.replace(/^(\d{4})-(\d{2})-(\d{2}) /,'$1年$2月$3日 '),value));
  configured=true;
  document.querySelector('#consult-help').textContent=slots.length ? '開始時刻をお選びください。日時は日本時間です。受付後、詳細をご案内します。' : '現在、個別相談の受付日時は未定です。日時が決まり次第、こちらに表示します。';
  updateConsult();
};
form.addEventListener('change',updateConsult);
function lockFields(locked) {
  for(const el of form.querySelectorAll('input,select,textarea'))el.disabled=locked;
  if(!locked)updateConsult();
}
function stopChecking() {
  clearTimeout(timer);clearInterval(poll);checking=false;
  pendingScripts.forEach(s=>s.remove());pendingScripts.clear();
}
function remember() {
  try{localStorage.setItem('labplus-request:'+request.fingerprint,JSON.stringify({id:request.id,state}))}catch(_){}
}
function unknown() {
  stopChecking();state='unknown';remember();
  status.textContent='受付結果を確認できませんでした。保存済みの可能性があります。まず「受付状況を再確認する」を押してください。再試行する場合も同じ受付番号で処理し、二重登録を防ぎます。確認できない場合は、受付番号を添えて公式LINEへお問い合わせください。';
  submit.textContent='受付状況を再確認する';submit.disabled=false;retry.hidden=false;
}
function checkReceipt() {
  if(!request || state==='saved')return;
  loadScript({id:request.id,fingerprint:request.fingerprint,attempt:request.attempt});
}
function startChecking() {
  stopChecking();checking=true;submit.disabled=true;retry.hidden=true;
  poll=setInterval(checkReceipt,3000);timer=setTimeout(unknown,30000);
  checkReceipt();
}
window.labplusReceive=data=>{
  if(!request || !data || data.id!==request.id || state==='saved')return;
  if(data.ok===true && data.state==='saved'){
    stopChecking();state='saved';remember();lockFields(true);
    status.textContent='お申し込みを受け付けました。\nありがとうございます。\nご入力いただいたメールアドレスへ、後日ご案内いたします。';
    reference.textContent='受付番号：'+(data.receipt_id || request.id);
    submit.hidden=true;retry.hidden=true;
    status.scrollIntoView({behavior:'smooth',block:'center'});
  }else if(data.state==='rejected' && (data.attempt===request.attempt || data.code==='ID_CONFLICT')){
    stopChecking();state='idle';remember();lockFields(false);retry.hidden=true;
    status.textContent=data.code==='SLOT_UNAVAILABLE' ? '選択された個別相談日時は現在受付していません。受付可能な日時をご確認ください。' : data.code==='ID_CONFLICT' ? '受付番号と申込内容が一致しません。受付番号を添えて公式LINEへお問い合わせください。' : '入力内容を確認できなかったため保存されませんでした。必須項目・メールアドレス・確認事項への同意をご確認ください。';
    submit.textContent='入力内容を送信する';updateConsult();
    if(data.code==='ID_CONFLICT')submit.disabled=true;
  }
};
function sendSnapshot() {
  state='sending';request.attempt=uuid();remember();lockFields(true);
  status.textContent='送信中です。画面を閉じずにお待ちください。';
  reference.hidden=false;reference.textContent='受付番号：'+request.id;
  // 固定した入力内容を送る。送信中・結果不明の間は変更や別IDでの再送を行わない。
  const transport=document.createElement('form');
  transport.hidden=true;transport.method='POST';transport.action=endpoint;transport.target=frame.name;
  for(const [name,value] of Object.entries({...snapshot,request_id:request.id,attempt:request.attempt})){
    const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;transport.append(input);
  }
  document.body.append(transport);
  startChecking();
  try{HTMLFormElement.prototype.submit.call(transport)}catch(_){unknown()}
  setTimeout(()=>transport.remove(),0);
}
form.addEventListener('submit',async e=>{
  e.preventDefault();
  if(checking || state==='sending' || state==='preparing' || state==='saved')return;
  if(state==='unknown'){
    status.textContent='受付状況を再確認しています。追加の申込データは送信していません。';startChecking();return;
  }
  for(const el of form.querySelectorAll('input[required]:not([type=radio]):not([type=checkbox]),textarea[required]'))el.value=el.value.trim();
  if(!form.reportValidity())return;
  if(form.elements.kind.value==='個別相談' && (!configured || !slots.includes(slot.value)))return;
  state='preparing';submit.disabled=true;
  try{
    const data=new FormData(form);
    snapshot=Object.fromEntries(fields.map(k=>[k,String(data.get(k)||'').replace(/\r\n?/g,'\n').trim()]));
    if(snapshot.kind!=='個別相談')snapshot.slot='';
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(fields.map(k=>snapshot[k]))));
    const fingerprint=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    let previous;
    try{previous=JSON.parse(localStorage.getItem('labplus-request:'+fingerprint))}catch(_){}
    request={id:previous && /^[0-9a-f-]{36}$/.test(previous.id) ? previous.id : uuid(),fingerprint,attempt:uuid()};
    if(previous && ['sending','unknown','saved'].includes(previous.state)){
      state='unknown';lockFields(true);reference.hidden=false;reference.textContent='受付番号：'+request.id;
      status.textContent='同じ入力内容の受付状況を確認しています。';startChecking();
    }else sendSnapshot();
  }catch(_){state='idle';updateConsult();status.textContent='送信の準備ができませんでした。入力内容は送信されていません。ブラウザを更新してからお試しください。'}
});
retry.addEventListener('click',()=>{if(state==='unknown' && !checking && request && snapshot)sendSnapshot()});
loadScript({action:'config'});
updateConsult();
setTimeout(()=>{if(!configured)document.querySelector('#consult-help').textContent='現在、個別相談の受付日時を確認できません。時間をおいて再度お試しください。'},15000);
