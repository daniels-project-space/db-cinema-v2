const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

function clamdCommand(socketPath, command, bytes, timeoutMs=TIMEOUT_MS) {
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({path:socketPath});let received=Buffer.alloc(0),settled=false;
    const timer=setTimeout(()=>fail(),timeoutMs);
    const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();reject(Error('Scanner unavailable'));};
    socket.setTimeout(TIMEOUT_MS,fail);socket.on('error',fail);
    socket.on('connect',()=>{
      socket.write(Buffer.from(`z${command}\0`));
      if(bytes){for(let offset=0;offset<bytes.length;offset+=65536){const chunk=bytes.subarray(offset,offset+65536),length=Buffer.alloc(4);length.writeUInt32BE(chunk.length);socket.write(length);socket.write(chunk);}socket.write(Buffer.alloc(4));}
    });
    socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);if(received.length>1024)return fail();const end=received.indexOf(0);if(end<0)return;if(end!==received.length-1)return fail();settled=true;clearTimeout(timer);socket.destroy();resolve(received.subarray(0,end).toString('utf8'));});
    socket.on('end',()=>{if(!settled)fail();});
  });
}

function versionInfo(value, now=Date.now()) {
  const parts=value.split('/');
  if(parts.length!==3||!/^ClamAV [0-9][0-9.]+$/.test(parts[0])||!/^\d+$/.test(parts[1]))throw Error('Scanner version unavailable');
  const updated=Date.parse(`${parts[2]} UTC`);
  if(!Number.isSafeInteger(updated)||updated>now||updated<now-MAX_AGE_MS)throw Error('Scanner signatures are not current');
  return {engine:parts[0],signatureVersion:parts[1],signatureUpdatedAt:updated};
}

async function scanWithClamd(socketPath, bytes, now=Date.now()) {
  const before=await clamdCommand(socketPath,'VERSION');const version=versionInfo(before,now);
  await verifyTestSignature(socketPath);
  const result=await clamdCommand(socketPath,'INSTREAM',bytes);
  if(result!=='stream: OK')throw Error('File rejected or scan incomplete');
  const after=await clamdCommand(socketPath,'VERSION');if(after!==before)throw Error('Scanner changed during scan');
  return version;
}

async function verifyTestSignature(socketPath) {
  const sentinel=Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}','$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
  const result=await clamdCommand(socketPath,'INSTREAM',sentinel);
  if(!/^stream: .*eicar.* FOUND$/i.test(result))throw Error('Scanner test signature was not detected');
}

async function scannerReadiness(socketPath) {
  const before=await clamdCommand(socketPath,'VERSION'),version=versionInfo(before);
  await verifyTestSignature(socketPath);
  if(await clamdCommand(socketPath,'VERSION')!==before)throw Error('Scanner changed during check');
  return version;
}

function checkedTmpDir(directory) {
  if(!directory||!path.isAbsolute(directory)||fs.realpathSync(directory)!==directory)throw Error('Private temporary storage unavailable');
  const stat=fs.statSync(directory);if(!stat.isDirectory()||(stat.mode&0o077)!==0||stat.uid!==process.getuid()||fs.statfsSync(directory).type!==0x01021994)throw Error('Private temporary storage unavailable');
  return directory;
}

