"use client";
import { useActionState, useState } from "react";
import {
  reviewCount,
  confirmCount,
} from "@/app/(shop)/stock/count/[id]/actions";
import type { StockCountState } from "@/domain/stock-count";
import { formatQuantity } from "@/domain/quantity";

function ConfirmCount({
  productId,
  requestId,
  review,
  onBack,
}: {
  productId: string;
  requestId: string;
  review: NonNullable<StockCountState["review"]>;
  onBack: () => void;
}) {
  const [state, action, pending] = useActionState(
    confirmCount.bind(null, productId, requestId, review),
    { message: "" },
  );
  return (
    <form action={action} className="mt-6 space-y-5">
      <h2 className="text-xl font-semibold">Check the current count</h2>
      <dl className="space-y-4">
        <div>
          <dt>Business date</dt>
          <dd>{review.businessDate}</dd>
        </div>
        <div>
          <dt>Previously recorded</dt>
          <dd>{formatQuantity(review.stock, review.bottlesPerCrate)}</dd>
        </div>
        <div>
          <dt>Counted in the shop</dt>
          <dd className="font-semibold">
            {formatQuantity(review.stockAfter, review.bottlesPerCrate)}
          </dd>
        </div>
      </dl>
      <p>
        This replaces the recorded drinks stock. Empty crates stay unchanged.
      </p>
      {state.message && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Save Current Stock"}
      </button>
      <button
        type="button"
        className="secondary w-full"
        disabled={pending}
        onClick={onBack}
      >
        Change / review again
      </button>
    </form>
  );
}
export function StockCountForm({
  productId,
  requestId,
}: {
  productId: string;
  requestId: string;
}) {
  const [submissionId] = useState(requestId);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({
    crates: "",
    bottles: "0",
    businessDate: "",
  });
  const [state, action, pending] = useActionState(
    reviewCount.bind(null, productId),
    { ...values } as StockCountState,
  );
  if (state.review && !editing && !pending)
    return (
      <ConfirmCount
        productId={productId}
        requestId={submissionId}
        review={state.review}
        onBack={() => setEditing(true)}
      />
    );
  return (
    <form
      action={action}
      className="mt-6 space-y-5"
      onSubmit={() => setEditing(false)}
    >
      <div>
        <label htmlFor="crates">Whole crates in the shop</label>
        <input
          id="crates"
          name="crates"
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={10}
          required
          value={values.crates}
          readOnly={pending}
          onChange={(e) => setValues({ ...values, crates: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="bottles">Loose bottles</label>
        <input
          id="bottles"
          name="bottles"
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={10}
          required
          value={values.bottles}
          readOnly={pending}
          onChange={(e) => setValues({ ...values, bottles: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="businessDate">Business date</label>
        <input
          id="businessDate"
          name="businessDate"
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          required
          value={values.businessDate}
          readOnly={pending}
          onChange={(e) =>
            setValues({ ...values, businessDate: e.target.value })
          }
        />
      </div>
      {state.message && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending ? "Checking…" : "Review stock count"}
      </button>
    </form>
  );
}
