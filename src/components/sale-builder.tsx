"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { loadSaleCatalog, saveSale } from "@/app/(shop)/record-sale/actions";
import { CustomerForm } from "./customer-form";
import { emptyCustomer } from "@/domain/customers";
import { ProductImage } from "@/components/product-image";
import { useSaleDrafts } from "./sale-draft-session";
import { PausedSalesLink } from "./paused-sales-link";
import { SaleEmptiesStep } from "./sale-empties-step";
import {
  matchSaleEmpties,
  missingEmptiesMessage,
} from "@/domain/sale-empties";
import { wholeNumberInputMessage } from "@/domain/sale-input";
import { formatNaira } from "@/domain/products";
import { formatQuantity } from "@/domain/quantity";
import {
  matchesSaleCustomer,
  quantityPriceSet,
  revalidateSaleDraft,
  saleProductSetupIssue,
  priceQuantity,
  putSaleLine,
  removeSaleLine,
  saleQuantityLabel,
  saleTotal,
  effectivePartialPrice,
  reviewedLine,
  reviewedLineTotal,
  reviewedTotal,
  type SaleCatalog,
  type SaleDraft,
  type SaleProduct,
  type SaleQuantity,
} from "@/domain/sale-builder";
export function SaleBuilder({
  ownerId,
  initialCatalog,
}: {
  ownerId: string;
  initialCatalog: SaleCatalog;
}) {
  const sales = useSaleDrafts(ownerId);
  const { draft } = sales;
  const [newCustomer, setNewCustomer] = useState<{
    id: string;
    draftId: string | null;
  } | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [catalog, setCatalog] = useState(initialCatalog);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState<{
    id: string;
    total: number;
    paid: number;
    owing: number;
    customer: string;
    name: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const activeId = sales.state.active
    ? `${sales.state.active.id}:${sales.state.active.resumedAt ?? ""}`
    : null;
  const [verifiedId, setVerifiedId] = useState<string | null>(null);
  const [checkError, setCheckError] = useState("");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const ready = activeId === null || verifiedId === activeId;
  useEffect(() => {
    if (!activeId) return;
    let current = true;
    loadSaleCatalog()
      .then((fresh) => {
        if (current) {
          setCatalog(fresh);
          setVerifiedId(activeId);
          setCheckError("");
        }
      })
      .catch(() => {
        if (current)
          setCheckError(
            "Could not check current prices and stock. Try again to open this sale.",
          );
      });
    return () => {
      current = false;
    };
  }, [activeId, checkAttempt]);

  const customer = catalog.customers.find((c) => c.id === draft.customerId);
  const product = catalog.products.find((p) => p.id === draft.editingId);
  function update(patch: Partial<SaleDraft>) {
    void sales.update(patch);
    setMessage("");
  }
  function edit(p: SaleProduct) {
    const setupIssue = saleProductSetupIssue(p);
    if (setupIssue) {
      setMessage(`${p.name}: ${setupIssue}`);
      return;
    }
    if (draft.editingId === p.id) {
      update({ step: "quantity" });
      return;
    }
    const q = draft.lines.find((line) => line.productId === p.id)?.quantity;
    update({
      step: "quantity",
      editingId: p.id,
      crates: String(q?.crates ?? 0),
      fraction: q?.fraction ?? 0,
      bottles: String(q?.bottles ?? 0),
    });
  }
  function quantity(): SaleQuantity {
    if (!/^\d+$/.test(draft.crates) || !/^\d+$/.test(draft.bottles))
      throw new Error("Enter whole numbers, zero or more.");
    return {
      crates: Number(draft.crates),
      fraction: draft.fraction,
      bottles: Number(draft.bottles),
    };
  }
  const cratesInputError = wholeNumberInputMessage(
    draft.crates,
    "whole crates",
  );
  const bottlesInputError = wholeNumberInputMessage(
    draft.bottles,
    "exact bottles",
  );
  let preview: ReturnType<typeof priceQuantity> | undefined;
  let quantityError = "";
  if (product && !cratesInputError && !bottlesInputError)
    try {
      preview = priceQuantity(product, quantity());
    } catch (error) {
      quantityError = (error as Error).message;
    }
  let total: number | undefined;
  try {
    total = saleTotal(draft.lines, catalog.products);
  } catch {
    /* Each affected line is explained below. */
  }
  let reviewTotal: number | undefined;
  try {
    reviewTotal = reviewedTotal(draft.lines);
  } catch {
    /* Review requires a fresh snapshot. */
  }
  let emptiesReview: ReturnType<typeof matchSaleEmpties> | undefined;
  try {
    emptiesReview = matchSaleEmpties(draft, catalog);
  } catch {
    /* The empties step explains what needs to be corrected. */
  }
  const paymentInputError = (() => {
    const inputError = wholeNumberInputMessage(draft.paid, "amount paid");
    if (inputError) return inputError;
    if (total !== undefined && Number(draft.paid) > total)
      return `Amount paid cannot be more than ${formatNaira(total)}.`;
    return "";
  })();

  function quickCheck() {
    startTransition(async () => {
      try {
        const fresh = await loadSaleCatalog();
        setCatalog(fresh);
        const checked = revalidateSaleDraft(draft, fresh);
        if (checked.warnings.length) {
          setMessage(checked.warnings[0]);
          return;
        }
        await sales.update({ step: "empties" });
        setMessage("");
      } catch {
        setMessage(
          "Could not check current prices and stock. Your drinks are still here. Try again.",
        );
      }
    });
  }
  function available(p: SaleProduct) {
    return p.available === null
      ? "Stock not recorded"
      : p.available === 0
        ? "Out of stock"
        : `Available: ${formatQuantity(p.available, p.bottles_per_crate)}`;
  }
  const step = customer ? draft.step : "customer";
  if (saved)
    return (
      <div className="space-y-5">
        <h1>Sale Saved</h1>
        <p>{saved.name}</p>
        <p>Total: {formatNaira(saved.total)}</p>
        <p>Paid: {formatNaira(saved.paid)}</p>
        <p>Owing from this sale: {formatNaira(saved.owing)}</p>
        <p>Sale reference: {saved.id}</p>
        <button className="primary w-full" onClick={() => setSaved(null)}>
          Record Another Sale
        </button>
        <a
          className="secondary block text-center"
          href={`/customers/${saved.customer}`}
        >
          View Customer
        </a>
      </div>
    );
  if (newCustomer)
    return (
      <>
        <h1>New Customer</h1>
        <CustomerForm
          id={newCustomer.id}
          initialValues={emptyCustomer}
          onCancel={() => setNewCustomer(null)}
          onCreated={async (id) => {
            const fresh = await loadSaleCatalog();
            if (!fresh.customers.some((customer) => customer.id === id))
              throw new Error("Customer could not be loaded.");
            if (!(await sales.selectCustomer(newCustomer.draftId, id)))
              throw new Error("Could not select customer.");
            setCatalog(fresh);
            setCustomerQuery("");
            setNewCustomer(null);
          }}
        />
        {sales.error && (
          <p role="alert" className="text-red-800">
            {sales.error}
          </p>
        )}
      </>
    );

  return (
    <>
      {!ready && (
        <div role="status" className="mb-5">
          <p>{checkError || "Checking current prices and stock…"}</p>
          {checkError && (
            <button
              className="secondary mt-3"
              onClick={() => setCheckAttempt((n) => n + 1)}
            >
              Try again
            </button>
          )}
        </div>
      )}
      <fieldset
        disabled={pending || !ready}
        aria-label="Sale draft"
        className="space-y-5"
      >
        <h1>
          {step === "customer"
            ? "Choose customer"
            : step === "drinks"
              ? "Add Drinks"
              : step === "quantity"
                ? "Quantity"
                : step === "check"
                  ? "Quick Check"
                  : step === "empties"
                    ? "Empties"
                    : step === "payment"
                      ? "Payment"
                      : "Review"}
        </h1>
        <p className="text-sm text-stone-600">Record Sale</p>
        <PausedSalesLink ownerId={ownerId} />
        {sales.state.active && (draft.customerId || draft.lines.length > 0) && (
          <div className="flex gap-6">
            <button
              className="quiet-link"
              onClick={() =>
                startTransition(async () => {
                  if (await sales.park()) {
                    setCustomerQuery("");
                    setMessage("");
                  }
                })
              }
            >
              Park Sale
            </button>
            <button
              className="quiet-link"
              onClick={() => {
                const id = sales.state.active?.id;
                if (
                  id &&
                  window.confirm(
                    "Cancel this unfinished sale? This cannot be undone.",
                  )
                )
                  startTransition(async () => {
                    await sales.cancel(id);
                    setCustomerQuery("");
                  });
              }}
            >
              Cancel Sale
            </button>
          </div>
        )}
        {sales.error && (
          <p role="alert" className="text-red-800">
            {sales.error}
          </p>
        )}
        {revalidateSaleDraft(draft, catalog).warnings.length > 0 && (
          <div role="alert" className="space-y-2 text-amber-900">
            {revalidateSaleDraft(draft, catalog).warnings.map(
              (warning, index) => (
                <p key={index}>{warning}</p>
              ),
            )}
          </div>
        )}
        {customer && step !== "customer" && (
          <div className="flex items-center justify-between gap-3">
            <p className="break-words font-semibold">{customer.name}</p>
            <button
              className="quiet-link"
              onClick={() => update({ step: "customer" })}
            >
              Change customer
            </button>
          </div>
        )}
        {message && (
          <p role="alert" className="text-red-800">
            {message}
          </p>
        )}
        {step === "customer" && (
          <>
            <button
              className="secondary w-full"
              onClick={() =>
                setNewCustomer({
                  id: crypto.randomUUID(),
                  draftId: sales.state.active?.id ?? null,
                })
              }
            >
              New Customer
            </button>
            <label htmlFor="sale-customer-search">
              Search by name or phone
            </label>
            <input
              id="sale-customer-search"
              type="search"
              maxLength={120}
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
            />
            {!catalog.customers.length && (
              <p>No customers yet. Add a new customer to start this sale.</p>
            )}
            <ul className="divide-y divide-stone-200">
              {catalog.customers
                .filter((c) => matchesSaleCustomer(c, customerQuery))
                .map((c) => (
                  <li key={c.id}>
                    <button
                      className="min-h-20 w-full py-4 text-left"
                      onClick={() =>
                        update({ customerId: c.id, step: "drinks" })
                      }
                    >
                      <span className="block font-semibold">{c.name}</span>
                      <span className="text-sm text-stone-600">{c.phone}</span>
                    </button>
                  </li>
                ))}
            </ul>
            {catalog.customers.length > 0 &&
              !catalog.customers.some((c) =>
                matchesSaleCustomer(c, customerQuery),
              ) && <p>No matching customers.</p>}
          </>
        )}
        {step === "drinks" && (
          <>
            <div>
              <label htmlFor="sale-drink-search">Search drinks</label>
              <input
                id="sale-drink-search"
                type="search"
                maxLength={120}
                value={draft.productQuery}
                onChange={(e) => update({ productQuery: e.target.value })}
              />
            </div>
            <ul className="divide-y divide-stone-200">
              {catalog.products
                .filter((p) =>
                  `${p.name} ${p.size ?? ""}`
                    .toLowerCase()
                    .includes(draft.productQuery.trim().toLowerCase()),
                )
                .map((p) => {
                  const line = draft.lines.find(
                    (line) => line.productId === p.id,
                  );
                  const setupIssue = saleProductSetupIssue(p);
                  return (
                    <li key={p.id} className="py-4">
                      <button
                        className="flex min-h-24 w-full items-center gap-4 text-left"
                        disabled={!p.available || Boolean(setupIssue)}
                        onClick={() => edit(p)}
                      >
                        <span className="h-20 w-20 shrink-0 overflow-hidden">
                          <ProductImage src={p.image_url} name={p.name} />
                        </span>
                        <span className="min-w-0">
                          <span className="block break-words text-lg font-semibold">
                            {p.name} {p.size}
                          </span>
                          <span className="block text-sm">{available(p)}</span>
                          <span className="block text-sm text-stone-600">
                            {p.full_crate_price === null
                              ? "Price not set"
                              : `${formatNaira(p.full_crate_price)} / crate`}
                          </span>
                          {setupIssue && (
                            <span className="block font-semibold text-amber-900">
                              Setup needed before sale
                            </span>
                          )}
                          {line && !setupIssue && (
                            <span className="block font-semibold">
                              In sale: {saleQuantityLabel(line.quantity)} ·
                              Change
                            </span>
                          )}
                        </span>
                      </button>
                      {setupIssue && (
                        <Link
                          className="quiet-link ml-24 mt-1 inline-block"
                          href={`/products/${p.id}/edit`}
                        >
                          Finish drink setup
                        </Link>
                      )}
                    </li>
                  );
                })}
            </ul>
            {!catalog.products.some((p) =>
              `${p.name} ${p.size ?? ""}`
                .toLowerCase()
                .includes(draft.productQuery.trim().toLowerCase()),
            ) && <p>No matching drinks.</p>}
            <div className="sticky bottom-0 space-y-2 border-t border-stone-300 bg-[#f7f8f4] py-4">
              <p>
                {draft.lines.length}{" "}
                {draft.lines.length === 1 ? "drink" : "drinks"}
                {total !== undefined && draft.lines.length > 0
                  ? ` · ${formatNaira(total)}`
                  : ""}
              </p>
              <button
                className="primary w-full"
                disabled={
                  !draft.lines.length ||
                  pending ||
                  revalidateSaleDraft(draft, catalog).warnings.length > 0
                }
                onClick={quickCheck}
              >
                {pending
                  ? "Checking stock…"
                  : total === undefined
                    ? "Continue · Check quantities"
                    : `Continue · ${formatNaira(total)}`}
              </button>
            </div>
          </>
        )}
        {step === "quantity" && product && (
          <>
            <h2 className="text-xl font-semibold">
              {product.name} {product.size}
            </h2>
            <p>{available(product)}</p>
            {draft.lines.some((line) => line.productId === product.id) && (
              <p className="text-sm">
                Enter the total quantity of this drink for the sale.
              </p>
            )}
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const lines = putSaleLine(
                    draft.lines,
                    { productId: product.id, quantity: quantity() },
                    product,
                  );
                  update({ lines, step: "drinks" });
                } catch (error) {
                  setMessage((error as Error).message);
                }
              }}
            >
              <div>
                <label htmlFor="sale-crates">
                  Whole crates ·{" "}
                  {product.full_crate_price === null
                    ? "Price not set"
                    : `${formatNaira(product.full_crate_price)} each`}
                </label>
                <input
                  id="sale-crates"
                  disabled={product.full_crate_price === null}
                  inputMode="numeric"
                  pattern="[0-9]+"
                  required
                  maxLength={10}
                  value={draft.crates}
                  aria-invalid={Boolean(cratesInputError)}
                  aria-describedby={
                    cratesInputError ? "sale-crates-error" : undefined
                  }
                  onChange={(e) => update({ crates: e.target.value })}
                />
                {cratesInputError && (
                  <p
                    id="sale-crates-error"
                    role="alert"
                    className="mt-2 text-sm text-red-800"
                  >
                    {cratesInputError}
                  </p>
                )}
                {product.full_crate_price === null &&
                  Number(draft.crates) > 0 && (
                    <button
                      type="button"
                      className="quiet-link"
                      onClick={() => update({ crates: "0" })}
                    >
                      Remove unpriced crates
                    </button>
                  )}
              </div>
              <fieldset>
                <legend className="mb-2 font-semibold">
                  Plus part of a crate
                </legend>
                <div className="grid grid-cols-4 gap-2">
                  {([0, 1, 2, 3] as const).map((f) => {
                    let disabled = false;
                    if (f)
                      try {
                        priceQuantity(product, { ...quantity(), fraction: f });
                      } catch {
                        disabled = true;
                      }
                    return (
                      <button
                        type="button"
                        key={f}
                        aria-pressed={draft.fraction === f}
                        className={
                          draft.fraction === f ? "primary" : "secondary"
                        }
                        disabled={disabled}
                        onClick={() => update({ fraction: f })}
                      >
                        <span>
                          {["None", "¼", "½", "¾"][f]}
                          {f > 0 &&
                            !quantityPriceSet(product, {
                              crates: 0,
                              fraction: f,
                              bottles: 0,
                            }) && (
                              <span className="block text-xs">
                                Price not set
                              </span>
                            )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-sm text-stone-600">
                  ¼:{" "}
                  {(() => {
                    try {
                      return formatNaira(
                        effectivePartialPrice(product, "quarter"),
                      );
                    } catch {
                      return "Price not set";
                    }
                  })()} {" "}
                  · ½:{" "}
                  {(() => {
                    try {
                      return formatNaira(effectivePartialPrice(product, "half"));
                    } catch {
                      return "Price not set";
                    }
                  })()}
                  . Optional overrides replace the calculated full-price share.
                  ¾ uses half + quarter.
                </p>
              </fieldset>
              <div>
                <label htmlFor="sale-bottles">
                  Exact bottles
                  {product.bottle_price === null
                    ? " · Price not set"
                    : ` · ${formatNaira(product.bottle_price)} each`}
                </label>
                <input
                  id="sale-bottles"
                  disabled={product.bottle_price === null}
                  inputMode="numeric"
                  pattern="[0-9]+"
                  required
                  maxLength={10}
                  value={draft.bottles}
                  aria-invalid={Boolean(bottlesInputError)}
                  aria-describedby={
                    bottlesInputError ? "sale-bottles-error" : undefined
                  }
                  onChange={(e) => update({ bottles: e.target.value })}
                />
                {bottlesInputError && (
                  <p
                    id="sale-bottles-error"
                    role="alert"
                    className="mt-2 text-sm text-red-800"
                  >
                    {bottlesInputError}
                  </p>
                )}
                {product.bottle_price === null && Number(draft.bottles) > 0 && (
                  <button
                    type="button"
                    className="quiet-link"
                    onClick={() => update({ bottles: "0" })}
                  >
                    Remove unpriced bottles
                  </button>
                )}
                <p className="mt-2 text-sm text-stone-600">
                  For bottles only, leave crates at 0 and choose None above.
                </p>
              </div>
              {preview ? (
                <p role="status" className="text-xl font-semibold">
                  {saleQuantityLabel(quantity())} ·{" "}
                  {formatNaira(preview.lineTotal)}
                </p>
              ) : quantityError ? (
                <p role="alert" className="text-red-800">
                  {quantityError}
                </p>
              ) : null}
              <button className="primary w-full" disabled={!preview}>
                {draft.lines.some((l) => l.productId === product.id)
                  ? "Update & keep adding"
                  : "Add & keep adding"}
              </button>
              <button
                type="button"
                className="secondary w-full"
                onClick={() => update({ step: "drinks" })}
              >
                Back to drinks
              </button>
            </form>
          </>
        )}
        {step === "quantity" && !product && (
          <>
            <p>This drink is no longer available.</p>
            <button
              className="secondary w-full"
              onClick={() => update({ step: "drinks" })}
            >
              Back to drinks
            </button>
          </>
        )}
        {step === "check" && (
          <>
            {!customer && (
              <p role="alert" className="text-red-800">
                Choose a customer to continue.
              </p>
            )}
            {!draft.lines.length && <p>No drinks added yet.</p>}
            <ul className="divide-y divide-stone-300">
              {draft.lines.map((line) => {
                const p = catalog.products.find((p) => p.id === line.productId);
                let lineTotal: number | undefined;
                let error = "";
                try {
                  if (!p) throw new Error("Drink no longer available.");
                  lineTotal = priceQuantity(p, line.quantity).lineTotal;
                } catch (e) {
                  error = (e as Error).message;
                }
                return (
                  <li key={line.productId} className="space-y-2 py-5">
                    <h2 className="break-words text-lg font-semibold">
                      {p ? `${p.name} ${p.size ?? ""}` : "Unavailable drink"}
                    </h2>
                    <p>{saleQuantityLabel(line.quantity)}</p>
                    {p && (
                      <p className="text-sm text-stone-600">{available(p)}</p>
                    )}
                    {error ? (
                      <p role="alert" className="text-red-800">
                        {error}
                      </p>
                    ) : (
                      <p className="font-semibold">{formatNaira(lineTotal!)}</p>
                    )}
                    <div className="flex gap-6">
                      {p && (
                        <button className="quiet-link" onClick={() => edit(p)}>
                          Edit quantity
                        </button>
                      )}
                      <button
                        className="quiet-link"
                        onClick={() =>
                          update({
                            lines: removeSaleLine(draft.lines, line.productId),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-2xl font-semibold">
              Grand total:{" "}
              {total === undefined
                ? "Check quantities above"
                : formatNaira(total)}
            </p>
            <button
              className="primary w-full"
              onClick={() => update({ step: "drinks" })}
            >
              Keep adding drinks
            </button>
            <button
              className="secondary w-full"
              disabled={pending}
              onClick={quickCheck}
            >
              {pending ? "Checking…" : "Refresh prices & stock"}
            </button>
            <p className="text-sm text-stone-600">
              This is a draft. Nothing has been saved and stock has not changed.
            </p>
            <button
              className="primary w-full"
              disabled={
                !customer ||
                !draft.lines.length ||
                total === undefined ||
                revalidateSaleDraft(draft, catalog).warnings.length > 0
              }
              onClick={() => update({ step: "empties" })}
            >
              Continue to Empties
            </button>
          </>
        )}
        {step === "empties" && (
          <SaleEmptiesStep
            draft={draft}
            catalog={catalog}
            update={update}
            onBack={() => update({ step: "drinks" })}
          />
        )}
        {step === "payment" && (
          <>
            <p className="text-xl">
              Total: {total === undefined ? "Check drinks" : formatNaira(total)}
            </p>
            <button
              className="secondary w-full"
              disabled={total === undefined}
              onClick={() =>
                total !== undefined && update({ paid: String(total) })
              }
            >
              Paid in full
            </button>
            <label htmlFor="sale-paid">Other amount paid</label>
            <input
              id="sale-paid"
              inputMode="numeric"
              pattern="[0-9]+"
              value={draft.paid}
              aria-invalid={Boolean(paymentInputError)}
              aria-describedby={
                paymentInputError ? "sale-paid-error" : undefined
              }
              onChange={(e) => update({ paid: e.target.value })}
            />
            {paymentInputError && (
              <p
                id="sale-paid-error"
                role="alert"
                className="mt-2 text-sm text-red-800"
              >
                {paymentInputError}
              </p>
            )}
            <p>
              Still owing:{" "}
              {total !== undefined &&
              /^\d+$/.test(draft.paid) &&
              Number(draft.paid) <= total
                ? formatNaira(total - Number(draft.paid))
                : "—"}
            </p>
            <button
              className="primary w-full"
              disabled={
                pending ||
                total === undefined ||
                Boolean(paymentInputError)
              }
              onClick={() =>
                startTransition(async () => {
                  try {
                    const fresh = await loadSaleCatalog();
                    setCatalog(fresh);
                    matchSaleEmpties(draft, fresh);
                    const lines = draft.lines.map((line) => {
                      const p = fresh.products.find(
                        (item) => item.id === line.productId,
                      );
                      if (!p) throw new Error("Drink unavailable.");
                      priceQuantity(p, line.quantity);
                      return reviewedLine(line, p);
                    });
                    await sales.update({
                      lines,
                      businessDate:
                        draft.businessDate ||
                        new Date().toLocaleDateString("sv-SE"),
                      step: "review",
                    });
                    setMessage("");
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                })
              }
            >
              {pending ? "Checking…" : "Continue"}
            </button>
            <button
              className="secondary w-full"
              onClick={() => update({ step: "empties" })}
            >
              Back
            </button>
          </>
        )}
        {step === "review" && (
          <>
            <p className="font-semibold">Customer: {customer?.name}</p>
            <p className="text-sm text-stone-600">
              Business date: {draft.businessDate}
            </p>
            <details>
              <summary className="quiet-link cursor-pointer">Change date</summary>
              <label className="mt-3 block" htmlFor="sale-date">
                Business date
              </label>
              <input
                id="sale-date"
                type="date"
                value={draft.businessDate}
                onChange={(e) => update({ businessDate: e.target.value })}
              />
            </details>

            {draft.lines.map((line) => {
              const p = catalog.products.find((item) => item.id === line.productId);
              const packaging = emptiesReview?.lines.find(
                (item) => item.productId === line.productId,
              );
              try {
                return (
                  <div key={line.productId} className="border-t py-3">
                    <p>
                      {p ? `${p.name} ${p.size ?? ""}` : "Drink unavailable"} ·{" "}
                      {saleQuantityLabel(line.quantity)} ·{" "}
                      {formatNaira(reviewedLineTotal(line))}
                    </p>
                    {packaging &&
                      (packaging.cratesOwed > 0 || packaging.bottlesOwed > 0) && (
                        <p className="mt-1 text-amber-900">
                          {missingEmptiesMessage(
                            packaging,
                            p?.name ?? "Drink",
                          )}
                        </p>
                      )}
                  </div>
                );
              } catch (e) {
                return (
                  <p role="alert" key={line.productId}>
                    {(e as Error).message}
                  </p>
                );
              }
            })}

            {emptiesReview?.swaps.map((swap) => {
              const from = catalog.crateTypes.find(
                (crate) => crate.id === swap.returnedCrateTypeId,
              );
              const to = catalog.crateTypes.find(
                (crate) => crate.id === swap.owedCrateTypeId,
              );
              return (
                <p
                  className="text-sm text-stone-600"
                  key={`${swap.owedCrateTypeId}:${swap.returnedCrateTypeId}`}
                >
                  Crate swap: {swap.quantity} {from?.name ?? "returned crate"} for{" "}
                  {to?.name ?? "expected crate"}
                </p>
              );
            })}

            <p className="text-xl font-semibold">
              Total:{" "}
              {reviewTotal === undefined
                ? "Check drinks"
                : formatNaira(reviewTotal)}
            </p>
            <p>Paid: {formatNaira(Number(draft.paid))}</p>
            <p>
              Still owing:{" "}
              {reviewTotal === undefined
                ? "Check drinks"
                : formatNaira(reviewTotal - Number(draft.paid))}
            </p>
            <button
              className="primary w-full"
              disabled={
                pending ||
                !draft.businessDate ||
                reviewTotal === undefined ||
                !emptiesReview ||
                Number(draft.paid) > reviewTotal
              }
              onClick={() =>
                startTransition(async () => {
                  const id = sales.state.active?.id;
                  if (!id) return;
                  const response = await saveSale(
                    id.startsWith("imported-") ? ownerId : id,
                    draft,
                  );
                  if (response.error) {
                    if (response.code === "customer_unavailable") {
                      try {
                        const fresh = await loadSaleCatalog();
                        setCatalog(fresh);
                        await sales.update({ step: "customer" });
                      } catch {
                        // The draft stays intact. The customer screen will
                        // refresh again when the sale is reopened.
                      }
                    }
                    setMessage(response.error);
                    return;
                  }
                  if (response.result) {
                    if (await sales.complete(id))
                      setSaved({
                        ...response.result,
                        name: customer?.name ?? "Customer",
                      });
                  }
                })
              }
            >
              {pending ? "Saving…" : "Save Sale"}
            </button>
            <button
              className="secondary w-full"
              onClick={() => update({ step: "payment" })}
            >
              Back to Payment
            </button>
            <button
              className="quiet-link"
              onClick={() => update({ step: "empties" })}
            >
              Edit empties
            </button>
            <button
              className="quiet-link"
              onClick={() => update({ step: "drinks" })}
            >
              Edit drinks
            </button>
          </>
        )}
      </fieldset>
    </>
  );
}