function validatePngChunks(bytes) {
  const allowed = new Set(['IHDR', 'IDAT', 'IEND', 'tRNS', 'pHYs', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD']);
  let offset = 8, ended = false, dataSeen = false, dataEnded = false;
  const seen = new Set(), data = [];
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw Error('Image structure is invalid');
    const size = bytes.readUInt32BE(offset), end = offset + 12 + size;
    if (end > bytes.length) throw Error('Image structure is invalid');
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (!allowed.has(type)) throw Error('Image metadata requires review');
    if (type === 'IHDR' && (offset !== 8 || size !== 13) || offset === 8 && type !== 'IHDR') throw Error('Image structure is invalid');
    if (type !== 'IDAT' && seen.has(type)) throw Error('Image metadata requires review');
    seen.add(type);
    if (type === 'IDAT') { if (dataEnded) throw Error('Image structure is invalid'); dataSeen = true; data.push(bytes.subarray(offset + 8, offset + 8 + size)); }
    else if (dataSeen && type !== 'IEND') dataEnded = true;
    if (type === 'tRNS' && ![2, 6].includes(size)) throw Error('Image metadata requires review');
    if (type === 'pHYs' && size !== 9) throw Error('Image metadata requires review');
    if (type === 'gAMA' && size !== 4 || type === 'cHRM' && size !== 32 || type === 'sRGB' && size !== 1 || type === 'sBIT' && (size < 1 || size > 4) || type === 'bKGD' && ![2, 4, 6].includes(size)) throw Error('Image metadata requires review');
    if (type === 'IEND') { if (size !== 0 || end !== bytes.length || !dataSeen) throw Error('Image ending is invalid'); ended = true; }
    offset = end;
  }
  if (!ended) throw Error('Image ending is invalid');
  return data;
}

async function validatePngStream(chunks, width, height) {
  const input = Buffer.concat(chunks), inflater = zlib.createInflate();
  const maximum = width * height * 8 + height * 7;
  let output = 0;
  try {
    inflater.end(input);
    for await (const part of inflater) {
      output += part.length;
      if (output > maximum) throw Error('Image stream exceeds its dimensions');
    }
    if (inflater.bytesWritten !== input.length) throw Error('Image stream contains unused data');
  } finally { inflater.destroy(); }
}

function validateJpegSegments(bytes) {
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)throw Error('Image structure is invalid');
  let offset=2,entropy=false,ended=false;
  while(offset<bytes.length){
    if(entropy){
      if(bytes[offset++]!==0xff)continue;
      while(offset<bytes.length&&bytes[offset]===0xff)offset++;
      if(offset>=bytes.length)throw Error('Image structure is invalid');
      const marker=bytes[offset];
      if(marker===0x00||marker>=0xd0&&marker<=0xd7){offset++;continue;}
      entropy=false;offset--;
    }
    if(bytes[offset++]!==0xff)throw Error('Image structure is invalid');
    while(offset<bytes.length&&bytes[offset]===0xff)offset++;
    if(offset>=bytes.length)throw Error('Image structure is invalid');
    const marker=bytes[offset++];
    if(marker===0xd9){if(offset!==bytes.length)throw Error('Image ending is invalid');ended=true;break;}
    if(marker===0x01)continue;
    if(marker===0xd8||marker===0x00||marker>=0xd0&&marker<=0xd7||offset+2>bytes.length)throw Error('Image structure is invalid');
    const size=bytes.readUInt16BE(offset),end=offset+size;
    if(size<2||end>bytes.length)throw Error('Image structure is invalid');
    if(marker>=0xe0&&marker<=0xef||marker===0xfe){
      const jfif=marker===0xe0&&size===16&&bytes.subarray(offset+2,offset+7).equals(Buffer.from('JFIF\0'))&&bytes[offset+14]===0&&bytes[offset+15]===0;
      if(!jfif)throw Error('Image metadata requires review');
    }else if(![0xc0,0xc1,0xc2,0xc4,0xda,0xdb,0xdd].includes(marker))throw Error('Image structure requires review');
    offset=end;
    if(marker===0xda)entropy=true;
  }
  if(!ended)throw Error('Image ending is invalid');
}

function validateWebpChunks(bytes) {
  const allowed=new Set(['VP8 ','VP8L','VP8X','ALPH']);let offset=12,extended=false,alpha=false,image=false,alphaFlag=false;
  while(offset<bytes.length){
    if(bytes.length-offset<8)throw Error('Image structure is invalid');
    const type=bytes.subarray(offset,offset+4).toString('ascii'),size=bytes.readUInt32LE(offset+4),end=offset+8+size+(size%2);
    if(!allowed.has(type))throw Error('Image metadata requires review');
    if(end>bytes.length||size%2&&bytes[end-1]!==0)throw Error('Image structure is invalid');
    if(type==='VP8X'){
      if(offset!==12||extended||size!==10||bytes[offset+8]&~0x10||bytes[offset+9]||bytes[offset+10]||bytes[offset+11])throw Error('Image structure is invalid');
      extended=true;alphaFlag=Boolean(bytes[offset+8]&0x10);
    }else if(type==='ALPH'){
      if(!extended||!alphaFlag||alpha||image||size===0)throw Error('Image structure is invalid');
      alpha=true;
    }else{
      if(image||size===0||type==='VP8L'&&alpha||type==='VP8 '&&extended&&alphaFlag!==alpha)throw Error('Image structure is invalid');
      image=true;
    }
    offset=end;
  }
  if(offset!==bytes.length||!image)throw Error('Image structure is invalid');
}

