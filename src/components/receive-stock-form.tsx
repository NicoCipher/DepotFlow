"use client";
import { useActionState, useState } from "react";
import {
  reviewReceiving,
  confirmReceiving,
} from "@/app/(shop)/stock/receive/[id]/actions";
import type { ReceivingState } from "@/domain/receiving";
import { formatQuantity } from "@/domain/quantity";

function ConfirmReceiving({
  productId,
  requestId,
  review,
  onBack,
}: {
  productId: string;
  requestId: string;
  review: NonNullable<ReceivingState["review"]>;
  onBack: () => void;
}) {
  const [state, action, pending] = useActionState(
    confirmReceiving.bind(null, productId, requestId, review),
    { message: "" },
  );
  return (
    <form action={action} className="mt-6 space-y-5">
      <h2 className="text-xl font-semibold">Check what came in</h2>
      <dl className="space-y-4">
        <div>
          <dt>Crates received</dt>
          <dd className="font-semibold">{review.crates}</dd>
        </div>
        <div>
          <dt>Stock before</dt>
          <dd>{formatQuantity(review.stock, review.bottlesPerCrate)}</dd>
        </div>
        <div>
          <dt>Stock after receiving</dt>
          <dd className="font-semibold">
            {formatQuantity(review.stockAfter, review.bottlesPerCrate)}
          </dd>
        </div>
        <div>
          <dt>Empty crate type</dt>
          <dd className="break-words">{review.crateType}</dd>
        </div>
        <div>
          <dt>Empty crates left</dt>
          <dd>
            {review.empties} − {review.crates} = {review.emptiesAfter}
          </dd>
        </div>
      </dl>
      {state.message && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Save Stock Received"}
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
export function ReceiveStockForm({
  productId,
  requestId,
}: {
  productId: string;
  requestId: string;
}) {
  // Keep the receiving ID stable across server-action re-renders and retries.
  const [submissionId] = useState(requestId);
  const [editing, setEditing] = useState(false);
  const [crates, setCrates] = useState("");
  const [state, action, pending] = useActionState(
    reviewReceiving.bind(null, productId),
    { crates: "" } as ReceivingState,
  );
  if (state.review && !editing && !pending)
    return (
      <ConfirmReceiving
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
        <label htmlFor="crates">Whole crates received</label>
        <input
          id="crates"
          name="crates"
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={10}
          required
          value={crates}
          readOnly={pending}
          onChange={(event) => setCrates(event.target.value)}
        />
      </div>
      {state.message && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending ? "Checking…" : "Review stock"}
      </button>
    </form>
  );
}
