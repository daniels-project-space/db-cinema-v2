/** Public recovery copy and fixed, own-rental destinations; never display provider stack traces. */
export function accountAccessDestination(bookingId?:string,next?:string|null){
 if(!bookingId)return "/account";
 return next==="verification"?`/account/verification/${encodeURIComponent(bookingId)}`:`/account?rental=${encodeURIComponent(bookingId)}#chat`;
}
export function accountAccessError(error:unknown){
 const code=(error as {data?:{code?:string}})?.data?.code;
 if(code==="ACCESS_LINK_EXPIRED")return "This link has expired or has already been used. Request a new sign-in link.";
 if(code==="ACCESS_LINK_INVALID")return "This sign-in link is invalid. Request a new sign-in link.";
 if(code==="ACCOUNT_BLOCKED")return "Please contact DB Cinema Rentals for help with your account.";
 return "We couldn’t open this sign-in link. Please try again or request a new link.";
}
