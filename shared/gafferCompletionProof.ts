const encoder=new TextEncoder();
const decoder=new TextDecoder();
const encode=(bytes:Uint8Array)=>btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join("")).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"");
const decode=(value:string)=>Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(value.length/4)*4,"=")),character=>character.charCodeAt(0));
type Completion={messageId:string;answer:string;resolved:boolean;expiresAt:number};

async function key(secret:string,usage:KeyUsage){return crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,[usage]);}

export async function signGafferCompletion(secret:string,payload:Completion):Promise<string>{
  if(secret.length<32)throw Error("Completion signing is not configured.");
  const encoded=encode(encoder.encode(JSON.stringify(payload))),signature=await crypto.subtle.sign("HMAC",await key(secret,"sign"),encoder.encode(encoded));
  return `${encoded}.${encode(new Uint8Array(signature))}`;
}

export async function verifyGafferReplyProof(secret:string,proof:string,messageId:string,answer:string,now:number):Promise<{resolved:boolean;expiresAt:number}|null>{
  if(secret.length<32||proof.length>16000)return null;
  try{
    const parts=proof.split(".");if(parts.length!==2||!parts.every(part=>/^[A-Za-z0-9_-]+$/.test(part)))return null;
    if(!await crypto.subtle.verify("HMAC",await key(secret,"verify"),decode(parts[1]),encoder.encode(parts[0])))return null;
    const payload=JSON.parse(decoder.decode(decode(parts[0]))) as Completion;
    if(payload.messageId!==messageId||payload.answer!==answer||typeof payload.resolved!=="boolean"||!Number.isSafeInteger(payload.expiresAt)||payload.expiresAt<=now||payload.expiresAt>now+5*60000)return null;
    return {resolved:payload.resolved,expiresAt:payload.expiresAt};
  }catch{return null;}
}

export async function verifyGafferCompletion(secret:string,proof:string,messageId:string,answer:string,now:number):Promise<boolean>{
  return (await verifyGafferReplyProof(secret,proof,messageId,answer,now))?.resolved===true;
}
