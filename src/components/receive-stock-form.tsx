"use client";
import { SessionRecoveryLink } from "./session-recovery-link";
import { ReviewSaveActions } from "./review-save-actions";
import { useActionState, useState } from "react";
import {
  reviewReceiving,
  confirmReceiving,
} from "@/app/(shop)/stock/receive/[id]/actions";
import { receivingPreview, type ReceivingState } from "@/domain/receiving";
import { businessTodayInLagos } from "@/domain/stock-count";
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
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Step 2 of 2 · Review</p>
      <h2 className="text-xl font-semibold">Check what came in</h2>
      <dl className="review-list">
        <div>
          <dt>Business date</dt>
          <dd>{review.businessDate}</dd>
        </div>
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
          <dt>Matching empty crate type</dt>
          <dd className="break-words">
            <span className="block font-semibold">{review.crateType}</span>
            {review.crateDescription && (
              <span className="block text-sm text-stone-600">
                {review.crateDescription}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Empty crates left</dt>
          <dd>{review.empties} − {review.crates} = <strong>{review.emptiesAfter}</strong></dd>
        </div>
      </dl>
      <p className="text-sm text-stone-600">
        Saving adds these drinks and uses the matching empty crates shown above.
      </p>
      <ReviewSaveActions
        message={state.message}
        pending={pending}
        retryable={state.retryable}
        saveLabel="Save Stock Received"
        retryLabel="Retry same receiving"
        changeLabel="Change amount"
        onBack={onBack}
      />
    </form>
  );
}

export function ReceiveStockForm({
  productId,
  requestId,
  bottlesPerCrate,
  availableEmpties,
  recordedStock,
}: {
  productId: string;
  requestId: string;
  bottlesPerCrate: number;
  availableEmpties: number;
  recordedStock: number;
}) {
  const [submissionId, setSubmissionId] = useState(requestId);
  const [editing, setEditing] = useState(false);
  const [crates, setCrates] = useState("");
  const [businessDate, setBusinessDate] = useState(businessTodayInLagos);
  const [state, action, pending] = useActionState(
    reviewReceiving.bind(null, productId),
    { crates: "", businessDate: "" } as ReceivingState,
  );
  if (state.review && !editing && !pending)
    return (
      <ConfirmReceiving
        productId={productId}
        requestId={submissionId}
        review={state.review}
        onBack={() => {
          setSubmissionId(crypto.randomUUID());
          setEditing(true);
        }}
      />
    );

  const showServerError = Boolean(
    state.message && state.crates === crates && state.businessDate === businessDate,
  );
  const enteredNumber = /^\d+$/.test(crates) ? Number(crates) : null;
  const tooManyCrates = enteredNumber !== null && enteredNumber > availableEmpties;
  let preview: ReturnType<typeof receivingPreview> | null = null;
  try {
    preview = receivingPreview(crates, {
      stock: recordedStock,
      empties: availableEmpties,
      bottlesPerCrate,
      crateType: "",
      crateTypeId: "",
    });
  } catch {
    // This is a convenience estimate. The server reloads quantities for the actual review.
  }

  return (
    <form
      action={action}
      className="mt-6 space-y-5"
      onSubmit={() => setEditing(false)}
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Step 1 of 2 · Enter delivery</p>
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
          aria-invalid={tooManyCrates || (showServerError && state.field === "crates")}
          aria-describedby={tooManyCrates || (showServerError && state.field === "crates") ? "receive-crates-error" : undefined}
          onChange={(event) => setCrates(event.target.value)}
        />
        <p className="mt-1 text-xs text-stone-600">
          Up to {availableEmpties} matching empty {availableEmpties === 1 ? "crate" : "crates"} available.
        </p>
        {tooManyCrates ? (
          <p id="receive-crates-error" role="alert" className="mt-1 text-sm text-red-800">
            Only {availableEmpties} matching empty {availableEmpties === 1 ? "crate is" : "crates are"} recorded. Receive fewer crates or update empty crate counts.
          </p>
        ) : showServerError && state.field === "crates" ? (
          <p id="receive-crates-error" role="alert" className="mt-1 text-sm text-red-800">{state.message}</p>
        ) : null}
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
          value={businessDate}
          readOnly={pending}
          aria-invalid={showServerError && state.field === "businessDate"}
          aria-describedby={showServerError && state.field === "businessDate" ? "receive-date-error" : undefined}
          onChange={(event) => setBusinessDate(event.target.value)}
        />
        {showServerError && state.field === "businessDate" && (
          <p id="receive-date-error" role="alert" className="mt-1 text-sm text-red-800">{state.message}</p>
        )}
      </div>
      {preview && (
        <div aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-900">After receiving (estimate)</p>
          <p className="mt-1 text-xl font-semibold text-emerald-950">
            {formatQuantity(preview.stockAfter, bottlesPerCrate)}
          </p>
          <p className="mt-2 text-sm text-emerald-900">
            Matching empty crates left: <strong>{preview.emptiesAfter}</strong>
          </p>
          <p className="mt-1 text-xs text-emerald-900">Latest quantities are checked before saving.</p>
        </div>
      )}
      {showServerError && !state.field && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900">{state.message}</p>
      )}
      {showServerError && <SessionRecoveryLink message={state.message} />}
      <button className="primary w-full" disabled={pending || tooManyCrates}>
        {pending ? "Checking…" : "Next: Review received stock"}
      </button>
    </form>
  );
}
