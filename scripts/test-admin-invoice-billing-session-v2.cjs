const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),esbuild=require('esbuild');
const {webcrypto,createHash}=require('node:crypto');
const h=require('./lib/rentalTestHarness.cjs');
global.crypto??=webcrypto;
const hash=value=>createHash('sha256').update(value).digest('hex');
const identity='https://identity.example|billing-invoice-fixture';
const readToken='a'.repeat(64),writeToken='b'.repeat(64),legacyToken='legacy-invoice-admin';
process.env.ADMIN_TOKEN=legacyToken;
process.env.ADMIN_SESSION_BILLING_PORTAL_V2='enabled';
process.env.ADMIN_SESSION_SCOPES_V2=JSON.stringify({[identity]:['payments:read','payments:write']});
let ready=true;
const access=h.load('convex/adminAccountSessionV2.ts');
h.setMock('./adminAccountSessionV2',{...access,adminSessionMigrationReady:()=>ready});
const bookings=h.load('convex/bookings.ts');
const sessions=h.load('convex/adminSessionsV2.ts');
const owner=h.put('accounts',{email:'billing-owner@example.invalid',name:'Billing Owner'});
const foreign=h.put('accounts',{email:'billing-foreign@example.invalid',name:'Other Renter'});
const listing=h.put('listings',{title:'Sony FX3',r2Images:['/sony-fx3.webp']});
const now=Date.now();
const booking=h.put('bookings',{accountId:owner._id,guestEmail:owner.email,guestName:owner.name,status:'returned',paidConfirmedAt:now,total:180,subtotal:180,depositAmount:50,lineItems:[{listingId:listing._id,title:'Sony FX3',qty:1,start:now-86400000,end:now,lineTotal:180}]});
h.put('bookings',{accountId:foreign._id,guestEmail:foreign.email,guestName:foreign.name,status:'returned',paidConfirmedAt:now,total:50,subtotal:50,depositAmount:20,lineItems:[{listingId:listing._id,title:'Sony FX3',qty:1,start:now-86400000,end:now,lineTotal:50}]});
const ctx={db:h.db,auth:{getUserIdentity:async()=>({tokenIdentifier:identity})}};
h.put('sessions',{token:'owner-renter-token',accountId:owner._id,expiresAt:now+60000});
h.put('sessions',{token:'foreign-renter-token',accountId:foreign._id,expiresAt:now+60000});

(async()=>{
  for(const [token,scope] of [[readToken,'payments:read'],[writeToken,'payments:write']])
    await sessions.createSession.handler(ctx,{tokenDigest:hash(token),principalId:`admin:${hash(identity)}`,scopes:[scope],expiresAt:now+60000});

  const page=await bookings.adminInvoicePage.handler(ctx,{token:readToken,accountId:owner._id,paginationOpts:{numItems:10,cursor:null}});
  assert.deepEqual(page.page.map(row=>row._id),[booking._id],'The read-scoped admin invoice list contains only the selected account rental');
  await assert.rejects(bookings.adminInvoicePage.handler(ctx,{token:legacyToken,accountId:owner._id,paginationOpts:{numItems:10,cursor:null}}),/unauthorized/,'Billing V2 does not accept the legacy admin token for invoice lists');

  const invoice=await bookings.invoiceData.handler(ctx,{bookingId:booking._id,token:readToken});
  assert.equal(invoice?.customerName,'Billing Owner','A valid payments:read session opens the selected rental invoice');
  assert.equal(await bookings.invoiceData.handler(ctx,{bookingId:booking._id}),null,'Missing admin credentials cannot read invoice details');
  assert.equal(await bookings.invoiceData.handler(ctx,{bookingId:booking._id,token:writeToken}),null,'payments:write alone cannot read an invoice');
  assert.equal(await bookings.invoiceData.handler(ctx,{bookingId:booking._id,token:legacyToken}),null,'The legacy admin token is denied when Billing V2 is active');
  assert.equal((await bookings.invoiceData.handler(ctx,{bookingId:booking._id,token:'owner-renter-token'}))?.customerName,'Billing Owner','Renter ownership access remains available under Billing V2');
  assert.equal(await bookings.invoiceData.handler(ctx,{bookingId:booking._id,token:'foreign-renter-token'}),null,'A renter cannot open another account’s invoice');

  const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-admin-invoice-v2-'));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
  await esbuild.build({entryPoints:[path.join(root,'src/app/api/invoice/[id]/route.ts')],bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',alias:{'@':path.join(root,'src')},outfile:path.join(dir,'route.mjs'),logLevel:'silent'});
  const {GET}=await import('file://'+path.join(dir,'route.mjs'));
  process.env.NEXT_PUBLIC_CONVEX_URL='https://billing-invoice-fixture.invalid';
  const originalFetch=global.fetch;
  global.fetch=async(url,options)=>{
    assert.equal(String(url),'https://billing-invoice-fixture.invalid/api/query');
    const query=JSON.parse(options.body);assert.equal(query.path,'bookings:invoiceData');
    const value=await bookings.invoiceData.handler(ctx,query.args);
    return new Response(JSON.stringify({status:'success',value}),{headers:{'content-type':'application/json'}});
  };
  try{
    const request=token=>{const req=new Request(`https://dbcinemarentals.com/api/invoice/${booking._id}`,{headers:token?{authorization:`Bearer ${token}`}:{}});req.nextUrl=new URL(req.url);return req;};
    const params={params:Promise.resolve({id:booking._id})};
    assert.equal((await GET(request(undefined),params)).status,403,'The actual PDF route denies a request without credentials');
    assert.equal((await GET(request(writeToken),params)).status,403,'The actual PDF route denies an admin with only payments:write');
    assert.equal((await GET(request(legacyToken),params)).status,403,'The actual PDF route denies the legacy admin token under V2');
    const response=await GET(request(readToken),params);
    assert.equal(response.status,200,'The real invoice PDF route succeeds after selected-account list → detail authorization');
    assert.equal(response.headers.get('content-type'),'application/pdf');
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,5).toString(),'%PDF-','The route returns a rendered PDF document');
  }finally{global.fetch=originalFetch;fs.rmSync(dir,{recursive:true,force:true});}
  await sessions.revoke.handler(ctx,{tokenDigest:hash(readToken)});
  assert.equal(await bookings.invoiceData.handler(ctx,{bookingId:booking._id,token:readToken}),null,'Revoking a billing session removes invoice detail access');
  console.log('PASS admin invoice Billing V2: selected-account list, payments:read detail and real PDF route; wrong scope, legacy token and foreign renter denied, owner renter retained. Synthetic account data only.');
})().catch(error=>{console.error(error);process.exitCode=1});
