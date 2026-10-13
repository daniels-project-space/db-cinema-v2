export type DepositRefundState="not_started"|"processing"|"awaiting_approval"|"pending"|"succeeded"|"failed";
/** Issuing a refund and the bank settling it are different states. */
export function depositRefundState(receipts:any[],expectedPence:number):DepositRefundState{
 if(!Number.isSafeInteger(expectedPence)||expectedPence<0)throw Error("Invalid deposit refund amount.");
 if(expectedPence===0)return "succeeded";
 if(!receipts.length)return "not_started";
 if(receipts.some(r=>r.status==="failed"))return "failed";
 if(receipts.some(r=>r.status==="awaiting_approval"))return "awaiting_approval";
 if(receipts.reduce((n,r)=>n+r.amountPence,0)!==expectedPence||receipts.some(r=>r.status==="unknown"))return "processing";
 return receipts.every(r=>r.status==="succeeded")?"succeeded":"pending";
}
export function depositRefundProjection(b:any){
 const expectedPence=Math.round(Math.max(0,(b.depositAmount??0)-(b.returnDecision?.depositKept??b.depositKept??0))*100);
 const rows=b.depositReturnReceipts??[];
 return {state:depositRefundState(rows,expectedPence),amount:expectedPence/100,receipts:rows.map((r:any)=>({refundId:r.stripeRefundId??null,amount:r.amountPence/100,status:r.status,approvalUrl:r.approvalUrl??null,attemptKey:r.attemptKey??null}))};
}
export function depositRefundStatementFields(b:any){
 const expected=Math.round(Math.max(0,(b.depositAmount??0)-(b.returnDecision?.depositKept??b.depositKept??0))*100),rows=b.depositReturnReceipts??[];
 return {depositRefundState:depositRefundState(rows,expected),securityRefundedConfirmed:rows.filter((r:any)=>r.status==="succeeded").reduce((sum:number,r:any)=>sum+r.amountPence,0)/100};
}
