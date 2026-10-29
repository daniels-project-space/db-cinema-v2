/** Browser-only controlled transport. Runs the actual query + actual consumers;
 * no fixture route, hooks or data are shipped with the application. */
import React, {useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {options} from '../../convex/liveRecommendations';
import {forContext} from '../../convex/recommendations';
import {Recommendations} from '../../src/components/Recommendations';
import {BotBubble} from '../../src/components/BotBubble';
import Assemble from '../../src/app/assemble/page';

let version=0,dbVersion=0,mode='recommendations',counter=0;
const listeners=new Set<()=>void>(),records=new Map<string,any>(),tables=new Map<string,any[]>(),cache=new Map<string,any>();
const notify=()=>{version++;for(const f of listeners)f();};
const subscribe=(f:()=>void)=>{listeners.add(f);return()=>listeners.delete(f);};
const put=(table:string,data:any)=>{const row={_id:`${table}-${++counter}`,_creationTime:counter,...data};records.set(row._id,row);tables.set(table,[...(tables.get(table)??[]),row]);return row;};
const unit=(name:string)=>put('inventory_units',{name,quantityOwned:1});
const listing=(id:string,type:string,title:string,extra:any={})=>put('listings',{_id:id,active:true,itemType:type,category:type,title,slug:id,components:[{inventoryUnitId:unit(title)._id,qty:1}],pricing:{daily:20},depositAmount:500,r2Images:['/placeholder.svg'],...extra});
const ef=listing('ef-body','camera-body','Blackmagic Pocket 6K + Canon zoom and monitor',{specs:{mount:'EF',coverage:'s35',batteryType:'NP-F570'},inventoryFacts:{owned:true,reviewRequired:false,contents:['Canon EF 24–105mm f/4 L lens','External monitor']}});
const sony=listing('e-body','camera-body','Sony A7 V + wide zoom',{specs:{mount:'E',coverage:'ff',batteryType:'NP-FZ100'},inventoryFacts:{owned:true,reviewRequired:false,contents:['Sony FE 16–35mm f/2.8 GM (original)']}});
const fxBody=listing('fx3-body','camera-body','Sony FX3 Body Kit with Cage and Card',{marketingOnly:false,marketingOnlySource:'rental_manager',demandScore:1,specs:{mount:'E',coverage:'ff'},inventoryFacts:{owned:true,reviewRequired:false,contents:['1 × Sony FX3 camera']}});
listing('fx3-bundle','camera-body','Sony FX3 with 24–70mm GM Lens',{marketingOnly:false,marketingOnlySource:'rental_manager',demandScore:999,specs:{mount:'E',coverage:'ff',includesLens:true},inventoryFacts:{owned:true,reviewRequired:false,contents:['1 × Sony FX3 camera','1 × Sony 24–70mm lens']}});
const plCamera=listing('pl-camera','camera-body','Blackmagic URSA PL Camera',{marketingOnly:false,marketingOnlySource:'rental_manager',specs:{mount:'PL',coverage:'ff'},inventoryFacts:{owned:true,reviewRequired:false,contents:['1 × Blackmagic URSA camera']}});
const remus=listing('remus-45','lens','Blazar Remus 45mm PL Lens',{marketingOnly:false,marketingOnlySource:'rental_manager',specs:{mount:'PL',coverage:'ff',lensFocal:'45'},inventoryFacts:{owned:true,reviewRequired:false,contents:['1 × Blazar Remus 45mm lens']}});
const efLens=listing('ef-prime','lens','Canon EF 50mm prime',{specs:{mount:'EF',coverage:'ff',lensFocal:'50',lensClass:'af'}});
const eLens=listing('e-prime','lens','Sony FE 90mm f/2.8 Macro G OSS',{specs:{mount:'E',coverage:'ff',lensFocal:'90',lensClass:'af'}});
const light=listing('key-light','light','Nanlite key light',{demandScore:100});
const spare=listing('spare-light','light','Nanlite fill light',{demandScore:10});
const monitor=listing('monitor','monitor','External monitor');
const bag=listing('carry-bag','accessory','Carry bag');
ef.components.push(...monitor.components);
const now=new Date(),start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,20)).toISOString().slice(0,10),end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,21)).toISOString().slice(0,10);
const period={start,end,pickupTime:'10:00',returnTime:'17:00'};
const cartItem=(l:any)=>({listingId:l._id,key:l._id,slug:l.slug,title:l.title,...period,days:2,total:l.pricing.daily*2,perDay:l.pricing.daily,deposit:l.depositAmount});
let basket=[cartItem(ef),cartItem(bag)];
class Rows{
 rows:any[];constructor(table:string){this.rows=[...(tables.get(table)??[])];}
 withIndex(_:string,build:any){const conditions:any[]=[];const q:any={eq:(k:string,v:any)=>{conditions.push([k,v]);return q;}};build?.(q);this.rows=this.rows.filter(r=>conditions.every(([k,v])=>r[k]===v));return this;}
 async collect(){return this.rows;}async first(){return this.rows[0]??null;}async take(n:number){return this.rows.slice(0,n);}order(){return this;}
}
const ctx={db:{get:async(id:any)=>records.get(String(id))??null,query:(table:string)=>new Rows(table)}};
export function useFixtureQuery(path:any,args:any){
 useSyncExternalStore(subscribe,()=>version,()=>version);
 if(args==='skip')return undefined;
 const key=String(path)+JSON.stringify(args)+':'+dbVersion;
 if(!cache.has(key)){
  cache.set(key,{value:undefined});
  const handler=String(path)==='liveRecommendations.options'?(options as any).handler:String(path)==='recommendations.forContext'?(forContext as any).handler:null;
  if(!handler)throw Error('Unexpected fixture query '+String(path));
  Promise.resolve(handler(ctx,args)).then(value=>{cache.set(key,{value});notify();}).catch(error=>{console.error(error);(window as any).fixture.error=String(error);});
 }
 return cache.get(key).value;
}
export function useFixtureCart(){
 useSyncExternalStore(subscribe,()=>version,()=>version);
 return {items:basket,add:(item:any)=>{basket=[...basket,{...item,key:item.key??item.listingId}];notify();},remove:(key:string)=>{basket=basket.filter(i=>i.key!==key);notify();},switchItem:(key:string,item:any)=>{basket=basket.map(i=>i.key===key?{...item,key}:i);notify();}};
}
const card=(l:any)=>({kind:'add',reason:'Original planned choice',item:{...cartItem(l),image:null,itemType:l.itemType,available:true}});
const requestCounts={model:0};const originalFetch=window.fetch;window.fetch=(input:any,args:any)=>String(input)==='/api/assemble'?(requestCounts.model++,Promise.resolve(new Response(JSON.stringify({reply:'Build your kit',stages:mode==='assembly-constraint'||mode==='assembly-constraint-empty'?[{key:'camera',label:'camera',recommendedId:mode==='assembly-constraint-empty'?'':fxBody._id,cameraPreferredId:fxBody._id,cameraConstraint:{model:'fx3',brief:'FX3 camera body only, no lens or gimbal',strict:true,count:1},options:[],note:'Choose your equipment'}]:mode==='assembly-lens-constraint'?[{key:'camera',label:'camera',recommendedId:plCamera._id,cameraConstraint:{model:'',brief:'Blazar Remus 45mm PL lens',strict:false,count:1,requiresLens:true,requestedLens:remus},options:[],note:'Choose your equipment'},{key:'lens',label:'lens',recommendedId:remus._id,briefPreferredId:remus._id,briefConstraint:{tokens:['blazar','remus','45mm','pl']},options:[],note:'Choose your equipment'}]:['camera','lens','light','monitor'].map(key=>({key,label:key,recommendedId:key==='camera'?ef._id:undefined,options:[],note:'Choose your equipment'})),compatibilityKits:[]})))):String(input)==='/api/bot'?(requestCounts.model++,Promise.resolve(new Response(JSON.stringify({reply:'Here are choices for your kit.',cards:[card(light),card(efLens)]})))):originalFetch(input,args);
(window as any).fixture={
 counts:requestCounts,
 clearBasket:()=>{basket=[];notify();},
 spawnLight:()=>{const row=listing('new-light-'+(++counter),'light','New rental light',{demandScore:1000});dbVersion++;notify();return row._id;},
 setMode:(value:string)=>{mode=value;notify();},
 basket:(id:string)=>{basket=[cartItem(records.get(id)),cartItem(bag)];notify();},
 getBasket:()=>basket,
 patch:(id:string,patch:any)=>{Object.assign(records.get(id),patch);dbVersion++;notify();},
 hold:(id:string,ms:number)=>{const l=records.get(id);put('reservations',{inventoryUnitId:l.components[0].inventoryUnitId,start:Date.parse(start+'T00:00:00Z'),end:Date.parse(end+'T00:00:00Z'),qty:1,status:'hold',holdExpiresAt:Date.now()+ms});dbVersion++;notify();},
 release:()=>{tables.set('reservations',[]);dbVersion++;notify();},
 reset:()=>{tables.set('reservations',[]);basket=[cartItem(ef),cartItem(bag)];localStorage.clear();dbVersion++;mode='recommendations';notify();},
 ids:{ef:ef._id,e:sony._id,light:light._id,spare:spare._id,efLens:efLens._id,eLens:eLens._id},
};
function App(){useSyncExternalStore(subscribe,()=>version,()=>version);return mode.startsWith('assembly')?<Assemble key={mode}/>:mode==='chat'?<BotBubble/>:<Recommendations start={start} end={end} days={2}/>;}
createRoot(document.getElementById('root')!).render(<App/>);
