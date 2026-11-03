import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { accountForToken } from "./lib/rentalChat";
import { strictDepositWaiver } from "./lib/strictDepositWaiver";

export const quote=internalQuery({args:{token:v.string(),valuePence:v.number()},handler:async(ctx,{token,valuePence})=>{
  const account=await accountForToken(ctx,token,true);
  return strictDepositWaiver(ctx,account,valuePence);
}});
