const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process'),esbuild=require('esbuild');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-assessment-pdf-'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
 await esbuild.build({entryPoints:[path.join(root,'src/app/api/invoice/[id]/route.ts')],bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',alias:{'@':path.join(root,'src')},outfile:path.join(dir,'route.mjs')});
 const {GET}=await import('file://'+path.join(dir,'route.mjs'));process.env.NEXT_PUBLIC_CONVEX_URL='https://fixture.invalid';
 const invoice={number:'DBC-BOOKING1',issuedAt:Date.now(),customerName:'Fixture customer',assessmentPayments:[{id:'charge-owned',kind:'damage',reason:'Documented camera damage and repair.',paid:20,refunded:5}]};
 global.fetch=async(_url,options)=>{const args=JSON.parse(options.body).args;return {json:async()=>({status:'success',value:args.token==='owner'||args.key==='fixture-secret'?invoice:null})}};
 const request=(id,token='owner')=>{const req=new Request('http://localhost/api/invoice/booking-1?phase=assessment&assessment='+id,{headers:{authorization:'Bearer '+token}});req.nextUrl=new URL(req.url);return req};
 const params={params:Promise.resolve({id:'booking-1'})};
 assert.equal((await GET(request('charge-owned','foreign'),params)).status,403);assert.equal((await GET(request('charge-foreign'),params)).status,404);
 const response=await GET(request('charge-owned'),params);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('cache-control'),'private, no-store');
 const file=path.join(dir,'statement.pdf');fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));const text=execFileSync('pdftotext',[file,'-'],{encoding:'utf8'});
 for(const expected of ['ASSESSMENT','Documented camera damage','20.00','5.00','15.00','does not replace the original rental invoice'])assert(text.includes(expected),expected);
 execFileSync('pdftoppm',['-png','-scale-to','1200','-singlefile',file,'/tmp/dbc-assessment-statement']);
 console.log('PASS assessment PDF route: owner scope, unknown assessment denial, real rendered amounts, confirmed refund and separate-invoice language; synthetic data.');
})().catch(error=>{console.error(error);process.exitCode=1});
