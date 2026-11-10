import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const context=createContext({});
runInContext(readFileSync(new URL('../apps-script/コード.js',import.meta.url),'utf8'),context);
const base={kind:'個別相談',slot:'2099-11-20T13:30',name:'テスト',kana:'てすと',email:'test@example.com',phone:'00000000000',business:'日時検証',message:'',attendance:'まだ分からない',payment:'',confirmed:'on'};
const validate=slot=>{context.input={...base,slot};return runInContext('validationCode_(normalize_(input))',context)};

test('applicant-entered future datetime is accepted without a configured slot',()=>{
  assert.equal(validate('2099-11-20T13:30'),'');
  assert.equal(runInContext('normalize_(input).slot',context),'2099-11-20 13:30');
  assert.equal(validate('2099-11-20 13:30'),'');
  assert.equal(validate('2096-02-29T09:00'),'');
});
test('missing, past and impossible dates are rejected',()=>{
  for(const value of ['', '2026-11-01T12:00','2099-02-29T12:00','2099-02-30T12:00','2099-13-01T12:00','2099-11-20T24:00','2099-11-20T13:60','2099-11-20','=1+1'])assert.equal(validate(value),'SLOT_UNAVAILABLE',value);
});
test('course application does not require or retain a consultation date',()=>{
  context.input={...base,kind:'講座申し込み',slot:'2099-11-20T13:30'};
  assert.equal(runInContext('validationCode_(normalize_(input))',context),'');
  assert.equal(runInContext('normalize_(input).slot',context),'');
});
