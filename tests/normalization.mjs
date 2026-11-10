import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

test('native form CRLF produces the same receipt hash as textarea LF',()=>{
  const context=createContext({Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_algorithm,text)=>Array.from(createHash('sha256').update(text).digest())}});
  runInContext(readFileSync(new URL('../apps-script/コード.js',import.meta.url),'utf8'),context);
  context.transport={kind:'講座申し込み',slot:'',name:'改行テスト',kana:'かいぎょうてすと',email:'test@example.com',phone:'00000000000',business:'制作\r\n相談',message:'一行目\r\n二行目',attendance:'まだ分からない',payment:'銀行振込',confirmed:'on'};
  const expected=['講座申し込み','','改行テスト','かいぎょうてすと','test@example.com','00000000000','制作\n相談','一行目\n二行目','まだ分からない','銀行振込','on'];
  const browserHash=createHash('sha256').update(JSON.stringify(expected)).digest('hex');
  assert.equal(runInContext('fingerprint_(normalize_(transport))',context),browserHash);
});
