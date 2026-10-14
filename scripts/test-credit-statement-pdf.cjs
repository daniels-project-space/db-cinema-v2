const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),cp=require('node:child_process'),h=require('./lib/rentalTestHarness.cjs');
(async()=>{
 const renderer=await import('@react-pdf/renderer'),m={exports:{}};const code=ts.transpileModule(fs.readFileSync('src/lib/invoice/CreditStatementDocument.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)(name=>name==='@react-pdf/renderer'?renderer:require(name),m,m.exports);
 const account=h.put('accounts',{email:'credit-statement@example.invalid',name:'Credit Fixture'});h.put('sessions',{token:'credit-owner',accountId:account._id,expiresAt:Date.now()+86400000});const row=h.put('credits',{accountId:account._id,amount:10,remaining:10,currency:'GBP',reason:'Administrator test credit',createdAt:Date.UTC(2026,9,13),expiresAt:Date.UTC(2027,9,13),status:'active'});
 const data=await h.load('convex/accountCredits.ts').statement.handler({db:h.db},{token:'credit-owner',creditId:row._id});
 const pdf=await renderer.renderToBuffer(m.exports.CreditStatementDocument({data}));const path='/tmp/db-credit-statement-fixture.pdf';fs.writeFileSync(path,pdf);const text=cp.execFileSync('pdftotext',[path,'-'],{encoding:'utf8'});
 for(const expected of ['Account credit receipt','£10.00','13 October 2027','not a card payment or cash refund','non-refundable','Credit Fixture'])assert(text.includes(expected),expected);
 assert(!text.includes('Payment received'));assert(!text.includes('Total paid'));
 console.log('PASS actual credit statement query → real PDF renderer: owned source amount and expiry, £10 receipt, correct non-cash wording and no invented bank payment. Synthetic ledger only.');
})().catch(e=>{console.error(e);process.exitCode=1});
