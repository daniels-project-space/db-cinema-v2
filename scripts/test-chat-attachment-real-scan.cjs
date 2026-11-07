const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const h=require('./lib/rentalTestHarness.cjs'),scanner=h.load('convex/lib/chatAttachmentScanner.ts'),{createScannerServer,clamdCommand,versionInfo}=require('../services/chat-scanner/scanner.cjs');
const socket=process.env.DBC_CLAMD_TEST_SOCKET;if(!socket||!socket.startsWith('/tmp/'))throw Error('Set DBC_CLAMD_TEST_SOCKET to the isolated local test daemon.');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-chat-fixture-')),tmpDir=fs.mkdtempSync('/dev/shm/dbc-scanner-'),token='fixture-isolated-token-at-least-32-characters';
const server=createScannerServer({token,socketPath:socket,tmpDir});const originalFetch=global.fetch;
h.setMock('./lib/chatAttachmentScanner',{...scanner,chatAttachmentsReady:()=>true});
const http=h.load('convex/http.ts').default.lookup('/chat-attachment','POST')[0],attachments=h.load('convex/chatAttachments.ts');
const owner=h.put('accounts',{email:'owner@example.invalid'}),other=h.put('accounts',{email:'other@example.invalid'});h.put('sessions',{token:'owner-token',accountId:owner._id,expiresAt:Date.now()+60000});h.put('sessions',{token:'other-token',accountId:other._id,expiresAt:Date.now()+60000});
const booking=h.put('bookings',{accountId:owner._id,status:'confirmed'}),blobs=new Map();
const ctx={db:h.db,scheduler:{runAfter:async()=>{}},storage:{store:async blob=>{const item=h.put('_storage',{size:blob.size,contentType:blob.type,sha256:crypto.createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('base64')});blobs.set(item._id,blob);return item._id},get:async id=>blobs.get(id)??null,delete:async id=>{blobs.delete(id);await h.db.delete(id)}}};
ctx.runMutation=async(ref,args)=>attachments[ref.split('.')[1]].handler(ctx,args);
(async()=>{try{
 versionInfo(await clamdCommand(socket,'VERSION'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint=`http://127.0.0.1:${server.address().port}/scan`;
 global.fetch=(url,options)=>{if(String(url)!=='https://private-scanner.example.invalid/scan')throw Error('Unexpected network access');return originalFetch(endpoint,options)};
 process.env.CHAT_ATTACHMENT_SCANNER_URL='https://private-scanner.example.invalid/scan';process.env.CHAT_ATTACHMENT_SCANNER_TOKEN=token;
 const pdf=path.join(dir,'safe.pdf');execFileSync('gs',['-q','-dNOPAUSE','-dBATCH','-sDEVICE=pdfwrite',`-sOutputFile=${pdf}`,'-c','/Helvetica findfont 12 scalefont setfont 50 700 moveto (Synthetic chat fixture) show showpage']);const clean=fs.readFileSync(pdf);
 const eicar=Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}','$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('')),infected=Buffer.concat([clean,Buffer.from('\n% '),eicar,Buffer.from('\n')]);assert.equal(await clamdCommand(socket,'INSTREAM',infected),'stream: OK','The engine alone does not reliably scan data appended after PDF EOF');
 const headers={origin:'https://dbcinemarentals.com',authorization:'Bearer owner-token','content-type':'application/pdf','x-chat-filename':'fixture.pdf'};
 const url=key=>`https://fixture.convex.site/chat-attachment?bookingId=${booking._id}&key=${key.repeat(32)}`;
 assert.equal((await http(ctx,new Request(url('a'),{method:'POST',headers,body:clean}))).status,403,'PDFs remain unavailable until active-content validation is safe');assert.equal(blobs.size,0);
 const png=await require('sharp')({create:{width:2,height:2,channels:3,background:'#d7a475'}}).png().toBuffer();
 const imageHeaders={...headers,'content-type':'image/png','x-chat-filename':'fixture.png'};
 assert.equal((await http(ctx,new Request(url('f'),{method:'POST',headers:imageHeaders,body:png}))).status,200);assert.equal(blobs.size,1);
 const published=(await dbRows()).find(row=>row.status==='published');assert(published);const download=`https://fixture.convex.site/chat-attachment?bookingId=${booking._id}&download=${published._id}`;
 const result=await http(ctx,new Request(download,{method:'POST',headers:imageHeaders}));assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),png);assert.equal((await http(ctx,new Request(download,{method:'POST',headers:{...imageHeaders,authorization:'Bearer other-token'}}))).status,403);
 assert.equal((await http(ctx,new Request(url('b'),{method:'POST',headers,body:infected}))).status,403);assert.equal(blobs.size,1,'An infected document is never stored or published');
 const originalOffset=/startxref\s+(\d+)\s+%%EOF/.exec(clean.toString('latin1'))[1],forged=Buffer.concat([infected,Buffer.from(`startxref\n${originalOffset}\n%%EOF\n`)]);assert.equal((await http(ctx,new Request(url('d'),{method:'POST',headers,body:forged}))).status,403,'A forged final PDF trailer cannot bypass trailing-data checks');assert.equal(blobs.size,1);
 const malformed=Buffer.from('%PDF-1.7\nnot a valid PDF');assert.equal((await http(ctx,new Request(url('c'),{method:'POST',headers,body:malformed}))).status,403);assert.equal(blobs.size,1);assert.equal(fs.readdirSync(tmpDir).length,0);
 console.log('PASS isolated attachment path: actual HTTP handler, private scanner, real ClamAV and parser, clean upload/download, cross-account denial, malware and malformed rejection. Synthetic data and database only.');
 }finally{global.fetch=originalFetch;delete process.env.CHAT_ATTACHMENT_SCANNER_URL;delete process.env.CHAT_ATTACHMENT_SCANNER_TOKEN;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(tmpDir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
async function dbRows(){return h.db.query('chat_attachment_attempts').collect()}
