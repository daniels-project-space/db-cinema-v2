import type {Metadata} from "next";
import {OperatorCancellationChoice} from "@/components/account/OperatorCancellationChoice";
export const metadata:Metadata={title:"Cancelled rental · choose your settlement",robots:{index:false,follow:false,noarchive:true},referrer:"no-referrer"};
export default function CancellationChoicePage(){return <main className="mx-auto min-h-dvh max-w-2xl px-5 py-12"><a href="/" className="text-xs tracking-[.3em] text-accent-400">DB CINEMA RENTALS</a><OperatorCancellationChoice/></main>;}
