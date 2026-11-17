"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { confirmBusinessReceiving, reviewBusinessReceiving, type BusinessReceivingSaveState } from "@/app/businesses/[businessId]/stock/receive/[productId]/actions";
import type { ReceivingState } from "@/domain/receiving";
import { formatQuantity } from "@/domain/quantity";

const reviewInitial: ReceivingState = { crates: "", businessDate: "" };
const saveInitial: BusinessReceivingSaveState = { message: "", saved: false };

export function BusinessReceiveStockForm({
  businessId, productId, requestId, businessDate, stock, empties, bottlesPerCrate,
}: {
  businessId: string;
  productId: string;
  requestId: string;
  businessDate: string;
  stock: number;
  empties: number;
  bottlesPerCrate: number;
}) {
  const [stableRequestId, setStableRequestId] = useState(requestId);
  const [crates, setCrates] = useState("");
  const [date, setDate] = useState(businessDate);
  const [editing, setEditing] = useState(false);
  const [review, reviewAction, reviewing] = useActionState(
    reviewBusinessReceiving.bind(null, businessId, productId), reviewInitial,
  );
  if (review.review && !editing && !reviewing) {
    return (
      <ConfirmBusinessReceiving
        businessId={businessId}
        productId={productId}
        requestId={stableRequestId}
        review={review.review}
        onBack={() => {
          setStableRequestId(crypto.randomUUID());
          setEditing(true);
        }}
      />
    );
  }
  return (
    <form action={reviewAction} className="space-y-4 rounded-2xl border border-stone-200 p-4">
      <div className="rounded-xl bg-stone-50 p-3 text-sm">
        <p>Stock now: <strong>{formatQuantity(stock, bottlesPerCrate)}</strong></p>
        <p>Matching empty crates: <strong>{empties.toLocaleString("en-NG")}</strong></p>
      </div>
      <label className="block text-sm font-semibold" htmlFor="business-receive-crates">
        Whole crates received
        <input id="business-receive-crates" name="crates" type="number"
          inputMode="numeric" min={1} max={empties} step={1} required
          value={crates} readOnly={reviewing} onChange={(event) => setCrates(event.target.value)}
          className="mt-2 w-full" />
      </label>
      <label className="block text-sm font-semibold" htmlFor="business-receive-date">
        Business date
        <input id="business-receive-date" name="business_date" type="date"
          min="0001-01-01" max="9999-12-31" required value={date}
          readOnly={reviewing} onChange={(event) => setDate(event.target.value)}
          className="mt-2 w-full" />
      </label>
      {review.message && <p role="alert" className="rounded-xl bg-stone-100 p-3 text-sm">{review.message}</p>}
      <button type="submit" disabled={reviewing} className="primary min-h-12 w-full disabled:opacity-50">
        {reviewing ? "Checking stock…" : "Review received stock"}
      </button>
    </form>
  );
}

function ConfirmBusinessReceiving({
  businessId, productId, requestId, review, onBack,
}: {
  businessId: string;
  productId: string;
  requestId: string;
  review: NonNullable<ReceivingState["review"]>;
  onBack: () => void;
}) {
  const [state, action, pending] = useActionState(
    confirmBusinessReceiving.bind(null, businessId, productId, requestId, review),
    saveInitial,
  );
  return (
    <section className="space-y-4 rounded-2xl border border-stone-200 p-4">
      <h2 className="text-lg font-bold">Check what came in</h2>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3"><dt>Business date</dt><dd className="font-semibold">{review.businessDate}</dd></div>
        <div className="flex justify-between gap-3"><dt>Crates received</dt><dd className="font-semibold">{review.crates}</dd></div>
        <div className="flex justify-between gap-3"><dt>Stock before</dt><dd>{formatQuantity(review.stock, review.bottlesPerCrate)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Stock after</dt><dd className="font-semibold">{formatQuantity(review.stockAfter, review.bottlesPerCrate)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Empty crates before</dt><dd>{review.empties}</dd></div>
        <div className="flex justify-between gap-3"><dt>Empty crates after</dt><dd className="font-semibold">{review.emptiesAfter}</dd></div>
      </dl>
      {state.message && (
        <div role={state.saved ? "status" : "alert"} className="rounded-xl bg-stone-100 p-3 text-sm">
          <p className="font-semibold">{state.message}</p>
          {state.saved && (
            <>
              <p className="mt-2">Updated stock: <strong>{state.stockAfter?.toLocaleString("en-NG")} bottles</strong></p>
              <p>Empty crates left: <strong>{state.emptiesAfter?.toLocaleString("en-NG")}</strong></p>
            </>
          )}
        </div>
      )}
      {state.saved ? (
        <Link href={`/businesses/${businessId}/stock`} className="primary inline-flex min-h-12 w-full items-center justify-center">
          Back to current stock
        </Link>
      ) : (
        <>
          <button type="button" onClick={onBack} disabled={pending} className="secondary min-h-11 w-full">Change amount</button>
          <button type="submit" form="business-receive-confirm-form" disabled={pending} className="primary min-h-12 w-full disabled:opacity-50">
            {pending ? "Saving receipt…" : "Save stock received"}
          </button>
          <form id="business-receive-confirm-form" action={action} />
        </>
      )}
    </section>
  );
}
