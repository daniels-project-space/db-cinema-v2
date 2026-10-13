const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const cart=h.load('convex/cartReplacements.ts'),{replacementCompatible}=h.load('convex/lib/quickReplyReplacement.ts'),policy=h.load('shared/rentalSecurity.ts');
const small=h.put('inventory_units',{name:'V-mount 95Wh',quantityOwned:2,active:true}),large=h.put('inventory_units',{name:'V-mount 150Wh',quantityOwned:4,active:true}),npf=h.put('inventory_units',{name:'NP-F970',quantityOwned:20,active:true});
const listing=(title,unit,qty,value,daily)=>h.put('listings',{title,slug:title,category:'Power',itemType:'battery',active:true,stockMappingStatus:'complete',marketingOnly:false,components:[{inventoryUnitId:unit._id,qty}],pricing:{daily},depositAmount:value});
const wanted=listing('V-mount Batteries 2x 95Wh',small,2,160,10),two=listing('FXLION Nano Three V-Mount Batteries (2x) 150Wh',large,2,400,15),four=listing('V-mount Batteries 4x 150Wh',large,4,800,30),wrong=listing('2x NP-F970 batteries',npf,2,100,1);
const start=Date.UTC(2030,0,1),end=start+86400000,items=[{key:'small',listingId:wanted._id,start,end}];
h.put('reservations',{inventoryUnitId:small._id,start,end,qty:2,status:'confirmed'});
(async()=>{
 const result=await cart.forCart.handler({db:h.db},{items});assert.deepEqual(new Set(result.small.map(r=>r.listingId)),new Set([two._id,four._id]));assert(!result.small.some(r=>r.listingId===wrong._id));
 const sets=await cart.sets.handler({db:h.db},{items,sourceKey:'small',limit:2});assert.equal(sets.requested,2);assert.equal(sets.options.length,2);assert(sets.options.every(o=>o.items.length===1),'A 4-battery upgrade is offered as one real pack, not four mismatched cart rows');
 const b={securityPolicyVersion:policy.ASSESSMENT_SECURITY_POLICY_VERSION,depositAmount:20,lineItems:[{listingId:wanted._id,qty:1}],replacementValues:[{listingId:wanted._id,unitPence:16000}]};
 assert(replacementCompatible(wanted,two,b));assert(replacementCompatible(wanted,four,b));assert(!replacementCompatible(wanted,wrong,b));assert(!replacementCompatible(wanted,two),'Legacy agreements never silently increase exposure');
 console.log('PASS actual V-mount replacements: unavailable 2×95Wh gets real available 2×150Wh and 4×150Wh options, correct pack quantities, no NP-F substitution, unchanged cash tier and preserved legacy exposure. Synthetic stock only.');
})().catch(e=>{console.error(e);process.exitCode=1});
