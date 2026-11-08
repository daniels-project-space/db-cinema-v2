const assert=require("node:assert/strict");
const {load,db,put}=require("./lib/rentalTestHarness.cjs");

const account=put("accounts",{email:"invoice@example.invalid",name:"Invoice Renter"});
const listing=put("listings",{title:"Sony FX3",reviewedImageUrls:["https://images.example.invalid/fx3.jpg"]});
const line={listingId:listing._id,title:"Sony FX3",start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),qty:1,lineTotal:80};
const booking=put("bookings",{
  accountId:account._id,guestEmail:account.email,guestName:account.name,status:"confirmed",paidConfirmedAt:Date.now(),
  lineItems:[line],subtotal:80,discount:0,deliveryFee:0,creditApplied:0,membershipCreditApplied:0,depositAmount:50,total:80,
  fulfilment:"pickup",currency:"GBP",agreementDocs:[],
});
const bookings=load("convex/bookings.ts"),invoice=load("convex/invoice.ts");
const ctx={db};
ctx.runQuery=async(reference,args)=>bookings[reference.split(".").at(-1)].handler(ctx,args);
ctx.runMutation=async(reference,args)=>bookings[reference.split(".").at(-1)].handler(ctx,args);

(async()=>{
  const prepared=await invoice.invoiceEmail.handler(ctx,{bookingId:booking._id,prepareOnly:true});
  assert(prepared?.html.includes("Sony FX3"));
  assert.equal(booking.invoiceSnapshot.number,`DBC-${String(booking._id).slice(-8).toUpperCase()}`);
  assert.equal(booking.invoiceSnapshot.email,account.email);
  assert.equal(booking.invoiceSnapshot.lineItems[0].title,"Sony FX3");

  booking.lineItems=[{...line,title:"New lens kit",lineTotal:120}];
  booking.subtotal=120;booking.total=120;
  process.env.INVOICE_SECRET="fixture-invoice-secret";
  const downloaded=await bookings.invoiceData.handler(ctx,{bookingId:booking._id,key:process.env.INVOICE_SECRET});
  assert.equal(downloaded.lineItems[0].title,"Sony FX3","The invoice PDF query keeps the originally issued equipment snapshot");
  assert.equal(downloaded.total,80,"Later booking edits do not rewrite the issued invoice total");

  const altered={...booking.invoiceSnapshot,total:999,lineItems:[{...line,title:"Forged invoice line"}]};
  const replay=await bookings.saveInitialInvoiceSnapshot.handler(ctx,{bookingId:booking._id,snapshot:altered});
  assert.equal(replay.total,80,"A later snapshot request cannot overwrite the first issued invoice");
  assert.equal(booking.invoiceSnapshot.lineItems[0].title,"Sony FX3");
  delete process.env.INVOICE_SECRET;
  console.log("PASS invoice first-issue snapshot: prepared before delivery, immutable replay and PDF query remains stable after booking edits; synthetic data only.");
})().catch(error=>{delete process.env.INVOICE_SECRET;console.error(error);process.exitCode=1;});
