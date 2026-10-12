"use client";
import { SessionRecoveryLink } from "./session-recovery-link";
import { ReviewSaveActions } from "./review-save-actions";
import { useActionState, useState } from "react";
import {
  reviewCount,
  confirmCount,
} from "@/app/(shop)/stock/count/[id]/actions";
import {
  businessTodayInLagos,
  stockCountPreview,
  type StockCountState,
} from "@/domain/stock-count";
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
  const difference = review.stockAfter - review.stock;
  return (
    <form action={action} className="mt-6 space-y-5">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Step 2 of 2 · Review</p>
      <h2 className="text-xl font-semibold">Check the current count</h2>
      <dl className="review-list">
        <div>
          <dt>Business date</dt>
          <dd>{review.businessDate}</dd>
        </div>
        <div>
          <dt>Previously recorded</dt>
          <dd>{review.previouslyCounted === false ? "Not counted yet" : formatQuantity(review.stock, review.bottlesPerCrate)}</dd>
        </div>
        <div>
          <dt>Counted in the shop</dt>
          <dd className="font-semibold">
            {formatQuantity(review.stockAfter, review.bottlesPerCrate)}
          </dd>
        </div>
        <div>
          <dt>Change in stock</dt>
          <dd className="font-semibold">
            {difference === 0
              ? "No change"
              : `${difference > 0 ? "+" : "−"}${Math.abs(difference)} bottles`}
          </dd>
        </div>
      </dl>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
        Save will replace the recorded drinks stock with this count. Empty crates
        stay unchanged.
      </p>
      <ReviewSaveActions
        message={state.message}
        pending={pending}
        retryable={state.retryable}
        saveLabel="Save Current Stock"
        retryLabel="Retry same count"
        changeLabel="Change count"
        onBack={onBack}
      />
    </form>
  );
}

export function StockCountForm({
  productId,
  requestId,
  bottlesPerCrate,
}: {
  productId: string;
  requestId: string;
  bottlesPerCrate: number;
}) {
  const [submissionId, setSubmissionId] = useState(requestId);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({
    crates: "",
    bottles: "0",
    businessDate: businessTodayInLagos(),
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
        onBack={() => {
          setSubmissionId(crypto.randomUUID());
          setEditing(true);
        }}
      />
    );

  const showServerError = Boolean(
    state.message &&
      state.crates === values.crates &&
      state.bottles === values.bottles &&
      state.businessDate === values.businessDate,
  );
  const tooManyLooseBottles =
    /^\d+$/.test(values.bottles) &&
    Number(values.bottles) >= bottlesPerCrate;
  let enteredCount: string | null = null;
  try {
    const preview = stockCountPreview(
      values.crates, values.bottles, values.businessDate, 0, bottlesPerCrate,
    );
    enteredCount = formatQuantity(preview.stockAfter, bottlesPerCrate);
  } catch {
    // The server validates the real stock snapshot on the next step.
  }

  return (
    <form
      action={action}
      className="mt-6 space-y-5"
      onSubmit={() => setEditing(false)}
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Step 1 of 2 · Enter count</p>
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
          aria-invalid={showServerError && state.field === "crates"}
          aria-describedby={showServerError && state.field === "crates" ? "count-crates-error" : undefined}
          onChange={(e) => setValues({ ...values, crates: e.target.value })}
        />
        <p className="mt-1 text-xs text-stone-600">Enter 0 if there are no full crates.</p>
        {showServerError && state.field === "crates" && (
          <p id="count-crates-error" role="alert" className="mt-1 text-sm text-red-800">{state.message}</p>
        )}
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
          aria-invalid={tooManyLooseBottles || (showServerError && state.field === "bottles")}
          aria-describedby={tooManyLooseBottles || (showServerError && state.field === "bottles") ? "count-bottles-error" : undefined}
          onChange={(e) => setValues({ ...values, bottles: e.target.value })}
        />
        <p className="mt-1 text-xs text-stone-600">0 to {bottlesPerCrate - 1} bottles. A full crate belongs in the field above.</p>
        {tooManyLooseBottles ? (
          <p id="count-bottles-error" role="alert" className="mt-1 text-sm text-red-800">
            Enter fewer than {bottlesPerCrate} loose bottles.
          </p>
        ) : showServerError && state.field === "bottles" ? (
          <p id="count-bottles-error" role="alert" className="mt-1 text-sm text-red-800">{state.message}</p>
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
          value={values.businessDate}
          readOnly={pending}
          aria-invalid={showServerError && state.field === "businessDate"}
          aria-describedby={showServerError && state.field === "businessDate" ? "count-date-error" : undefined}
          onChange={(e) => setValues({ ...values, businessDate: e.target.value })}
        />
        {showServerError && state.field === "businessDate" && (
          <p id="count-date-error" role="alert" className="mt-1 text-sm text-red-800">{state.message}</p>
        )}
      </div>
      {enteredCount && (
        <div aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-900">You entered</p>
          <p className="mt-1 text-xl font-semibold text-emerald-950">{enteredCount}</p>
          <p className="mt-1 text-xs text-emerald-900">This replaces the current stock after you review and save.</p>
        </div>
      )}
      {showServerError && !state.field && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900">{state.message}</p>
      )}
      {showServerError && <SessionRecoveryLink message={state.message} />}
      <button className="primary w-full" disabled={pending || tooManyLooseBottles}>
        {pending ? "Checking…" : "Next: Review stock count"}
      </button>
    </form>
  );
}
