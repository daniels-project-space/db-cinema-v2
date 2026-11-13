const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
const { swapAdjustmentDocumentIdentity } = load("shared/swapAdjustmentDocument.ts");

const nodeInvoiceSource = fs.readFileSync(path.join(__dirname, "../convex/invoice.ts"), "utf8");
const invoiceMutationSource = fs.readFileSync(path.join(__dirname, "../convex/invoiceAdjustments.ts"), "utf8");
const invoiceRouteSource = fs.readFileSync(path.join(__dirname, "../src/app/api/invoice/[id]/route.ts"), "utf8");
assert.match(nodeInvoiceSource, /^\s*["']use node["']/);
assert.doesNotMatch(nodeInvoiceSource, /\binternal(?:Mutation|Query)\s*\(/);
assert.match(invoiceMutationSource, /export const claimSwapAdjustmentEmail\s*=\s*internalMutation\(/);
assert.match(invoiceRouteSource, /sp\.get\("phase"\) === "swap-adjustment"/);
assert.match(invoiceRouteSource, /invoiceAdjustments:swapAdjustmentInvoiceData/);
assert.match(invoiceRouteSource, /x-invoice-key/);

const sent=[];
const pdfRequests=[];
const originalFetch=global.fetch;
global.fetch=async(url,options={})=>{
  if(!String(url).includes("/api/invoice/"))return originalFetch(url,options);
  pdfRequests.push({url:String(url),options});
  return new Response(Buffer.from("%PDF-1.4\nsynthetic adjustment PDF\n%%EOF"),{status:200,headers:{"content-type":"application/pdf"}});
};
setMock("./lib/mailer",{sendMail:async payload=>{sent.push(payload);return true;}});
const invoice=load("convex/invoice.ts");
const invoiceAdjustments=load("convex/invoiceAdjustments.ts");
const bookings=load("convex/bookings.ts");
const invoiceHandlers={...invoice,...invoiceAdjustments};
const account=put("accounts",{email:"renter@example.invalid"});
const booking=put("bookings",{accountId:account._id,status:"confirmed"});
const swap=put("rental_item_swaps",{bookingId:booking._id,accountId:account._id,status:"applied"});
booking.activeItemSwapId=swap._id;
const stock=put("swap_stock_applied_receipts",{swapId:swap._id,bookingId:booking._id,deliveryState:"pending",stockRisk:false});
const receipt=put("rental_swap_adjustment_receipts",{
  swapId:swap._id,bookingId:booking._id,accountId:account._id,recipientEmail:account.email,
  originalInvoiceNumber:"DBC-12345678",issuedAt:Date.now(),currency:"GBP",
  changes:[{lineIndex:0,oldTitle:"Camera kit",newTitle:"Lens kit",oldQty:1,newQty:1,oldLineTotalPence:8000,newLineTotalPence:10400}],
  cardChargePence:2400,cardRefundPence:0,accountCreditRestoredPence:500,requiresStockAck:true,
  emailState:"pending",lastAttemptAt:0,
});
const ctx={db,scheduler:{runAfter:async()=>{}},runMutation:async(reference,args)=>invoiceHandlers[reference.split(".").at(-1)].handler(ctx,args),runQuery:async(reference,args)=>invoiceHandlers[reference.split(".").at(-1)].handler(ctx,args)};

(async()=>{
  assert.notEqual(
    swapAdjustmentDocumentIdentity("swap_A",1,0).documentNumber,
    swapAdjustmentDocumentIdentity("swap_a",1,0).documentNumber,
    "Case-sensitive Convex IDs must not collapse to the same numbered document",
  );
  process.env.INVOICE_SECRET="fixture-invoice-secret";
  process.env.APP_URL="https://dbcinemarentals.example.invalid";
  assert.deepEqual(await invoiceAdjustments.dueSwapAdjustmentEmails.handler(ctx,{}),[receipt._id]);
  const waiting=await invoice.swapAdjustmentEmail.handler(ctx,{receiptId:receipt._id});
  assert.deepEqual(waiting,{sent:false,waiting:true});
  assert.equal(sent.length,0,"Fenced equipment changes are not emailed before shared-stock acknowledgement");
  assert.equal(receipt.emailState,"pending");

  stock.deliveryState="acknowledged";
  stock.acknowledgedAt=Date.now();
  assert.equal(await invoiceAdjustments.swapAdjustmentInvoiceData.handler(ctx,{receiptId:receipt._id,bookingId:booking._id,key:process.env.INVOICE_SECRET}),null,"An acknowledged receipt still respects the active settlement fence");
  await bookings.markReturnedStatus.handler(ctx,{bookingId:booking._id});
  assert.equal(booking.status,"returned");
  assert.equal(booking.activeItemSwapId,undefined,"A clean return clears only the applied swap whose Rental Manager acknowledgement is saved");
  assert.equal(await invoiceAdjustments.swapAdjustmentInvoiceData.handler(ctx,{receiptId:receipt._id,bookingId:booking._id,key:"wrong"}),null,"PDF data is unavailable without the existing invoice secret");
  const adjustmentData=await invoiceAdjustments.swapAdjustmentInvoiceData.handler(ctx,{receiptId:receipt._id,bookingId:booking._id,key:process.env.INVOICE_SECRET});
  assert.equal(adjustmentData.documentType,"supplementary_invoice");
  assert.match(adjustmentData.documentNumber,/^DBC-SI-/);
  assert.equal(adjustmentData.originalInvoiceNumber,"DBC-12345678");
  assert.equal(adjustmentData.cardChargePence,2400);
  assert.equal(adjustmentData.accountCreditRestoredPence,500);
  assert.deepEqual(await invoiceAdjustments.swapAdjustmentInvoiceData.handler(ctx,{receiptId:receipt._id,bookingId:booking._id,key:process.env.INVOICE_SECRET}),adjustmentData,"The renderer data remains stable for the immutable receipt");

  const result=await invoice.swapAdjustmentEmail.handler(ctx,{receiptId:receipt._id});
  assert.deepEqual(result,{sent:true});
  assert.equal(receipt.emailState,"sent");
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,account.email);
  assert.equal(sent[0].deliveryKey,`swap-adjustment-${receipt._id}`);
  assert.match(sent[0].subject,/supplementary invoice/i);
  assert.match(sent[0].subject,/DBC-SI-/);
  assert.equal(sent[0].attachments.length,1);
  assert.equal(Buffer.from(sent[0].attachments[0].content,"base64").subarray(0,5).toString(),"%PDF-");
  assert.equal(sent[0].attachments[0].filename,`${adjustmentData.documentNumber}.pdf`);
  assert.match(sent[0].html,/Camera kit/);
  assert.match(sent[0].html,/Lens kit/);
  assert.match(sent[0].html,/£24\.00/);
  assert.match(sent[0].html,/£5\.00/);
  assert.match(sent[0].html,/original invoice remains unchanged/);
  assert.equal(pdfRequests.length,1);
  assert.match(pdfRequests[0].url,/phase=swap-adjustment/);
  assert.match(pdfRequests[0].url,/receiptId=/);
  assert.equal(pdfRequests[0].options.headers["x-invoice-key"],process.env.INVOICE_SECRET);
  assert.deepEqual(await invoiceAdjustments.dueSwapAdjustmentEmails.handler(ctx,{}),[],"A sent adjustment is not retried");
  assert.deepEqual(await invoice.swapAdjustmentEmail.handler(ctx,{receiptId:receipt._id}),{sent:false,waiting:true});
  assert.equal(sent.length,1,"Replaying the completed action does not send a duplicate");

  const refundSwap=put("rental_item_swaps",{bookingId:booking._id,accountId:account._id,status:"applied"});
  const creditNote=put("rental_swap_adjustment_receipts",{
    swapId:refundSwap._id,bookingId:booking._id,accountId:account._id,recipientEmail:account.email,
    originalInvoiceNumber:"DBC-12345678",issuedAt:Date.now(),currency:"GBP",
    changes:[{lineIndex:0,oldTitle:"Lens kit",newTitle:"Camera kit",oldQty:1,newQty:1,oldLineTotalPence:10400,newLineTotalPence:8000}],
    cardChargePence:0,cardRefundPence:2400,accountCreditRestoredPence:0,requiresStockAck:false,
    emailState:"pending",lastAttemptAt:0,
  });
  const creditData=await invoiceAdjustments.swapAdjustmentInvoiceData.handler(ctx,{receiptId:creditNote._id,bookingId:booking._id,key:process.env.INVOICE_SECRET});
  assert.equal(creditData.documentType,"credit_note");
  assert.match(creditData.documentNumber,/^DBC-CN-/);
  assert.equal(creditData.cardRefundPence,2400);
  await invoice.swapAdjustmentEmail.handler(ctx,{receiptId:creditNote._id});
  assert.match(sent[1].subject,/credit note/i);
  assert.equal(sent[1].attachments.length,1);
  assert.match(sent[1].html,/£24\.00/);
  assert.equal(pdfRequests.length,2);

  const documentPath=path.join(__dirname,"../src/lib/invoice/SwapAdjustmentDocument.tsx");
  const compiled=ts.transpileModule(fs.readFileSync(documentPath,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const componentModule=new Module(documentPath,module);
  componentModule.filename=documentPath;
  componentModule.paths=Module._nodeModulePaths(path.dirname(documentPath));
  const originalLoad=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==="../site"&&parent?.filename===documentPath)return {CONTACT_EMAIL:"invoices@example.invalid"};
    return originalLoad.call(this,request,parent,isMain);
  };
  try {
    componentModule._compile(compiled,documentPath);
  } finally {
    Module._load=originalLoad;
  }
  const React=require("react");
  const {renderToBuffer}=require("@react-pdf/renderer");
  const {SwapAdjustmentDocument}=componentModule.exports;
  for(const data of [adjustmentData,creditData]){
    const rendered=await renderToBuffer(React.createElement(SwapAdjustmentDocument,{data}));
    assert.equal(rendered.subarray(0,5).toString(),"%PDF-","Both adjustment types render as real PDFs");
    assert.ok(rendered.length>1000);
  }
  console.log("PASS swap adjustment documents: immutable original invoice, server-secret PDF data, stock-ack gate, supplementary invoice, credit note, account-credit separation, attached valid PDFs and idempotent email replay; synthetic data/mail only.");
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  global.fetch=originalFetch;
  delete process.env.INVOICE_SECRET;
  delete process.env.APP_URL;
});
