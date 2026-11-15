"use client";
import { useMemo, useState, useTransition } from "react";
import { formatNaira } from "@/domain/products";
import { saveBusinessSale } from "./actions";

type Product = { id:string; name:string; size:string|null; bottles_per_crate:number; full_crate_price:number|null; bottle_price:number|null; available:number };
type Customer = { id:string; name:string; empties_deposit_required:boolean };
type Line = { productId:string; crates:number; bottles:number };

export function BusinessSaleForm({businessId,businessDate,products,customers,initialRequestId}:{
  businessId:string; businessDate:string; products:Product[]; customers:Customer[]; initialRequestId:string;
}) {
  const [requestId,setRequestId]=useState(initialRequestId);
  const [customerId,setCustomerId]=useState("");
  const [productId,setProductId]=useState(products[0]?.id??"");
  const [crates,setCrates]=useState("1");
  const [bottles,setBottles]=useState("0");
  const [lines,setLines]=useState<Line[]>([]);
  const [paid,setPaid]=useState("0");
  const [method,setMethod]=useState<"cash"|"transfer"|"pos">("cash");
  const [message,setMessage]=useState("");
  const [saved,setSaved]=useState<{id:string;total:number;paid:number;owing:number}|null>(null);
  const [busy,startTransition]=useTransition();
  const customer=customers.find(c=>c.id===customerId);
  const total=useMemo(()=>lines.reduce((sum,line)=>{
    const p=products.find(x=>x.id===line.productId);
    return !p?sum:sum+line.crates*(p.full_crate_price??0)+line.bottles*(p.bottle_price??0);
  },0),[lines,products]);

  function addLine() {
    setMessage("");
    const p=products.find(x=>x.id===productId);
    const c=Number(crates), b=Number(bottles);
    if(!p||!/^\d+$/.test(crates)||!/^\d+$/.test(bottles)||
       !Number.isSafeInteger(c)||!Number.isSafeInteger(b)||c<0||b<0||c+b<1) {
      setMessage("Enter a valid whole-crate or bottle quantity."); return;
    }
    if((c>0&&p.full_crate_price===null)||(b>0&&p.bottle_price===null)) {
      setMessage("A selling price is missing. Fix this drink's price before selling."); return;
    }
    const qty=c*p.bottles_per_crate+b;
    if(!Number.isSafeInteger(qty)||qty>p.available) {
      setMessage(`Only ${p.available} bottles are currently available for ${p.name}.`); return;
    }
    if(lines.some(x=>x.productId===p.id)) {
      setMessage("This drink is already in the sale. Remove it first to change its quantity."); return;
    }
    setLines(old=>[...old,{productId:p.id,crates:c,bottles:b}]);
  }

  function submit() {
    setMessage(""); setSaved(null);
    if(!customerId){setMessage("Choose a customer.");return;}
    if(!lines.length){setMessage("Add at least one drink.");return;}
    if(customer?.empties_deposit_required) {
      setMessage("This customer requires an empties deposit. This checkout does not yet support returned-container or deposit handling."); return;
    }
    if(!/^\d+$/.test(paid)||!Number.isSafeInteger(Number(paid))||Number(paid)<0||Number(paid)>total) {
      setMessage("Enter an amount received between ₦0 and the sale total.");return;
    }
    startTransition(async()=>{
      const result=await saveBusinessSale({businessId,requestId,customerId,businessDate,paid:Number(paid),paymentMethod:method,lines});
      if(result.error){setMessage(result.error);return;}
      if(result.result){
        setSaved(result.result);setLines([]);setPaid("0");setCustomerId("");setRequestId(crypto.randomUUID());
      }
    });
  }

  return <div className="space-y-5">
    <section className="space-y-2">
      <label className="block text-sm font-semibold" htmlFor="business-sale-customer">Customer</label>
      <select id="business-sale-customer" className="w-full" value={customerId} onChange={e=>setCustomerId(e.target.value)}>
        <option value="">Choose customer</option>
        {customers.map(c=><option key={c.id} value={c.id}>{c.name}{c.empties_deposit_required?" · deposit required":""}</option>)}
      </select>
    </section>
    <section className="space-y-3 rounded-2xl border border-stone-200 p-4">
      <h2 className="font-bold">Add drinks</h2>
      <label className="block text-sm font-semibold" htmlFor="business-sale-product">Drink</label>
      <select id="business-sale-product" className="w-full" value={productId} onChange={e=>setProductId(e.target.value)}>
        {products.map(p=><option key={p.id} value={p.id}>{p.name}{p.size?` · ${p.size}`:""}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">Full crates<input className="mt-1 w-full" type="number" inputMode="numeric" min="0" step="1" value={crates} onChange={e=>setCrates(e.target.value)}/></label>
        <label className="text-sm">Loose bottles<input className="mt-1 w-full" type="number" inputMode="numeric" min="0" step="1" value={bottles} onChange={e=>setBottles(e.target.value)}/></label>
      </div>
      <p className="text-xs text-stone-600">First version: full crates and loose bottles only. Partial crates and returned empties are not included.</p>
      <button type="button" className="secondary min-h-11 w-full" onClick={addLine}>Add drink to sale</button>
    </section>
    {lines.length>0&&<section className="rounded-2xl bg-stone-100 p-4">
      <h2 className="font-bold">Sale summary</h2>
      <ul className="mt-2 divide-y divide-stone-200">
        {lines.map(line=>{
          const p=products.find(x=>x.id===line.productId)!;
          const amount=line.crates*(p.full_crate_price??0)+line.bottles*(p.bottle_price??0);
          return <li key={line.productId} className="flex items-start justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">{p.name} · {line.crates} crates + {line.bottles} bottles</span>
            <strong className="shrink-0 tabular-nums">{formatNaira(amount)}</strong>
            <button type="button" className="quiet-link" onClick={()=>setLines(old=>old.filter(x=>x.productId!==line.productId))}>Remove</button>
          </li>;
        })}
      </ul>
      <div className="mt-3 flex justify-between border-t border-stone-300 pt-3 font-bold"><span>Total</span><span className="tabular-nums">{formatNaira(total)}</span></div>
    </section>}
    <section className="space-y-3">
      <h2 className="font-bold">Payment</h2>
      <label className="block text-sm">Amount received (₦)<input className="mt-1 w-full" type="number" inputMode="numeric" min="0" step="1" value={paid} onChange={e=>setPaid(e.target.value)}/></label>
      <label className="block text-sm">Payment method<select className="mt-1 w-full" value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos">POS</option></select></label>
      <p className="text-sm text-stone-600">Any unpaid amount becomes this customer&apos;s debt. Collect old debt separately.</p>
    </section>
    {message&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    {saved&&<div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm">
      <p className="font-bold">Sale recorded</p><p className="mt-1">Total: {formatNaira(saved.total)} · Received: {formatNaira(saved.paid)} · Owing: {formatNaira(saved.owing)}</p><p className="mt-1 text-xs">Sale reference: {saved.id}</p>
    </div>}
    <button type="button" disabled={busy||!lines.length} className="primary min-h-12 w-full disabled:opacity-50" onClick={submit}>{busy?"Recording sale…":"Record sale"}</button>
  </div>;
}
