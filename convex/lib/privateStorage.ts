import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/** Storage deletion throws for already absent objects. Only the authoritative
 * metadata absence makes that safe to ignore; other storage failures propagate. */
export async function deletePrivateFile(ctx:MutationCtx,storageId:Id<"_storage">){
 try{await ctx.storage.delete(storageId);}
 catch(error){if(await ctx.db.system.get(storageId))throw error;}
}