async function validateStructure(bytes,tmpDir) {
  if(bytes.subarray(0,5).toString()==='%PDF-'){
    throw Error('PDF attachments require further security validation');
  }
  const image=sharp(bytes,{failOn:'error',limitInputPixels:20000000,animated:false});const metadata=await image.metadata();
  if(!['jpeg','png','webp'].includes(metadata.format)||!Number.isSafeInteger(metadata.width)||!Number.isSafeInteger(metadata.height)||metadata.width<1||metadata.height<1||metadata.width*metadata.height>20000000||metadata.pages&&metadata.pages!==1)throw Error('Image validation failed');
  if(metadata.format==='jpeg'&&(bytes.length<4||bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9))throw Error('Image ending is invalid');
  if(metadata.format==='png'&&(bytes.length<12||!bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082','hex'))))throw Error('Image ending is invalid');
  if(metadata.format==='png')await validatePngStream(validatePngChunks(bytes),metadata.width,metadata.height);
  if(metadata.format==='webp'&&(bytes.length<12||bytes.readUInt32LE(4)+8!==bytes.length))throw Error('Image ending is invalid');
  if(metadata.format==='jpeg')validateJpegSegments(bytes);
  if(metadata.format==='webp')validateWebpChunks(bytes);
  await image.stats();
}

function createScannerServer({token,socketPath,tmpDir,bodyTimeoutMs=15000}) {
  if(typeof token!=='string'||token.length<32||!socketPath||!socketPath.startsWith('/'))throw Error('Scanner configuration unavailable');
  if(!Number.isInteger(bodyTimeoutMs)||bodyTimeoutMs<100||bodyTimeoutMs>15000)throw Error('Scanner configuration unavailable');
  tmpDir=checkedTmpDir(tmpDir);
  if(fs.readdirSync(tmpDir).length)throw Error('Private temporary storage needs cleanup');
  const tokenDigest=crypto.createHash('sha256').update(token).digest();let active=0,cleanupFailed=false;
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const reject=(status)=>{if(!res.headersSent){res.writeHead(status,{'content-type':'application/json',connection:'close'});res.end('{"error":"scan unavailable"}');}req.resume();};
    const auth=req.headers.authorization??'',presented=auth.startsWith('Bearer ')?auth.slice(7):'';
    if(!crypto.timingSafeEqual(tokenDigest,crypto.createHash('sha256').update(presented).digest()))return reject(403);
    const nonce=req.headers['x-scan-nonce'],digest=req.headers['x-content-sha256'];
    if(req.method==='GET'&&req.url==='/health'){
      if(typeof nonce!=='string'||!/^[a-f0-9]{32}$/.test(nonce)||req.headers['transfer-encoding']||Number(req.headers['content-length']??0)!==0)return reject(400);
      if(cleanupFailed||active>=2)return reject(503);active++;
      try{const version=await scannerReadiness(socketPath);if(cleanupFailed)throw Error('Private temporary storage needs cleanup');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({nonce,ready:true,...version}));}catch{return reject(503);}finally{active--;}
      return;
    }
    if(req.method!=='POST'||req.url!=='/scan')return reject(403);
    if(typeof nonce!=='string'||!/^[a-f0-9]{32}$/.test(nonce)||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||req.headers['content-type']!=='application/octet-stream')return reject(400);
    const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES))return reject(413);
    if(cleanupFailed||active>=2)return reject(503);active++;
    try{
      const chunks=[];let size=0;
      const bodyTimer=setTimeout(()=>req.destroy(Error('Upload timed out')),bodyTimeoutMs);
      try{for await(const chunk of req){size+=chunk.length;if(size>MAX_BYTES)throw Error('Too large');chunks.push(chunk);}}finally{clearTimeout(bodyTimer);}
      const bytes=Buffer.concat(chunks,size);if(!size||crypto.createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('Digest mismatch');
      await validateStructure(bytes,tmpDir);
      const version=await scanWithClamd(socketPath,bytes);
      if(cleanupFailed)throw Error('Private temporary storage needs cleanup');
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({nonce,sha256:digest,size,verdict:'clean',complete:true,encrypted:false,truncated:false,limitExceeded:false,...version}));
    }catch(error){if(error?.code==='PRIVATE_CLEANUP_FAILED')cleanupFailed=true;reject(422);}finally{active--;}
  });
}

if(require.main===module){const server=createScannerServer({token:process.env.CHAT_SCANNER_TOKEN,socketPath:process.env.CLAMD_SOCKET,tmpDir:process.env.CHAT_SCANNER_TMPDIR});server.requestTimeout=15000;server.headersTimeout=10000;server.listen(Number(process.env.PORT??8787),'127.0.0.1');}
module.exports={clamdCommand,versionInfo,scanWithClamd,createScannerServer,validateStructure};
