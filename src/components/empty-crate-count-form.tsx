"use client";
import { useActionState, useState } from "react";
import {
  reviewEmptyCrateCount,
  confirmEmptyCrateCount,
} from "@/app/(shop)/empty-crates/count/actions";
import type { EmptyCrateCountState } from "@/domain/empty-crates";
import { emptyCrateQuantity } from "@/domain/empty-crates";

function ConfirmEmptyCrateCount({
  crateTypeId,
  requestId,
  review,
  onBack,
}: {
  crateTypeId: string;
  requestId: string;
  review: NonNullable<EmptyCrateCountState["review"]>;
  onBack: () => void;
}) {
  const [state, action, pending] = useActionState(
    confirmEmptyCrateCount.bind(null, crateTypeId, requestId, review),
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
          <dd>{emptyCrateQuantity(review.previousQuantity)}</dd>
        </div>
        <div>
          <dt>Counted in the shop</dt>
          <dd className="font-semibold">
            {emptyCrateQuantity(review.quantity)}
          </dd>
        </div>
      </dl>
      <p>This replaces the recorded empty-crate count for this exact type.</p>
      {state.message && (
        <p role="alert" className="text-red-800">
          {state.message}
        </p>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : "Save Current Count"}
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
export function EmptyCrateCountForm({
  crateTypeId,
  requestId,
}: {
  crateTypeId: string;
  requestId: string;
}) {
  const [submissionId] = useState(requestId);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({
    quantity: "",
    businessDate: "",
  });
  const [state, action, pending] = useActionState(
    reviewEmptyCrateCount.bind(null, crateTypeId),
    { ...values } as EmptyCrateCountState,
  );
  if (state.review && !editing && !pending)
    return (
      <ConfirmEmptyCrateCount
        crateTypeId={crateTypeId}
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
        <label htmlFor="quantity">Empty crates in the shop</label>
        <input
          id="quantity"
          name="quantity"
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={10}
          required
          value={values.quantity}
          readOnly={pending}
          onChange={(e) => setValues({ ...values, quantity: e.target.value })}
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
        {pending ? "Checking…" : "Review count"}
      </button>
    </form>
  );
}
