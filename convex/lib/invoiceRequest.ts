/** Private server-to-server documents, including protected Vercel previews.
 * Never follow a redirect carrying invoice or preview access credentials. */
export async function invoiceRequest(input:string,init:RequestInit={}):Promise<Response>{
 const url=new URL(input),app=new URL(process.env.APP_URL??"https://dbcinemarentals.com");
 if((url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname)))||url.origin!==app.origin||url.username||url.password||!url.pathname.startsWith("/api/invoice/"))throw Error("Invalid private invoice destination.");
 const headers=new Headers(init.headers);
 headers.delete("x-vercel-protection-bypass");
 const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
 if(bypass&&url.protocol==="https:"&&url.hostname.endsWith(".vercel.app"))headers.set("x-vercel-protection-bypass",bypass);
 const preparedHeaders:Record<string,string>={};
 headers.forEach((value,key)=>{preparedHeaders[key]=value;});
 return fetch(url.toString(),{...init,headers:preparedHeaders,redirect:"error"});
}
