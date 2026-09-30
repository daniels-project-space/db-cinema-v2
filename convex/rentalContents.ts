import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { checkAdminToken } from './adminAuth';

/** Read-only Hygglo acquisition is performed by the maintenance script. Only
 * this authenticated boundary can attach its evidence to an exact product. */
export const apply = mutation({
  args:{token:v.string(),items:v.array(v.object({productId:v.number(),listingTitle:v.string(),contents:v.object({
    included:v.array(v.string()),optional:v.array(v.string()),excluded:v.array(v.string()),notes:v.array(v.string()),
    status:v.union(v.literal('documented'),v.literal('unknown')),
    sources:v.array(v.object({account:v.string(),productId:v.number(),url:v.string(),checkedAt:v.number(),excerpt:v.string()})),
  })}))},
  handler:async(ctx,{token,items})=>{
    if(!checkAdminToken(token)) throw new Error('Unauthorized');
    if(items.length>50) throw new Error('Batch limit is 50');
    let updated=0;
    for(const item of items){
      const listing=await ctx.db.query('listings').withIndex('by_hyggloProductId',q=>q.eq('hyggloProductId',item.productId)).unique();
      if(!listing) throw new Error('Source product is not in the storefront');
      if(listing.title!==item.listingTitle) throw new Error('Listing configuration changed; reacquire its contents before applying');
      if(!item.contents.sources.every(s=>['diogo','dbcinema'].includes(s.account)&&/^https:\/\/(?:www\.)?hygglo\.com\//.test(s.url))) throw new Error('Invalid contents source');
      if(item.contents.status==='documented'&&!item.contents.sources.length) throw new Error('Documented contents need evidence');
      await ctx.db.patch(listing._id,{rentalContents:item.contents});updated++;
    }
    return {updated};
  },
});
