const {createHash}=require('node:crypto');
/** Genuine fixture bytes with independently computed metadata. */
function seedVerificationFiles(put,archive) {
 return [['identity-0-front_image',Buffer.from([255,216,255,217]),'image/jpeg'],['address-0',Buffer.from('%PDF-1.7\nQA fixture\n%%EOF'),'application/pdf']].map(([kind,bytes,contentType])=>{
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const storage=put('_storage',{sha256,size:bytes.length,contentType});
  return put('verification_documents',{archiveId:archive._id,bookingId:archive.bookingId,accountId:archive.accountId,sessionId:archive.sessionId,kind,storageId:storage._id,sha256,size:bytes.length,contentType,savedAt:Date.now()});
 });
}
module.exports={seedVerificationFiles};
