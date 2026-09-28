"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  refreshSaleCatalog,
  saveSale,
} from "@/app/(shop)/record-sale/actions";
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
import {
  saleNetworkMessage,
  saleSaveUncertainMessage,
  saleSessionExpiredMessage,
} from "@/domain/sale-errors";
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
  const [sessionExpired, setSessionExpired] = useState(false);
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
  const saveUncertain = sales.state.active?.saveUncertain === true;
  useEffect(() => {
    if (!activeId) return;
    let current = true;
    refreshSaleCatalog()
      .then((response) => {
        if (!current) return;
        if ("error" in response) {
          if (response.code === "session_expired") {
            setSessionExpired(true);
            setCheckError(saleSessionExpiredMessage);
          } else {
            setCheckError(response.error ?? saleNetworkMessage);
          }
          return;
        }
        setCatalog(response.catalog);
        setVerifiedId(activeId);
        setCheckError("");
        setSessionExpired(false);
      })
      .catch(() => {
        if (current) setCheckError(saleNetworkMessage);
      });
    return () => {
      current = false;
    };
  }, [activeId, checkAttempt]);

  const customer = catalog.customers.find((c) => c.id === draft.customerId);
  const product = catalog.products.find((p) => p.id === draft.editingId);
  function update(patch: Partial<SaleDraft>) {
    if (sessionExpired) {
      setMessage(saleSessionExpiredMessage);
      return;
    }
    if (saveUncertain) {
      setMessage(saleSaveUncertainMessage);
      return;
    }
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
        const response = await refreshSaleCatalog();
        if ("error" in response) {
          if (response.code === "session_expired") {
            setSessionExpired(true);
            setMessage(saleSessionExpiredMessage);
          } else {
            setMessage(response.error ?? saleNetworkMessage);
          }
          return;
        }
        const fresh = response.catalog;
        setCatalog(fresh);
        const checked = revalidateSaleDraft(draft, fresh);
        if (checked.warnings.length) {
          setMessage(checked.warnings[0]);
          return;
        }
        await sales.update({ step: "empties" });
        setMessage("");
      } catch {
        setMessage(saleNetworkMessage);
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
        <h1>Sale saved</h1>
        <p className="text-lg font-semibold">{saved.name}</p>
        <dl className="rounded-lg border border-stone-200 bg-white px-4">
          {([["Total", saved.total], ["Paid", saved.paid], ["Still owing", saved.owing]] as const).map(([label, amount]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-stone-200 py-3 last:border-b-0">
              <dt>{label}</dt><dd className="font-semibold">{formatNaira(amount)}</dd>
            </div>
          ))}
        </dl>
        <details className="text-sm text-stone-600"><summary className="cursor-pointer py-2">Sale reference</summary><p className="break-all">{saved.id}</p></details>
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
  if (sessionExpired)
    return (
      <div className="space-y-5">
        <h1>Record Sale</h1>
        <div
          role="alert"
          className="border-l-4 border-amber-700 pl-3 text-amber-950"
        >
          <p className="font-semibold">{saleSessionExpiredMessage}</p>
          <p className="mt-1 text-sm">
            Your unfinished sale is saved on this device.
          </p>
        </div>
        <Link
          href="/sign-in?next=/record-sale"
          className="primary block w-full text-center"
        >
          Sign in again
        </Link>
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
            const response = await refreshSaleCatalog();
            if ("error" in response) {
              if (response.code === "session_expired") {
                setSessionExpired(true);
                throw new Error(saleSessionExpiredMessage);
              }
              throw new Error(response.error ?? saleNetworkMessage);
            }
            const fresh = response.catalog;
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
      {!ready && !sessionExpired && (
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
                ? "Choose quantity"
                : step === "check"
                  ? "Your drinks"
                  : step === "empties"
                    ? "Empties"
                    : step === "payment"
                      ? "Payment"
                      : "Review"}
        </h1>
        {step !== "customer" && (
          <nav aria-label="Sale progress" className="text-sm text-stone-600">
            <span className="sr-only">Record Sale: </span>
            {(["Drinks", "Empties", "Payment", "Review"] as const).map(
              (label, index) => {
                const current =
                  step === "drinks" || step === "quantity" || step === "check"
                    ? 0
                    : step === "empties"
                      ? 1
                      : step === "payment"
                        ? 2
                        : 3;
                return (
                  <span key={label} className="inline-flex items-center">
                    {index > 0 && <span aria-hidden="true" className="mx-1">·</span>}
                    <span
                      aria-current={index === current ? "step" : undefined}
                      className={index === current ? "font-semibold text-emerald-950" : ""}
                    >
                      {label}
                    </span>
                  </span>
                );
              },
            )}
          </nav>
        )}
        {step === "customer" && <PausedSalesLink ownerId={ownerId} />}
        {sales.state.active && (draft.customerId || draft.lines.length > 0) && (
          <details className="border-b border-stone-200 pb-2">
            <summary className="cursor-pointer py-2 text-sm font-medium text-emerald-900">
              Sale options
            </summary>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
            <button
              className="quiet-link"
              disabled={saveUncertain}
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
              disabled={saveUncertain}
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
          </details>
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
            <p className="min-w-0 break-words text-sm text-stone-600">Customer: <strong className="text-base text-stone-900">{customer.name}</strong></p>
            <button
              className="quiet-link"
              onClick={() => update({ step: "customer" })}
            >
              Change customer
            </button>
          </div>
        )}
        {message && (
          <p
            role="alert"
            className={saveUncertain ? "text-amber-900" : "text-red-800"}
          >
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
                <details className="mt-2 text-sm text-stone-600">
                  <summary className="cursor-pointer py-2 text-emerald-900 underline underline-offset-4">Part-crate prices</summary>
                  <p className="mt-1">¼:{" "}
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
                  . ¾ uses half + quarter.</p>
                </details>
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
                className="quiet-link w-full text-center"
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
            <div className="flex flex-wrap justify-between gap-x-4">
              <button className="quiet-link" onClick={() => update({ step: "drinks" })}>Keep adding drinks</button>
              <button className="quiet-link" disabled={pending} onClick={quickCheck}>
                {pending ? "Checking…" : "Refresh prices & stock"}
              </button>
            </div>
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
            <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t border-stone-200 bg-[#f7f8f4] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-0 sm:px-0">
            <button
              className="primary min-w-0 flex-1"
              disabled={
                pending ||
                total === undefined ||
                Boolean(paymentInputError)
              }
              onClick={() =>
                startTransition(async () => {
                  let fresh: SaleCatalog;
                  try {
                    const response = await refreshSaleCatalog();
                    if ("error" in response) {
                      if (response.code === "session_expired") {
                        setSessionExpired(true);
                        setMessage(saleSessionExpiredMessage);
                      } else {
                        setMessage(response.error ?? saleNetworkMessage);
                      }
                      return;
                    }
                    fresh = response.catalog;
                  } catch {
                    setMessage(saleNetworkMessage);
                    return;
                  }
                  try {
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
                    setMessage(
                      e instanceof Error
                        ? e.message
                        : "Check this sale and try again.",
                    );
                  }
                })
              }
            >
              {pending ? "Checking…" : "Continue to review"}
            </button>
            <button
              className="min-h-12 shrink-0 px-2 font-semibold text-emerald-900 underline underline-offset-4"
              onClick={() => update({ step: "empties" })}
            >
              Back
            </button>
            </div>
          </>
        )}
        {step === "review" && (
          <>
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
                disabled={saveUncertain}
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
            <div className="sticky bottom-0 z-10 -mx-4 border-t border-stone-200 bg-[#f7f8f4] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-0 sm:px-0">
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
                  const activeDraftId = sales.state.active?.id;
                  if (!activeDraftId) return;

                  const requestId =
                    await sales.ensureRequestId(activeDraftId);
                  if (!requestId) {
                    setMessage(
                      sales.error ||
                        "Could not prepare this sale for saving. Your sale is still here.",
                    );
                    return;
                  }

                  // Persist uncertainty before the request leaves the device.
                  // If the tab closes or the response is lost, reopening the
                  // draft stays locked to this same request ID.
                  if (!(await sales.setSaveUncertain(requestId, true))) {
                    setMessage(
                      "Could not prepare this sale for safe saving. Your sale is still here.",
                    );
                    return;
                  }

                  let response: Awaited<ReturnType<typeof saveSale>>;
                  try {
                    response = await saveSale(requestId, draft);
                  } catch {
                    setMessage(saleSaveUncertainMessage);
                    return;
                  }

                  if (response.error) {
                    if (response.code === "save_uncertain") {
                      setMessage(response.error);
                      return;
                    }

                    // These responses are definitive: the sale did not commit.
                    await sales.setSaveUncertain(requestId, false);

                    if (response.code === "session_expired") {
                      setSessionExpired(true);
                      setMessage(saleSessionExpiredMessage);
                      return;
                    }

                    if (response.code === "customer_unavailable") {
                      try {
                        const refreshed = await refreshSaleCatalog();
                        if (!("error" in refreshed)) {
                          setCatalog(refreshed.catalog);
                          await sales.update({ step: "customer" });
                        } else if (refreshed.code === "session_expired") {
                          setSessionExpired(true);
                          setMessage(saleSessionExpiredMessage);
                          return;
                        }
                      } catch {
                        // The draft stays intact. The customer screen will
                        // refresh again when the sale is reopened.
                      }
                    }
                    setMessage(response.error ?? saleNetworkMessage);
                    return;
                  }

                  if (response.result) {
                    if (await sales.complete(requestId))
                      setSaved({
                        ...response.result,
                        name: customer?.name ?? "Customer",
                      });
                  }
                })
              }
            >
              {pending
                ? saveUncertain
                  ? "Checking…"
                  : "Saving…"
                : saveUncertain
                  ? "Check Sale"
                  : "Save Sale"}
            </button>
            </div>
            {!saveUncertain && (
              <>
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
          </>
        )}
      </fieldset>
    </>
  );
}
