/** Real handlers and durable document rendering. Fixtures only; no provider writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {load,db,put,tables,setMock}=require('./lib/rentalTestHarness.cjs');
const {AGREEMENTS,LEGAL_VERSION}=load('src/lib/legal.ts');
const contract=load('shared/rentalAgreement.ts');
const bookings=load('convex/bookings.ts');
process.env.ADMIN_TOKEN='agreement-owner-fixture';
const ctx={db,scheduler:{runAfter:async()=>{}}};
const day=Date.UTC(2030,5,1);
const item=put('listings',{title:'Camera fixture',active:true,depositAmount:200});
const args={customerEmail:'renter@agreement.invalid',customerName:'Original Renter',billingAddress:'Fixture billing address London',
 fulfilment:'pickup',deliveryFee:0,lineItems:[{listingId:item._id,title:item.title,start:day,end:day+86400000,qty:1,lineTotal:100,dailyRate:50}],
 subtotal:100,depositAmount:100,depositHoldAmount:0,total:200,expectedTotalDue:200,currency:'GBP',
 agreementName:'Original Renter',agreementDocs:AGREEMENTS.map(({kind,version})=>({kind,version})),
 agreementRequestId:'agreement-fixture-attempt-0001',securityHoldConsent:true,laterChargeConsent:true,pickupTime:'10:00',returnTime:'18:00'};
(async()=>{
 const count=()=>tables.get('bookings')?.length??0;
 assert.throws(()=>contract.assertCurrentAgreement(undefined,'pickup'),/sign/);
 assert.throws(()=>contract.assertCurrentAgreement({name:'Person',securityHoldConsent:true,laterChargeConsent:true,documents:args.agreementDocs.slice(1)},'pickup'),/current rental/);
 assert.throws(()=>contract.assertCurrentAgreement({name:'Person',securityHoldConsent:true,laterChargeConsent:true,documents:args.agreementDocs.map(d=>({...d,version:'stale'}))},'pickup'),/current rental/);
 assert.throws(()=>contract.assertCurrentAgreement({name:'Person',securityHoldConsent:true,laterChargeConsent:true,documents:[...args.agreementDocs,args.agreementDocs[0]]},'pickup'),/current rental/);
 assert.throws(()=>contract.assertCurrentAgreement({name:'Person',securityHoldConsent:true,laterChargeConsent:true,documents:args.agreementDocs},'delivery'),/current rental/);
 await assert.rejects(bookings.createPending.handler(ctx,{...args,agreementRequestId:undefined}),/acceptance attempt/);assert.equal(count(),0);
 const created=await bookings.createPending.handler(ctx,args),b=await db.get(created.bookingId);
 const saved=b.agreementSnapshot,signed=b.agreementSignedAt;
 assert.equal(count(),1);const snapshot=JSON.parse(saved);
 assert.equal(snapshot.version,LEGAL_VERSION);assert.equal(snapshot.particulars.total,200);
 assert.equal(snapshot.particulars.securityHold,0);assert.equal(snapshot.particulars.timeZone,'Europe/London');
 assert.equal(snapshot.particulars.serialConditionSchedule,'pending-agreed-handover');
 assert.match(snapshot.documents.find(d=>d.kind==='rental-agreement').text.sections.find(s=>s.h==='4. Loss & damage').p,/theft.*non-return/);
 const retry=await bookings.createPending.handler(ctx,args);assert.equal(retry.bookingId,b._id);assert.equal(retry.reused,true);assert.equal(count(),1);assert.equal(b.agreementSnapshot,saved);assert.equal(b.agreementSignedAt,signed);
 const reordered=Object.fromEntries(Object.entries(args).reverse());assert.equal((await bookings.createPending.handler(ctx,reordered)).bookingId,b._id,'object key order cannot create another obligation');
 await assert.rejects(bookings.createPending.handler(ctx,{...args,returnTime:'19:00'}),/different booking particulars/);assert.equal(b.returnTime,'18:00');
 // Interrupted provider creation remains the same pending booking, never a new obligation.
 assert.equal(retry.sessionId,undefined);
 await db.patch(b._id,{stripeCheckoutSessionId:'session-fixture'});assert.equal((await bookings.createPending.handler(ctx,args)).sessionId,'session-fixture');
 await db.patch(b._id,{status:'confirmed',idVerifyStatus:'verified',verificationExpiresAt:Date.now()+600000});
 await assert.rejects(bookings.createPending.handler(ctx,args),/completed or closed/);assert.equal(count(),1);
 const release=()=>bookings.adminSetStatus.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:b._id,status:'active'});
 await assert.rejects(release(),/review.*outstanding/);assert.equal(b.status,'confirmed','zero-hold booking still needs reviewed evidence, not an invented hold');
 await db.patch(b._id,{agreementSignedAt:undefined});await assert.rejects(release(),/Retained agreement/);
 await db.patch(b._id,{agreementSignedAt:signed,agreementSnapshot:undefined});await assert.rejects(release(),/accepted agreement copy/);
 await db.patch(b._id,{agreementSnapshot:saved,depositHoldAmount:100,depositHoldStatus:'declined'});await assert.rejects(release(),/card hold/);
 await db.patch(b._id,{depositHoldStatus:'held',depositHoldExpiresAt:Date.now()-1});await assert.rejects(release(),/card hold/);
 await db.patch(b._id,{depositHoldExpiresAt:Date.now()+600000,idVerificationSource:'manual'});await assert.rejects(release(),/review.*outstanding/);
 await db.patch(b._id,{idVerifyStatus:'requires_input'});await assert.rejects(release(),/verification must/);
 await db.patch(b._id,{idVerifyStatus:'verified'});
 const acct=put('accounts',{email:args.customerEmail});put('sessions',{token:'agreement-renter',accountId:acct._id,expiresAt:Date.now()+600000});
 assert.equal(await bookings.invoiceData.handler(ctx,{bookingId:b._id,token:'foreign'}),null);
 await db.patch(b.customerId,{name:'Changed profile name'});
 await db.patch(b._id,{returnTime:'20:00'});const invoice=await bookings.invoiceData.handler(ctx,{bookingId:b._id,token:'agreement-renter'});
 assert.equal(invoice.agreementSnapshot.particulars.customerName,'Original Renter');assert.equal(invoice.agreementSnapshot.particulars.returnTime,'18:00');
 const old=put('bookings',{...b,_id:'historical-agreement',agreementSnapshot:undefined,agreementRequestId:undefined,agreementDocs:args.agreementDocs.map(d=>({...d,version:'2026-10-v8'}))});
 const historic=await bookings.invoiceData.handler(ctx,{bookingId:old._id,token:'agreement-renter'});
 assert.equal(historic.agreementSnapshot,null);assert.equal(historic.acceptedAgreementEvidence.documents[0].version,'2026-10-v8');assert.equal(old.agreementSnapshot,undefined);
 // Attachment survives PDF failure; stub mail and network to prevent real side effects.
 let mail;setMock('./lib/mailer',{sendMail:async(m)=>{mail=m;return true;}});
 const invoiceModule=load('convex/invoice.ts'),originalFetch=global.fetch;global.fetch=async()=>({ok:false});process.env.INVOICE_SECRET='fixture-only';
 try{await invoiceModule.invoiceEmail.handler({runQuery:async()=>b},{bookingId:b._id});}finally{global.fetch=originalFetch;}
 assert.equal(mail.attachments.length,1);assert.equal(Buffer.from(mail.attachments[0].content,'base64').toString(),saved);
 assert.match(mail.html,/not automatic liability caps/);
 global.fetch=async()=>({ok:false});
 try{await invoiceModule.invoiceEmail.handler({runQuery:async()=>old},{bookingId:old._id});}finally{global.fetch=originalFetch;}
 assert.equal(mail.attachments.length,0);assert(!mail.html.includes('not automatic liability caps'),'new liability wording must not be imposed on a historical agreement');
 assert.match(mail.html,/current terms have not been substituted/);
 // Render the actual receipt component and inspect its decoded PDF text separately.
 const renderer=await import('@react-pdf/renderer');
 const jsx=ts.transpileModule(fs.readFileSync('src/lib/invoice/InvoiceDocument.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};new Function('require','module','exports',jsx)(n=>n==='@react-pdf/renderer'?renderer:require(n),m,m.exports);
 const pdf=await renderer.renderToBuffer(require('react').createElement(m.exports.InvoiceDocument,{data:invoice}));
 fs.writeFileSync('/tmp/dbc-agreement-fixture.pdf',pdf);assert.ok(pdf.length>1000);
 console.log('PASS rental agreements: missing/stale/duplicate/delivery assent, atomic attempt reuse and changed-particular rejection, immutable snapshots/history, release review/verification/hold/manual guards, private durable download, PDF rendering and email copy despite PDF failure.');
})().catch(e=>{console.error(e);process.exitCode=1;});
