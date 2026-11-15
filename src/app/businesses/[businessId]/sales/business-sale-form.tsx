"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { formatNaira } from "@/domain/products";
import { saveBusinessSale } from "./actions";

type Product = { id:string; name:string; size:string|null; bottles_per_crate:number; full_crate_price:number|null; bottle_price:number|null; available:number; crate_type_id:string; crate_type_name:string; bottles_returnable:boolean; bottle_type:string|null };
type Line = { productId:string; crates:number; bottles:number; returnedCrates:number; returnedBottles:number };
type Customer = { id:string; name:string; empties_deposit_required:boolean };


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
    setLines(old=>[...old,{productId:p.id,crates:c,bottles:b,returnedCrates:0,returnedBottles:0}]);
  }

  function submit() {
    setMessage(""); setSaved(null);
    if(!customerId){setMessage("Choose a customer.");return;}
    if(!lines.length){setMessage("Add at least one drink.");return;}
    const invalidReturnedEmpties = lines.some(line=>{
      const p=products.find(item=>item.id===line.productId);
      const maxBottles=p?.bottles_returnable?(line.crates*(p.bottles_per_crate)+line.bottles):0;
      return !p||!Number.isSafeInteger(line.returnedCrates)||line.returnedCrates<0||line.returnedCrates>line.crates||
        !Number.isSafeInteger(line.returnedBottles)||line.returnedBottles<0||line.returnedBottles>maxBottles;
    });
    if(invalidReturnedEmpties){setMessage("Returned empties must be whole numbers and cannot exceed the containers expected from this sale.");return;}
    const hasEmptyShortage = lines.some(line=>{
      const p=products.find(item=>item.id===line.productId);
      if(!p) return true;
      const expectedBottles=p.bottles_returnable?line.crates*p.bottles_per_crate+line.bottles:0;
      return line.returnedCrates<line.crates||line.returnedBottles<expectedBottles;
    });
    if(customer?.empties_deposit_required&&hasEmptyShortage) {
      setMessage("This customer requires all expected empty crates and bottles to be returned. Deposit handling for shortages is not enabled yet."); return;
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
      <p className="text-xs text-stone-600">First version: full crates and loose bottles only. Record exact same-type empty crates and bottles returned below; swaps are not included.</p>
      <button type="button" className="secondary min-h-11 w-full" onClick={addLine}>Add drink to sale</button>
    </section>
    {lines.length>0&&<section className="rounded-2xl bg-stone-100 p-4">
      <h2 className="font-bold">Sale summary</h2>
      <p className="mt-2 text-xs text-stone-600">Enter the empty containers physically returned now. Any missing containers remain owed by the customer. Count only the exact crate and bottle types named under each drink. Different brands or types need a swap workflow, which is not included yet.</p>
      <ul className="mt-2 divide-y divide-stone-200">
        {lines.map(line=>{
          const p=products.find(x=>x.id===line.productId)!;
          const amount=line.crates*(p.full_crate_price??0)+line.bottles*(p.bottle_price??0);
          return <li key={line.productId} className="flex items-start justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">{p.name} · {line.crates} crates + {line.bottles} bottles
              <span className="mt-1 block text-xs text-stone-500">Expected: {line.crates} {p.crate_type_name} crate(s)</span>
              {p.bottles_returnable&&<span className="block text-xs text-stone-500">Expected: {line.crates*p.bottles_per_crate+line.bottles} {p.bottle_type} bottle(s)</span>}
              <span className="mt-3 grid grid-cols-2 gap-2">
                {line.crates>0&&<label className="text-xs">{p.crate_type_name} crates returned<input aria-label="Matching empty crates returned" className="mt-1 w-full" type="number" min="0" max={line.crates} step="1" value={line.returnedCrates} onChange={e=>setLines(old=>old.map(x=>x.productId===line.productId?{...x,returnedCrates:Number(e.target.value||0)}:x))}/></label>}
                {p.bottles_returnable&&<label className="text-xs">{p.bottle_type} bottles returned<input aria-label="Matching empty bottles returned" className="mt-1 w-full" type="number" min="0" max={line.crates*p.bottles_per_crate+line.bottles} step="1" value={line.returnedBottles} onChange={e=>setLines(old=>old.map(x=>x.productId===line.productId?{...x,returnedBottles:Number(e.target.value||0)}:x))}/></label>}
              </span>
            </span>
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
      <p className="font-bold">Sale recorded</p><p className="mt-1">Total: {formatNaira(saved.total)} · Received: {formatNaira(saved.paid)} · Owing: {formatNaira(saved.owing)}</p>
      <Link className="primary mt-3 inline-flex min-h-11 items-center justify-center" href={`/businesses/${businessId}/sales/${saved.id}/receipt`}>View and share receipt →</Link>
    </div>}
    <button type="button" disabled={busy||!lines.length} className="primary min-h-12 w-full disabled:opacity-50" onClick={submit}>{busy?"Recording sale…":"Record sale"}</button>
  </div>;
}
