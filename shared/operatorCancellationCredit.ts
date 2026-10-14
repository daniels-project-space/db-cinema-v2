/** Monetary inputs and outputs are integer pence. Refundable security and
 * membership fees are not rental purchase value and never earn this bonus. */
export const OPERATOR_CANCEL_GRACE_MS=3600000;
export const OPERATOR_CREDIT_DAYS=365;
export type OperatorCancellationPreview={
 state:"waiting"|"email_pending"|"offered"|"chosen"|"settled"|"review";
 choice:"refund"|"credit"|null;choiceDeadline:number;bookingTitle:string;creditAllowed:boolean;
 refund:{cardRefundPence:number;restoredCreditPence:number};
 credit:{cardRefundPence:number;principalPence:number;bonusPence:number;creditPence:number;validDays:number};
};
function checked(value:number){if(!Number.isSafeInteger(value)||value<0)throw Error("Invalid cancellation payment amount.");return value;}
function number(value:bigint){if(value>BigInt(Number.MAX_SAFE_INTEGER))throw Error("Cancellation settlement exceeds supported precision.");return Number(value);}
export function operatorCancellationOptions(input:{cashRemainingPence:number;securityRemainingPence:number;spentCreditPence:number}){
 const cash=checked(input.cashRemainingPence),security=checked(input.securityRemainingPence),spent=checked(input.spentCreditPence);
 if(security>cash)throw Error("Refundable security exceeds the verified remaining card payment.");
 const eligible=number(BigInt(cash-security)+BigInt(spent));
 const bonus=number((BigInt(eligible)*BigInt(30)+BigInt(50))/BigInt(100));
 return {refund:{cardRefundPence:cash,restoredCreditPence:spent},credit:{cardRefundPence:security,principalPence:eligible,bonusPence:bonus,creditPence:number(BigInt(eligible)+BigInt(bonus)),validDays:OPERATOR_CREDIT_DAYS}};
}
export function operatorCancellationOfferState(input:{cancelledAt:number;pickupAt:number;now:number;blocked:boolean;paid:boolean}){
 if(![input.cancelledAt,input.pickupAt,input.now].every(Number.isSafeInteger))throw Error("Cancellation schedule needs a verified pickup time.");
 if(input.cancelledAt>=input.pickupAt||!input.paid)return "refund_only" as const;
 if(input.now<input.cancelledAt+OPERATOR_CANCEL_GRACE_MS)return "waiting" as const;
 return input.blocked?"refund_only" as const:"offer" as const;
}
