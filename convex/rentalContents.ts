import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { checkAdminToken } from './adminAuth';
import {canonicalCatalogValue,catalogCopyFingerprint} from '../shared/catalogCopy';

/** Read-only Hygglo acquisition is performed by the maintenance script. Only
 * this authenticated boundary can attach its evidence to an exact product. */
export const apply = mutation({
  args:{token:v.string(),requestId:v.optional(v.string()),items:v.array(v.object({productId:v.number(),listingTitle:v.string(),reviewedCopy:v.optional(v.object({expectedFingerprint:v.string(),title:v.optional(v.string()),description:v.string(),knowledge:v.object({summary:v.string(),features:v.array(v.string()),limits:v.array(v.string()),bestFor:v.array(v.string()),tips:v.array(v.string()),pairsWith:v.array(v.string())}),review:v.object({sourceAccount:v.string(),sourceProductId:v.number(),identityReview:v.string(),firstFactReview:v.string(),secondFactReview:v.string(),ownerCorrections:v.optional(v.string())})})),contents:v.object({
    included:v.array(v.string()),optional:v.array(v.string()),excluded:v.array(v.string()),notes:v.array(v.string()),
    status:v.union(v.literal('documented'),v.literal('unknown')),
    sources:v.array(v.object({account:v.string(),productId:v.number(),url:v.string(),checkedAt:v.number(),excerpt:v.string()})),
  })}))},
  handler:async(ctx,{token,items,requestId})=>{
    if(!checkAdminToken(token)) throw new Error('Unauthorized');
    if(items.length>50) throw new Error('Batch limit is 50');
    if(items.some(item=>item.reviewedCopy)&&(!requestId||! /^[a-zA-Z0-9-]{16,80}$/.test(requestId)))throw Error('Reviewed copy needs a stable publishing request identity');
    const fingerprint=requestId?canonicalCatalogValue(items):null;
    if(requestId){const receipt=await ctx.db.query('catalog_copy_batches').withIndex('by_request',q=>q.eq('requestId',requestId)).unique();if(receipt){if(receipt.inputFingerprint!==fingerprint)throw Error('This copy publishing request has different particulars');return {updated:receipt.updated,replayed:true};}}
    let updated=0;
    for(const item of items){
      const listing=await ctx.db.query('listings').withIndex('by_hyggloProductId',q=>q.eq('hyggloProductId',item.productId)).unique();
      if(!listing) throw new Error('Source product is not in the storefront');
      if(listing.title!==item.listingTitle) throw new Error('Listing configuration changed; reacquire its contents before applying');
      if(!item.contents.sources.every(s=>['diogo','dbcinema'].includes(s.account)&&/^https:\/\/(?:www\.)?hygglo\.com\//.test(s.url))) throw new Error('Invalid contents source');
      if(item.contents.status==='documented'&&!item.contents.sources.length) throw new Error('Documented contents need evidence');
      const copy=item.reviewedCopy;
      if(listing.copyReview&&!copy)throw Error('Reviewed catalog copy cannot be overwritten by an unreviewed contents import');
      if(copy){
        if(catalogCopyFingerprint(listing)!==copy.expectedFingerprint)throw Error('Listing copy or kit identity changed; review the current record before publishing');
        if(copy.title!==undefined&&(copy.title.trim().length<10||copy.title.length>200||copy.title!==copy.title.trim()))throw Error('A clear reviewed listing title is required');
        if(copy.description.trim().length<20||copy.description.length>3000||copy.knowledge.summary.trim().length<10||copy.knowledge.summary.length>500)throw Error('A concise, reviewed description and summary are required');
        if(![copy.review.identityReview,copy.review.firstFactReview,copy.review.secondFactReview].every(s=>s.trim().length>=20&&s.length<=3000))throw Error('Both fact reviews and the exact offer identity review must be recorded');
        if(!item.contents.sources.some(s=>s.account===copy.review.sourceAccount&&s.productId===copy.review.sourceProductId))throw Error('The copy review must reference its attached seller evidence');
        await ctx.db.patch(listing._id,{title:copy.title??listing.title,description:copy.description,knowledge:copy.knowledge,rentalContents:item.contents,copyReview:{...copy.review,sourceTitle:listing.copyReview?.sourceTitle??listing.title,...(listing.copySourceFingerprint?{sourceFingerprint:listing.copySourceFingerprint}:{}),reviewedAt:Date.now()}});
      }else await ctx.db.patch(listing._id,{rentalContents:item.contents});updated++;
    }
    if(requestId)await ctx.db.insert('catalog_copy_batches',{requestId,inputFingerprint:fingerprint!,updated,appliedAt:Date.now()});
    return {updated};
  },
});
