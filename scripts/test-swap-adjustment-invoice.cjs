const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");

const sent=[];
setMock("./lib/mailer",{sendMail:async payload=>{sent.push(payload);return true;}});
const invoice=load("convex/invoice.ts");
const account=put("accounts",{email:"renter@example.invalid"});
const booking=put("bookings",{accountId:account._id,status:"confirmed"});
const swap=put("rental_item_swaps",{bookingId:booking._id,accountId:account._id,status:"applied"});
const stock=put("swap_stock_applied_receipts",{swapId:swap._id,deliveryState:"pending",stockRisk:false});
const receipt=put("rental_swap_adjustment_receipts",{
  swapId:swap._id,bookingId:booking._id,accountId:account._id,recipientEmail:account.email,
  originalInvoiceNumber:"DBC-12345678",issuedAt:Date.now(),currency:"GBP",
  changes:[{lineIndex:0,oldTitle:"Camera kit",newTitle:"Lens kit",oldQty:1,newQty:1,oldLineTotalPence:8000,newLineTotalPence:10400}],
  cardChargePence:2400,cardRefundPence:0,accountCreditRestoredPence:500,requiresStockAck:true,
  emailState:"pending",lastAttemptAt:0,
});
const ctx={db,runMutation:async(reference,args)=>invoice[reference.split(".").at(-1)].handler(ctx,args),runQuery:async(reference,args)=>invoice[reference.split(".").at(-1)].handler(ctx,args)};

(async()=>{
  assert.deepEqual(await invoice.dueSwapAdjustmentEmails.handler(ctx,{}),[receipt._id]);
  const waiting=await invoice.swapAdjustmentEmail.handler(ctx,{receiptId:receipt._id});
  assert.deepEqual(waiting,{sent:false,waiting:true});
  assert.equal(sent.length,0,"Fenced equipment changes are not emailed before shared-stock acknowledgement");
  assert.equal(receipt.emailState,"pending");

  stock.deliveryState="acknowledged";
  booking.activeItemSwapId=undefined;
  const result=await invoice.swapAdjustmentEmail.handler(ctx,{receiptId:receipt._id});
  assert.deepEqual(result,{sent:true});
  assert.equal(receipt.emailState,"sent");
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,account.email);
  assert.equal(sent[0].deliveryKey,`swap-adjustment-${receipt._id}`);
  assert.match(sent[0].subject,/DBC-12345678/);
  assert.match(sent[0].html,/Camera kit/);
  assert.match(sent[0].html,/Lens kit/);
  assert.match(sent[0].html,/£24\.00/);
  assert.match(sent[0].html,/£5\.00/);
  assert.match(sent[0].html,/does not replace the original rental invoice/);
  assert.deepEqual(await invoice.dueSwapAdjustmentEmails.handler(ctx,{}),[],"A sent adjustment is not retried");
  assert.deepEqual(await invoice.swapAdjustmentEmail.handler(ctx,{receiptId:receipt._id}),{sent:false,waiting:true});
  assert.equal(sent.length,1,"Replaying the completed action does not send a duplicate");
  console.log("PASS swap adjustment email: itemized delta and restored credit, shared-stock gate, durable state and idempotent replay; synthetic mail only.");
})().catch(error=>{console.error(error);process.exitCode=1;});
