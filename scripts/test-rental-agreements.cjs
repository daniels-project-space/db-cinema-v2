/** Real handlers and durable document rendering. Fixtures only; no provider writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {load,db,put,tables,setMock}=require('./lib/rentalTestHarness.cjs');
const {AGREEMENTS,LEGAL_VERSION}=load('src/lib/legal.ts');
const {LEGAL_ARCHIVE}=load('shared/legalDocuments.ts');
const {CURRENT_PRIVACY_NOTICE}=load('shared/currentPrivacyNotice.ts');
const {CURRENT_PRIVACY_NOTICE_VERSION}=load('shared/legalVersioning.ts');
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
 assert.match(CURRENT_PRIVACY_NOTICE.sections.find(s=>s.h==='5. Retention').p,/delete the copies after 90 days/i);
 assert.match(CURRENT_PRIVACY_NOTICE.sections.find(s=>s.h==='5. Retention').p,/until it closes, then delete them after 90 days/i);
 assert.match(CURRENT_PRIVACY_NOTICE.sections.find(s=>s.h==='5. Retention').p,/dates that need checking can pause deletion/i);
 assert.equal(load('shared/currentPrivacyNotice.ts').CURRENT_PRIVACY_NOTICE_VERSION,CURRENT_PRIVACY_NOTICE_VERSION);
 assert(AGREEMENTS.some(d=>d.kind==='privacy'&&d.version===CURRENT_PRIVACY_NOTICE_VERSION),'The current privacy notice is linked and versioned in the new renter agreement');
 assert(!AGREEMENTS.some(d=>d.kind==='data-processing'),'New checkouts no longer show the stale data-processing copy beside the accurate privacy notice');
 assert.match(fs.readFileSync('src/app/legal/[slug]/page.tsx','utf8'),/slug === "data-processing" && !selected\.version\) redirect\("\/legal\/privacy"\)/,'Unversioned legacy privacy links lead to the accurate current notice');
 assert.match(CURRENT_PRIVACY_NOTICE.sections.find(s=>s.h==='1. What we collect').p,/private copies/i);
 assert.match(CURRENT_PRIVACY_NOTICE.sections.find(s=>s.h==='1. What we collect').p,/separately opt in/i);
 assert.match(CURRENT_PRIVACY_NOTICE.sections.find(s=>s.h==='1. What we collect').p,/never published/i);
 assert.doesNotMatch(LEGAL_ARCHIVE['2026-10-v16'].privacy.sections.find(s=>s.h==='5. Retention').p,/90 days/,'A current privacy notice must not rewrite archived agreements');
 const count=()=>tables.get('bookings')?.length??0;
 assert.throws(()=>contract.assertCurrentAgreement(undefined,'pickup'),/sign/);
 assert.throws(()=>contract.assertCurrentAgreement({name:'Person',securityHoldConsent:true,laterChargeConsent:true,documents:args.agreementDocs.slice(1)},'pickup'),/current rental/);
 assert.throws(()=>contract.assertCurrentAgreement({name:'Person',securityHoldConsent:true,laterChargeConsent:true,documents:args.agreementDocs.map(d=>({...d,version:'stale'}))},'pickup'),/current rental/);
 assert.throws(()=>contract.assertCurrentAgreement({name:'Person',securityHoldConsent:true,laterChargeConsent:true,documents:[...args.agreementDocs,args.agreementDocs[0]]},'pickup'),/current rental/);
 assert.throws(()=>contract.assertCurrentAgreement({name:'Person',securityHoldConsent:true,laterChargeConsent:true,documents:args.agreementDocs},'delivery'),/current rental/);
 const deliveryDocs=[...args.agreementDocs,{kind:'delivery-disclaimer',version:contract.DELIVERY_TERMS_VERSION}];
 assert.throws(()=>contract.assertCurrentAgreement({name:'Person',securityHoldConsent:true,laterChargeConsent:true,documents:deliveryDocs},'delivery'),/accept the delivery arrangements/i,
  'The versioned delivery document alone cannot stand in for the delivery assent checkbox');
 assert.doesNotThrow(()=>contract.assertCurrentAgreement({name:'Person',securityHoldConsent:true,laterChargeConsent:true,deliveryAccepted:true,documents:deliveryDocs},'delivery'));
 await assert.rejects(bookings.createPending.handler(ctx,{...args,agreementRequestId:undefined}),/acceptance attempt/);assert.equal(count(),0);
 const created=await bookings.createPending.handler(ctx,args),b=await db.get(created.bookingId);
 const saved=b.agreementSnapshot,signed=b.agreementSignedAt;
 // A renter with a Didit pass needs fresh, readable provider copies before the
 // later handover guards can be reached in this test.
 const diditSessionId='agreement-didit-session';await db.patch(b._id,{diditSessionId});
 const archive=put('verification_archives',{bookingId:b._id,sessionId:diditSessionId,source:'didit',status:'complete',accountId:undefined,readProofVersion:2,readVerifiedAt:Date.now(),supplementalStatus:'complete',supplementalCheckVersion:2});
 for(const kind of ['identity-0-front_image','address-0']){
  const storageId=`agreement-${kind}`,sha256='a'.repeat(64),size=64,contentType='application/pdf';
  put('verification_documents',{archiveId:archive._id,bookingId:b._id,sessionId:diditSessionId,accountId:undefined,kind,storageId,sha256,size,contentType});
  put('_storage',{_id:storageId,sha256,size,contentType});
 }
 assert.equal(count(),1);const snapshot=JSON.parse(saved);
 assert.equal(snapshot.version,LEGAL_VERSION);assert.equal(LEGAL_VERSION,'2026-10-v13');
 const current=load('shared/legalDocuments.ts').LEGAL_DOCS['deposit-agreement'];assert.match(JSON.stringify(current),/no card hold/i);assert.match(JSON.stringify(current),/10%/);assert.match(JSON.stringify(current),/£250/);assert.match(JSON.stringify(current),/seven days/);assert.match(JSON.stringify(current),/authentication/i);assert.match(JSON.stringify(load('shared/legalDocuments.ts').LEGAL_ARCHIVE['2026-10-v12']['deposit-agreement']),/automatically request.*agreed pickup/);
 const v9=load('shared/legal-history/2026-10-v9.ts').default;const legal=load('shared/legalDocuments.ts');assert.equal(legal.RENTAL_DRAFT_RELEASE_READY,false);const identity=legal.LEGAL_DOCS['rental-agreement'].sections.find(s=>s.h.startsWith('5.')).p;for(const rule of ['at least two different established sources','ID, selfie/liveness and address proof','Manual/legacy approvals do not qualify','cannot bypass acceptance'])assert(identity.includes(rule),'Required verification safeguards remain');assert(!/solicitor|review-ready|Draft notice|before launch/i.test(JSON.stringify(legal.LEGAL_DOCS)));assert.deepEqual(legal.LEGAL_ARCHIVE['2026-10-v10'],load('shared/legal-history/2026-10-v10.ts').default);assert.deepEqual(legal.LEGAL_ARCHIVE['2026-10-v9'],v9);assert.equal(snapshot.particulars.total,200);
 assert.equal(snapshot.particulars.securityHold,0);assert.equal(snapshot.particulars.timeZone,'Europe/London');
 assert.equal(snapshot.particulars.pickupArea,'Trafalgar Square','Pre-verification rental particulars record the advertised collection area');
 assert.equal(snapshot.particulars.address,null,'The exact gated pickup address is not exposed in the signed pre-verification record');
 assert.equal(snapshot.particulars.deliveryTermsAccepted,false);
 const privacy=snapshot.documents.find(d=>d.kind==='privacy');assert.equal(privacy.version,CURRENT_PRIVACY_NOTICE_VERSION);
 assert.deepEqual(privacy.text,CURRENT_PRIVACY_NOTICE,'The signed rental record retains the exact privacy notice shown at checkout');
 const deliverySnapshot=JSON.parse(contract.snapshotAgreement({...args,fulfilment:'delivery',address:'123 Delivery fixture road, London',deliveryAccepted:true,agreementDocs:deliveryDocs},Date.now(),200,0));
 assert.equal(deliverySnapshot.particulars.deliveryTermsAccepted,true);
 assert.equal(deliverySnapshot.particulars.pickupArea,null);
 assert.equal(deliverySnapshot.particulars.address,'123 Delivery fixture road, London');
 assert.equal(snapshot.particulars.serialConditionSchedule,'pending-agreed-handover');
 assert.match(snapshot.documents.find(d=>d.kind==='rental-agreement').text.sections.find(s=>s.h==='4. Loss & damage').p,/theft.*non-return/);
 await assert.rejects(bookings.createPending.handler(ctx,args),/pending reconciliation/i,'a booking without a persisted payment session cannot start a second acceptance');
 assert.equal(count(),1);assert.equal(b.agreementSnapshot,saved);assert.equal(b.agreementSignedAt,signed);
 // Once the exact payment session is attached, equivalent retries return that
 // same session regardless of input key order.
 await db.patch(b._id,{stripeCheckoutSessionId:'session-fixture'});
 const reordered=Object.fromEntries(Object.entries(args).reverse());
 assert.equal((await bookings.createPending.handler(ctx,reordered)).bookingId,b._id,'object key order cannot create another obligation');
 assert.equal((await bookings.createPending.handler(ctx,args)).sessionId,'session-fixture');
 const changedReplay=await bookings.createPending.handler(ctx,{...args,returnTime:'19:00'});
 assert.equal(changedReplay.sessionId,'session-fixture','the trusted checkout action must validate its request fingerprint before this internal idempotent mutation');
 assert.equal(b.returnTime,'18:00','replaying an existing session never mutates the accepted agreement snapshot');
 await db.patch(b._id,{status:'confirmed',paidConfirmedAt:Date.now(),verificationProvider:'didit',idVerifyStatus:'verified',idVerificationSource:'didit',idVerifiedAt:Date.now(),verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},verificationExpiresAt:Date.now()+600000});
 await assert.rejects(bookings.createPending.handler(ctx,args),/completed or closed/);assert.equal(count(),1);
 const release=()=>bookings.adminSetStatus.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:b._id,status:'active'});
 await assert.rejects(release(),/review.*outstanding/);assert.equal(b.status,'confirmed','zero-hold booking still needs reviewed evidence, not an invented hold');
 await db.patch(b._id,{agreementSignedAt:undefined});await assert.rejects(release(),/Retained agreement/);
 await db.patch(b._id,{agreementSignedAt:signed,agreementSnapshot:undefined});await assert.rejects(release(),/accepted agreement copy/);
 await db.patch(b._id,{agreementSnapshot:saved,depositHoldAmount:100,depositHoldStatus:'declined'});await assert.rejects(release(),/card hold/);
 await db.patch(b._id,{depositHoldStatus:'held',depositHoldExpiresAt:Date.now()-1});await assert.rejects(release(),/card hold/);
 await db.patch(b._id,{depositHoldExpiresAt:Date.now()+600000,idVerificationSource:'manual'});await assert.rejects(release(),/Didit verification must be approved/);
 await db.patch(b._id,{idVerifyStatus:'requires_input'});await assert.rejects(release(),/verification must/);
 await db.patch(b._id,{idVerifyStatus:'verified'});
 const acct=put('accounts',{email:args.customerEmail});put('sessions',{token:'agreement-renter',accountId:acct._id,expiresAt:Date.now()+600000});
 assert.equal(await bookings.invoiceData.handler(ctx,{bookingId:b._id,token:'foreign'}),null);
 assert.equal((await bookings.invoiceData.handler(ctx,{bookingId:b._id,token:process.env.ADMIN_TOKEN})).number,`DBC-${b._id.slice(-8).toUpperCase()}`,'Administrators can open the linked receipt');
 const unrelated=put('accounts',{email:'someone-else@agreement.invalid'});
 put('sessions',{token:'unrelated-invoice-renter',accountId:unrelated._id,expiresAt:Date.now()+600000});
 put('sessions',{token:'expired-invoice-renter',accountId:acct._id,expiresAt:Date.now()-1});
 assert.equal(await bookings.invoiceData.handler(ctx,{bookingId:b._id,token:'unrelated-invoice-renter'}),null,'Other renters cannot read invoices');
 assert.equal(await bookings.invoiceData.handler(ctx,{bookingId:b._id,token:'expired-invoice-renter'}),null,'Expired sign-in cannot read invoices');
 await db.patch(b.customerId,{name:'Changed profile name'});
 await db.patch(b._id,{returnTime:'20:00'});const invoice=await bookings.invoiceData.handler(ctx,{bookingId:b._id,token:'agreement-renter'});
 assert.equal(invoice.agreementSnapshot.particulars.customerName,'Original Renter');assert.equal(invoice.agreementSnapshot.particulars.returnTime,'18:00');
 const old=put('bookings',{...b,_id:'historical-agreement',agreementSnapshot:undefined,agreementRequestId:undefined,agreementDocs:args.agreementDocs.map(d=>({...d,version:'2026-10-v8'}))});
 const historic=await bookings.invoiceData.handler(ctx,{bookingId:old._id,token:'agreement-renter'});
 assert.equal(historic.agreementSnapshot,null);assert.equal(historic.acceptedAgreementEvidence.documents[0].version,'2026-10-v8');assert.equal(old.agreementSnapshot,undefined);
 // PDF failure must not cause a raw agreement/code attachment; accepted evidence stays in the private account.
 let mail;setMock('./lib/mailer',{sendMail:async(m)=>{mail=m;return true;}});
 const invoiceModule=load('convex/invoice.ts'),originalFetch=global.fetch;global.fetch=async()=>({ok:false});process.env.INVOICE_SECRET='fixture-only';
 try{await invoiceModule.invoiceEmail.handler({runQuery:async()=>b},{bookingId:b._id});}finally{global.fetch=originalFetch;}
 assert.equal(mail.attachments.length,0);assert(!mail.html.includes('JSON agreement'));assert(!mail.html.includes('insurance excess'));assert.equal(b.agreementSnapshot,saved,'Accepted evidence is retained privately');
 global.fetch=async()=>({ok:false});
 try{await invoiceModule.invoiceEmail.handler({runQuery:async()=>old},{bookingId:old._id});}finally{global.fetch=originalFetch;}
 assert.equal(mail.attachments.length,0);assert(!mail.html.includes('not automatic liability caps'),'new liability wording must not be imposed on a historical agreement');
 assert.match(mail.html,/paid rental invoice/);
 // Render the actual invoice component and inspect its decoded PDF text separately.
 const renderer=await import('@react-pdf/renderer');
 const jsx=ts.transpileModule(fs.readFileSync('src/lib/invoice/InvoiceDocument.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};new Function('require','module','exports',jsx)(n=>n==='@react-pdf/renderer'?renderer:n==='../site'?load('src/lib/site.ts'):n.endsWith('shared/rentalSecurity')?require('./lib/rentalTestHarness.cjs').load('shared/rentalSecurity.ts'):require(n),m,m.exports);
 const pdf=await renderer.renderToBuffer(require('react').createElement(m.exports.InvoiceDocument,{data:invoice}));
 fs.writeFileSync('/tmp/dbc-agreement-fixture.pdf',pdf);assert.ok(pdf.length>1000);
 console.log('PASS rental agreements: missing/stale/duplicate/delivery assent, atomic attempt reuse and changed-particular rejection, immutable snapshots/history, release review/verification/hold/manual guards, private durable download, PDF rendering and email copy despite PDF failure.');
})().catch(e=>{console.error(e);process.exitCode=1;});
