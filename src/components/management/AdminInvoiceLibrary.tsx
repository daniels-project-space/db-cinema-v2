"use client";
import {usePaginatedQuery} from "convex/react";
import {api} from "@cvx/_generated/api";
import {InvoiceLibrary} from "./InvoiceLibrary";
export function AdminInvoiceLibrary({token}:{token:string}){
  const pages=usePaginatedQuery(api.bookings.adminInvoicePage,{token},{initialNumItems:10});
  return <InvoiceLibrary key={token} token={token} admin rentals={pages.status==="LoadingFirstPage"?undefined:pages.results} hasMore={pages.status==="CanLoadMore"} loadingMore={pages.status==="LoadingMore"} onLoadMore={()=>pages.loadMore(10)}/>;
}
