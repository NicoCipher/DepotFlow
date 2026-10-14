"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  refreshSaleCatalog,
  loadCustomerMoneyOwed,
  saveSale,
} from "@/app/(shop)/record-sale/actions";
import { CustomerForm } from "./customer-form";
import { emptyCustomer } from "@/domain/customers";
import { ProductImage } from "@/components/product-image";
import { SaleIcon } from "@/components/sale-icon";
import { salePaymentTotals, debtPaymentInputError } from "@/domain/sale-payment";
import { useSaleDrafts } from "./sale-draft-session";
import { hasSaleWork } from "@/domain/sale-drafts";
import { PausedSalesLink } from "./paused-sales-link";
import { SaleEmptiesStep } from "./sale-empties-step";
import {
  matchSaleEmpties,
  hasUnmatchedSaleEmpties,
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
  revalidateSaleDraft,
  saleProductSetupIssue,
  priceQuantity,
  putSaleLine,
  removeSaleLine,
  saleQuantityLabel,
  saleTotal,
  effectivePartialPrice,
  roundPartialPrice,
  reviewedLine,
  reviewedLineTotal,
  reviewedTotal,
  type SaleCatalog,
  type SaleDraft,
  type SaleProduct,
  type SaleQuantity,
} from "@/domain/sale-builder";
function selectDefaultZero(event: { currentTarget: HTMLInputElement }) {
  if (event.currentTarget.value === "0") event.currentTarget.select();
}

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
  const pricingMode = draft.sellingMode === "retail" ? "retail" : "wholesale";
  const [catalog, setCatalog] = useState(initialCatalog);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [oldDebt, setOldDebt] = useState<{ key: string; amount: number } | null>(null);
  const [debtError, setDebtError] = useState<{ key: string; message: string } | null>(null);
  const [debtRefresh, setDebtRefresh] = useState(0);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [cancelDraftId, setCancelDraftId] = useState<string | null>(null);
  const keepSaleButton = useRef<HTMLButtonElement>(null);
  const cancelSaleButton = useRef<HTMLButtonElement>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [saved, setSaved] = useState<{
    id: string;
    total: number;
    paid: number;
    owing: number;
    customer: string;
    oldDebtPaid: number;
    oldDebtReceiptRequestId: string | null;
    balanceAfter: number;
    name: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<string | null>(null);
  const activeId = sales.state.active
    ? `${sales.state.active.id}:${sales.state.active.resumedAt ?? ""}`
    : null;
  const [verifiedId, setVerifiedId] = useState<string | null>(null);
  const [checkError, setCheckError] = useState("");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const ready = activeId === null || verifiedId === activeId;
  const saveUncertain = sales.state.active?.saveUncertain === true;
  const saleHasWork = Boolean(sales.state.active && hasSaleWork(draft));
  const confirmCancel = Boolean(cancelDraftId && cancelDraftId === sales.state.active?.id);
  useEffect(() => {
    if (confirmCancel) keepSaleButton.current?.focus();
  }, [confirmCancel]);
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
    setNotice("");
    setCancelDraftId(null);
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
      sellingMode: q && q.crates === 0 && q.fraction === 0 && !q.eighths && q.bottles > 0 ? "retail" : "wholesale",
      step: "quantity",
      editingId: p.id,
      crates: String(q?.crates ?? 0),
      fraction: q?.fraction ?? 0,
      eighths: q?.eighths ?? 0,
      bottles: String(q?.bottles ?? 0),
    });
  }
  function quantity(): SaleQuantity {
    if (!/^\d+$/.test(draft.crates) || !/^\d+$/.test(draft.bottles))
      throw new Error("Enter whole numbers, zero or more.");
    return {
      crates: Number(draft.crates),
      fraction: draft.fraction,
      ...(draft.eighths ? { eighths: draft.eighths } : {}),
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
  function canIncreaseQuantity(field: "crates" | "bottles") {
    if (!product || cratesInputError || bottlesInputError) return false;
    try {
      const current = quantity();
      priceQuantity(product, { ...current, [field]: current[field] + 1 });
      return true;
    } catch {
      return false;
    }
  }
  function changeNumber(field: "crates" | "bottles", amount: -1 | 1) {
    const current = field === "crates" ? draft.crates : draft.bottles;
    if (!/^\d+$/.test(current)) return;
    const next = Number(current) + amount;
    if (!Number.isSafeInteger(next) || next < 0) return;
    if (amount > 0 && !canIncreaseQuantity(field)) return;
    update({ [field]: String(next) });
  }
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
  const customerToCheck = customer?.id ?? null;
  const debtKey = customerToCheck && (step === "payment" || step === "review")
    ? `${customerToCheck}:${step}:${debtRefresh}`
    : null;
  useEffect(() => {
    if (!customerToCheck || !debtKey) return;
    let current = true;
    void loadCustomerMoneyOwed(customerToCheck)
      .then((result) => {
        if (!current) return;
        if ("error" in result) {
          setDebtError({ key: debtKey, message: result.error ?? "Could not load previous balance." });
        } else {
          setOldDebt({ key: debtKey, amount: result.amount });
          setDebtError(null);
        }
      })
      .catch(() => {
        if (current) setDebtError({ key: debtKey, message: "Could not load the previous balance. Try again." });
      });
    return () => { current = false; };
  }, [customerToCheck, debtKey]);
  const debtErrorMessage = debtError?.key === debtKey ? debtError.message : "";
  const debtChecking = Boolean(debtKey && oldDebt?.key !== debtKey && !debtErrorMessage);
  const oldDebtAmount = debtKey && oldDebt?.key === debtKey ? oldDebt.amount : null;
  const oldDebtInputError = debtPaymentInputError(draft.oldDebtPaid, oldDebtAmount);
  const paymentBreakdown = (() => {
    if (total === undefined || oldDebtAmount === null || paymentInputError || oldDebtInputError) return null;
    try { return salePaymentTotals(total, Number(draft.paid), oldDebtAmount, Number(draft.oldDebtPaid)); }
    catch { return null; }
  })();
  const progressStep =
    step === "customer"
      ? 0
      : step === "drinks" || step === "quantity"
        ? 1
        : step === "empties"
          ? 2
          : step === "payment"
            ? 3
            : 4;
  const visibleProducts = catalog.products.filter((p) =>
    (p.name + " " + (p.size ?? "")).toLowerCase().includes(draft.productQuery.trim().toLowerCase()),
  );
  function linePriceLabel(p: SaleProduct, q: SaleQuantity) {
    try {
      return formatNaira(priceQuantity(p, q).lineTotal);
    } catch {
      return "Check price or stock";
    }
  }
  const progressLabels = ["Customer", "Drinks", "Empties", "Payment", "Review"] as const;
  const matchedCustomers = catalog.customers.filter((c) => matchesSaleCustomer(c, customerQuery));
  useEffect(() => {
    if (previousStep.current !== null && previousStep.current !== step) {
      stepHeading.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    previousStep.current = step;
  }, [step]);
  if (saved)
    return (
      <div className="space-y-5">
        <section aria-labelledby="sale-success-title" className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
            <SaleIcon name="check" className="h-8 w-8" />
          </div>
          <p className="mt-5 text-sm font-bold uppercase tracking-wide text-emerald-800">Sale complete</p>
          <h1 id="sale-success-title" className="mt-1 text-3xl font-bold text-stone-950">Sale recorded</h1>
          <p className="mt-2 text-stone-600">
            {saved.name}’s sale is saved. Stock and any payment toward earlier debt have been updated.
          </p>
          <dl className="mt-6 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-stone-50 px-4">
            <div className="flex items-center justify-between gap-3 py-4">
              <dt className="text-stone-600">Sale total</dt>
              <dd className="text-xl font-bold tabular-nums">{formatNaira(saved.total)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-4">
              <dt className="text-stone-600">Paid toward today&apos;s sale</dt>
              <dd className="font-bold tabular-nums">{formatNaira(saved.paid)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-4">
              <dt className="font-semibold">Today’s sale still unpaid</dt>
              <dd className={"text-xl font-bold tabular-nums " + (saved.owing > 0 ? "text-amber-900" : "text-emerald-900")}>
                {saved.owing === 0 ? "Paid in full" : formatNaira(saved.owing)}
              </dd>
            </div>
          </dl>
          {saved.oldDebtPaid > 0 && (
            <p className="mt-4 text-sm font-semibold text-emerald-900">
              {formatNaira(saved.oldDebtPaid)} paid toward previous money owed. The customer receipt shows both payments together.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 p-4">
            <span className="font-semibold text-emerald-950">Customer now owes in total</span>
            <strong className="text-xl font-bold tabular-nums text-emerald-950">{formatNaira(saved.balanceAfter)}</strong>
          </div>
        </section>
        <button type="button" className="primary flex w-full gap-2" onClick={() => { setSaved(null); setNotice(""); }}>
          <SaleIcon name="plus" /> Record another sale
        </button>
        <a className="secondary flex w-full gap-2" href={"/receipts/sale/" + saved.id}>
          <SaleIcon name="receipt" /> View & share customer receipt
        </a>
        {saved.oldDebtReceiptRequestId && (
          <details className="rounded-lg border border-stone-200 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-semibold text-stone-700">
              Separate old-debt payment record
            </summary>
            <p className="mt-2 text-stone-600">This accounting receipt records the old-debt payment separately from today's sale.</p>
            <a className="secondary mt-3 flex w-full gap-2" href={"/receipts/payment/" + saved.oldDebtReceiptRequestId}>
              <SaleIcon name="receipt" /> View old-debt payment record
            </a>
          </details>
        )}
        <a className="secondary flex w-full gap-2" href={ "/customers/" + saved.customer }>
          <SaleIcon name="user" /> View customer
        </a>
        <details className="text-sm text-stone-600">
          <summary className="cursor-pointer py-2">Sale reference</summary>
          <p className="break-all">{saved.id}</p>
        </details>
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
        className="space-y-3 pb-4"
      >
        <header className="space-y-3 border-b border-stone-200 pb-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="shrink-0 text-xs font-bold uppercase tracking-wide text-emerald-800">
              Step {progressStep + 1} of 5
            </p>
            {saleHasWork && (
              <div role="group" aria-label="Unfinished sale actions" className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-950 hover:border-emerald-700 hover:bg-emerald-100"
                  disabled={saveUncertain}
                  title="Park this unfinished sale on this device"
                  onClick={() => {
                    setCancelDraftId(null);
                    startTransition(async () => {
                      if (await sales.park()) {
                        setCustomerQuery("");
                        setMessage("");
                        setNotice("Sale parked on this device. Open Paused sales to continue later.");
                      }
                    });
                  }}
                >
                  <SaleIcon name="pause" className="h-4 w-4 shrink-0" /> Park
                </button>
                <button
                  ref={cancelSaleButton}
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-800 hover:border-red-300 hover:bg-red-50"
                  disabled={saveUncertain}
                  title="Cancel and discard this unfinished sale"
                  aria-expanded={confirmCancel}
                  aria-controls="cancel-sale-panel"
                  onClick={() => setCancelDraftId(sales.state.active?.id ?? null)}
                >
                  <SaleIcon name="trash" className="h-4 w-4 shrink-0 text-red-700" /> Cancel
                </button>
              </div>
            )}
          </div>
          <h1 ref={stepHeading} tabIndex={-1} className="outline-none">
            {step === "customer" ? "Who is buying?" : step === "drinks" ? "Choose drinks" : step === "quantity" ? "Set the quantity" : step === "empties" ? "Check the empties" : step === "payment" ? "Record payment" : "Review and save"}
          </h1>
          {step !== "drinks" && (
            <p className="text-sm leading-5 text-stone-600">
              {step === "customer" ? "Find the customer to begin." : step === "quantity" ? "Enter the quantity, then add it to the sale." : step === "empties" ? "Check the empty crates and bottles returned." : step === "payment" ? "Enter what the customer paid today." : "Check the sale details before saving."}
            </p>
          )}
          <nav aria-label="Sale progress">
            <ol className="grid grid-cols-5 gap-1.5 sm:gap-2">
              {progressLabels.map((label, index) => (
                <li key={label} aria-current={index === progressStep ? "step" : undefined} className="min-w-0">
                  <span aria-hidden="true" className={"block h-1.5 rounded-full " + (index < progressStep ? "bg-emerald-800" : index === progressStep ? "bg-emerald-600 ring-2 ring-emerald-100" : "bg-stone-200")} />
                  <span className="sr-only">{label}{index === progressStep ? ", current step" : index < progressStep ? ", completed" : ""}</span>
                </li>
              ))}
            </ol>
          </nav>
        </header>
        {customer && step !== "customer" && (
          <section aria-label="Current customer" className="flex min-w-0 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-900">
              <SaleIcon name="user" className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-xs text-stone-500">Customer</span>
              <strong className="block truncate text-sm text-stone-950 sm:text-base" title={customer.name}>{customer.name}</strong>
            </div>
            <button type="button" className="secondary min-h-11 shrink-0 gap-1 px-3 py-2 text-sm" onClick={() => update({ step: "customer" })}>
              <SaleIcon name="edit" className="h-4 w-4" /> Change
            </button>
          </section>
        )}
        {saveUncertain && saleHasWork && (
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            The save may have completed. Use Check Sale before parking or cancelling.
          </p>
        )}
        {confirmCancel && !saveUncertain && (
              <div id="cancel-sale-panel" role="group" aria-labelledby="cancel-sale-question" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4">
                <h3 id="cancel-sale-question" className="font-bold text-red-950">Discard this unfinished sale?</h3>
                <p className="mt-1 text-sm leading-5 text-red-900">
                  The selected customer, drinks and payment details will be lost. Nothing will be deducted from stock.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    ref={keepSaleButton}
                    type="button"
                    className="secondary w-full"
                    onClick={() => {
                      setCancelDraftId(null);
                      cancelSaleButton.current?.focus();
                    }}
                  >
                    Keep recording
                  </button>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-red-800 px-4 py-3 font-semibold text-white hover:bg-red-900"
                    onClick={() => {
                      const id = cancelDraftId;
                      if (!id || id !== sales.state.active?.id) return;
                      startTransition(async () => {
                        if (await sales.cancel(id)) {
                          setCustomerQuery("");
                          setMessage("");
                          setCancelDraftId(null);
                          setNotice("Unfinished sale cancelled. No stock or payment was changed.");
                        }
                      });
                    }}
                  >
                    <SaleIcon name="trash" className="h-4 w-4" /> Yes, cancel sale
                  </button>
                </div>
              </div>
            )}
        {step === "customer" && <PausedSalesLink ownerId={ownerId} prominent />}
        {notice && (
          <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-3 top-3 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-xl bg-emerald-950 px-4 py-3 text-sm font-semibold text-white shadow-xl sm:top-5">
            <SaleIcon name="check" className="h-5 w-5 shrink-0" />
            <p className="min-w-0 flex-1 leading-5">{notice}</p>
            <button type="button" className="pointer-events-auto min-h-11 shrink-0 rounded-md px-2 font-semibold text-white underline underline-offset-4" onClick={() => setNotice("")}>
              Dismiss
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
        {message && (
          <p
            role="alert"
            className={saveUncertain ? "text-amber-900" : "text-red-800"}
          >
            {message}
          </p>
        )}
        {step === "customer" && (
          <section aria-labelledby="sale-customer-heading" className="space-y-4">
            <div>
              <h2 id="sale-customer-heading" className="text-xl font-bold text-stone-950">Find a customer</h2>
              <p className="mt-1 text-sm leading-6 text-stone-600">Select a customer to continue with their sale.</p>
            </div>
            <div>
              <label htmlFor="sale-customer-search">Search by name or phone</label>
              <input
                id="sale-customer-search"
                type="search"
                placeholder="Start typing a name or number"
                maxLength={120}
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="secondary w-full gap-2 border-emerald-200 text-emerald-900"
              onClick={() => setNewCustomer({ id: crypto.randomUUID(), draftId: sales.state.active?.id ?? null })}
            >
              <SaleIcon name="plus" className="h-5 w-5" /> Add new customer
            </button>
            {catalog.customers.length > 0 && (
              <p className="text-sm font-medium text-stone-600">
                {matchedCustomers.length} {matchedCustomers.length === 1 ? "customer" : "customers"} found
              </p>
            )}
            {!catalog.customers.length && (
              <div className="rounded-xl border border-dashed border-stone-300 bg-white p-5">
                <p className="font-bold">No customers yet</p>
                <p className="mt-1 text-sm text-stone-600">Add your first customer to start recording sales.</p>
              </div>
            )}
            <ul className="grid gap-2" aria-label="Choose a customer">
              {matchedCustomers.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={draft.customerId === c.id
                      ? "flex min-h-20 w-full items-center gap-3 rounded-xl border-2 border-emerald-700 bg-emerald-50 px-4 py-3 text-left"
                      : "flex min-h-20 w-full items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left hover:border-emerald-500 hover:bg-emerald-50"}
                    aria-pressed={draft.customerId === c.id}
                    onClick={() => update({ customerId: c.id, oldDebtPaid: c.id === draft.customerId ? draft.oldDebtPaid : "0", step: "drinks" })}
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-700">
                      <SaleIcon name="user" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-bold text-stone-950">{c.name}</span>
                      <span className="block text-sm text-stone-600">{c.phone || "No phone number"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-emerald-800">
                      {draft.customerId === c.id
                        ? <><SaleIcon name="check" className="h-4 w-4" /> Selected</>
                        : <>Choose <SaleIcon name="arrow" className="h-4 w-4" /></>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {catalog.customers.length > 0 && !matchedCustomers.length && (
              <div className="rounded-xl border border-stone-200 bg-white p-4">
                <p className="font-semibold">No matching customers</p>
                <p className="mt-1 text-sm text-stone-600">Try a different name or phone number.</p>
                <button type="button" className="secondary mt-3" onClick={() => setCustomerQuery("")}>Clear search</button>
              </div>
            )}
          </section>
        )}
        {step === "drinks" && (
          <div className="space-y-6">
            <section aria-labelledby="sale-choose-drink">
              <div className="mb-3">
                <label id="sale-choose-drink" className="text-lg font-bold text-stone-950" htmlFor="sale-drink-search">
                  Find a drink
                </label>
                <input
                  id="sale-drink-search"
                  type="search"
                  placeholder="Search drinks by name or size"
                  maxLength={120}
                  value={draft.productQuery}
                  onChange={(e) => update({ productQuery: e.target.value })}
                />
                <p className="mt-1.5 text-xs text-stone-600">
                  {visibleProducts.length} {visibleProducts.length === 1 ? "drink" : "drinks"} found
                </p>
              </div>
              {draft.lines.length > 0 && (
                <details className="mb-3 overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/70">
                  <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-center gap-2 font-bold text-emerald-950">
                      <SaleIcon name="bag" className="h-4 w-4 shrink-0" />
                      In this sale · {draft.lines.length} {draft.lines.length === 1 ? "drink" : "drinks"}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-sm text-emerald-900">
                      <strong className="tabular-nums">{total === undefined ? "Check prices" : formatNaira(total)}</strong>
                      <span className="font-semibold underline underline-offset-4">View / edit</span>
                    </span>
                  </summary>
                <ul className="divide-y divide-emerald-200 px-4">
                  {draft.lines.map((line) => {
                    const item = catalog.products.find((p) => p.id === line.productId);
                    return (
                      <li key={line.productId} className="flex min-w-0 items-start gap-3 py-3">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-emerald-100 bg-white">
                          {item ? <ProductImage src={item.image_url} name={item.name} /> : <span className="block p-2 text-xs">Drink unavailable</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="break-words font-bold text-stone-950">
                            {item?.name ?? "Unavailable drink"} {item?.size}
                          </p>
                          <p className="mt-0.5 text-sm text-stone-700">{saleQuantityLabel(line.quantity)}</p>
                          <p className="mt-1 font-bold tabular-nums text-stone-950">{item ? linePriceLabel(item, line.quantity) : "Check drink"}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item && (
                              <button type="button" className="secondary min-h-12 gap-1.5 px-3 py-2 text-sm" onClick={() => edit(item)}>
                                <SaleIcon name="edit" className="h-4 w-4" /> Change quantity
                              </button>
                            )}
                            <button type="button" className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-red-800 hover:border-red-300 hover:bg-red-50" onClick={() => update({ lines: removeSaleLine(draft.lines, line.productId) })}>
                              <SaleIcon name="trash" className="h-4 w-4" /> Remove
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                </details>
              )}
              <ul className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label="Available drinks to choose">
                {visibleProducts.map((p) => {
                  const line = draft.lines.find((item) => item.productId === p.id);
                  const setupIssue = saleProductSetupIssue(p);
                  const selectable = Boolean(p.available) && !setupIssue;
                  return (
                    <li key={p.id} className="min-w-0">
                      <div className={line
                        ? "h-full rounded-xl border-2 border-emerald-700 bg-emerald-50"
                        : "h-full rounded-xl border border-stone-200 bg-white"}>
                        <button
                          type="button"
                          className="flex min-h-32 w-full items-center gap-3 rounded-xl p-3 text-left disabled:opacity-70"
                          disabled={!selectable}
                          onClick={() => edit(p)}
                        >
                          <span className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-stone-50">
                            <ProductImage src={p.image_url} name={p.name} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-base font-bold text-stone-950">{p.name} {p.size}</span>
                            <span className={p.available === 0 ? "mt-1 block text-sm font-semibold text-red-800" : "mt-1 block text-sm text-stone-600"}>
                              {available(p)}
                            </span>
                            <span className="mt-1 block text-sm font-semibold text-stone-800">
                              {p.full_crate_price === null ? "Crate price not set" : formatNaira(p.full_crate_price) + " / crate"}
                            </span>
                            {p.bottle_price !== null && <span className="block text-xs text-stone-600">{formatNaira(p.bottle_price)} / bottle</span>}
                            <span className={line ? "mt-2 flex items-center gap-1 text-sm font-bold text-emerald-900" : "mt-2 flex items-center gap-1 text-sm font-bold text-emerald-800"}>
                              {setupIssue ? "Setup needed" : !p.available ? "Cannot add" : line
                                ? <><SaleIcon name="check" className="h-4 w-4" /> In this sale · Change</>
                                : <><SaleIcon name="plus" className="h-4 w-4" /> Add this drink</>}
                            </span>
                          </span>
                        </button>
                        {setupIssue && (
                          <Link className="quiet-link mx-3 mb-2 inline-block text-sm" href={"/products/" + p.id + "/edit"}>
                            Finish drink setup
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {visibleProducts.length === 0 && (
                <div className="rounded-xl border border-stone-200 bg-white p-5">
                  <p className="font-semibold">No drinks found</p>
                  <p className="mt-1 text-sm text-stone-600">Try another name or clear your search.</p>
                  {draft.productQuery && <button type="button" className="secondary mt-3" onClick={() => update({ productQuery: "" })}>Clear search</button>}
                </div>
              )}
            </section>
            <div className="sale-sticky-actions sticky z-10 flex min-w-0 items-center gap-3 border-t border-stone-300 bg-background py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-stone-600">
                  {draft.lines.length} {draft.lines.length === 1 ? "drink" : "drinks"} in sale
                </p>
                <strong className="block truncate text-lg font-bold tabular-nums text-stone-950">
                  {total === undefined ? "Check prices" : formatNaira(total)}
                </strong>
              </div>
              <button
                type="button"
                className="primary min-h-12 shrink-0 gap-1.5 px-4"
                disabled={!draft.lines.length || pending || revalidateSaleDraft(draft, catalog).warnings.length > 0}
                onClick={quickCheck}
              >
                {pending ? "Checking…" : draft.lines.length ? "Next: Empties" : "Add a drink"}
                {draft.lines.length > 0 && !pending && <SaleIcon name="arrow" className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
        {step === "quantity" && product && (
          <>
            <div className="flex items-center gap-4 rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-stone-50 sm:h-28 sm:w-28">
                <ProductImage src={product.image_url} name={product.name} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-xl font-bold text-stone-950">{product.name} {product.size}</h2>
                <p className="mt-2 font-medium text-stone-700">{available(product)}</p>
                {draft.lines.some((line) => line.productId === product.id) && (
                  <p className="mt-1 text-sm font-semibold text-emerald-800">Editing a drink already in this sale</p>
                )}
              </div>
            </div>
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (sessionExpired || saveUncertain) {
                  setMessage(sessionExpired ? saleSessionExpiredMessage : saleSaveUncertainMessage);
                  return;
                }
                try {
                  const selected = quantity();
                  const lines = putSaleLine(
                    draft.lines,
                    { productId: product.id, quantity: selected },
                    product,
                  );
                  const editing = draft.lines.some((line) => line.productId === product.id);
                  const amount = formatNaira(priceQuantity(product, selected).lineTotal);
                  startTransition(async () => {
                    if (await sales.update({ lines, step: "drinks" })) {
                      setMessage("");
                      setCancelDraftId(null);
                      setNotice(product.name + " " + saleQuantityLabel(selected) + (editing ? " updated" : " added to this sale") + " · " + amount);
                    }
                  });
                } catch (error) {
                  setMessage((error as Error).message);
                }
              }}
            >
              <fieldset className="rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
                <legend className="px-1 text-lg font-bold">How are they buying?</legend>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" aria-pressed={pricingMode === "wholesale"} className={(pricingMode === "wholesale" ? "border-emerald-800 bg-emerald-50 text-emerald-950" : "border-stone-200 bg-white text-stone-800") + " min-h-24 rounded-lg border-2 px-3 py-3 text-left"} onClick={() => {
                    if (pricingMode === "wholesale") return;
                    update({ sellingMode: "wholesale", crates: "0", fraction: 0, eighths: 0, bottles: "0" });
                  }}>
                    <span className="block font-bold">Wholesale</span>
                    <span className="mt-1 block text-xs leading-5">Crates and parts of a crate</span>
                  </button>
                  <button type="button" aria-pressed={pricingMode === "retail"} className={(pricingMode === "retail" ? "border-emerald-800 bg-emerald-50 text-emerald-950" : "border-stone-200 bg-white text-stone-800") + " min-h-24 rounded-lg border-2 px-3 py-3 text-left"} disabled={product.bottle_price === null} onClick={() => {
                    if (pricingMode === "retail") return;
                    update({ sellingMode: "retail", crates: "0", fraction: 0, eighths: 0, bottles: "0" });
                  }}>
                    <span className="block font-bold">Retail</span>
                    <span className="mt-1 block text-xs leading-5">Every bottle at bottle price</span>
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-stone-600">Switching between Wholesale and Retail clears this drink&apos;s entered quantity.</p>
                {product.bottle_price === null && <p className="mt-2 text-sm font-medium text-amber-900">Bottle price not set. Retail is unavailable.</p>}
              </fieldset>
              {pricingMode === "wholesale" && (
                <>
              <div>
                <label htmlFor="sale-crates">
                  Whole crates ·{" "}
                  {product.full_crate_price === null
                    ? "Price not set"
                    : `${formatNaira(product.full_crate_price)} each`}
                </label>
                <div className="flex items-stretch gap-2">
                  <button type="button" className="secondary w-12 shrink-0 px-0 text-2xl" aria-label="Remove one whole crate" disabled={Boolean(cratesInputError) || Number(draft.crates) === 0} onClick={() => changeNumber("crates", -1)}>−</button>
                <input
                  className="min-w-0 flex-1 text-center text-xl font-bold tabular-nums"
                  id="sale-crates"
                  onFocus={selectDefaultZero}
                  onClick={selectDefaultZero}
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
                  <button type="button" className="secondary w-12 shrink-0 px-0 text-2xl" aria-label="Add one whole crate" disabled={!canIncreaseQuantity("crates")} onClick={() => changeNumber("crates", 1)}>+</button>
                </div>
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
                  Part of a crate
                </legend>
                <div className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-4">
                  {(product.bottles_per_crate === 24 ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3]).map((part) => {
                    const eighths = (product.bottles_per_crate === 24 && part % 2 ? part : 0) as 0 | 1 | 3 | 5 | 7;
                    const fraction = (product.bottles_per_crate === 24 ? (part % 2 ? 0 : part / 2) : part) as 0 | 1 | 2 | 3;
                    const chosen = draft.fraction === fraction && (draft.eighths ?? 0) === eighths;
                    let amount: number | null = part === 0 ? 0 : null;
                    let disabled = false;
                    if (part) {
                      try { amount = priceQuantity({ ...product, available: Number.MAX_SAFE_INTEGER }, { crates: 0, fraction, eighths, bottles: 0 }).lineTotal; } catch { disabled = true; }
                      try { priceQuantity(product, { ...quantity(), fraction, eighths }); } catch { disabled = true; }
                    }
                    return <button type="button" key={part} aria-pressed={chosen} className={chosen ? "primary" : "secondary"} disabled={disabled} onClick={() => update({ fraction, eighths })}>
                      <span>{part === 0 ? "None" : `${eighths ? eighths * 3 : product.bottles_per_crate * fraction / 4} bottles`}
                        {part > 0 && <span className="block text-xs">{amount === null ? "Price unavailable" : formatNaira(amount)}</span>}
                      </span>
                    </button>;
                  })}
                </div>
                <details className="mt-2 text-sm text-stone-600">
                  <summary className="cursor-pointer py-2 text-emerald-900 underline underline-offset-4">Part-crate prices</summary>
                  <p className="mt-1">¼:{" "}
                  {(() => {
                    try {
                      return formatNaira(
                        roundPartialPrice(effectivePartialPrice(product, "quarter")),
                      );
                    } catch {
                      return "Price not set";
                    }
                  })()} {" "}
                  · ½:{" "}
                  {(() => {
                    try {
                      return formatNaira(roundPartialPrice(effectivePartialPrice(product, "half")));
                    } catch {
                      return "Price not set";
                    }
                  })()}
                  {" "}· ¾:{" "}
                  {(() => {
                    try {
                      return formatNaira(roundPartialPrice(
                        effectivePartialPrice(product, "half") +
                        effectivePartialPrice(product, "quarter"),
                      ));
                    } catch {
                      return "Price not set";
                    }
                  })()}</p>
                </details>
              </fieldset>
                </>
              )}
              {pricingMode === "retail" && (
                <div className="space-y-3">
                  <p className="text-sm text-stone-700">
                    {product.bottle_price === null ? "Bottle price not set." : formatNaira(product.bottle_price) + " per bottle."} Even half a crate is charged by the bottle, not at the wholesale half-crate price.
                  </p>
                  <fieldset>
                    <legend className="mb-2 text-sm font-bold">Quick quantities</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {[1, ...(product.bottles_per_crate % 2 === 0 ? [product.bottles_per_crate / 2] : []), product.bottles_per_crate].filter((n, index, all) => all.indexOf(n) === index).map((n) => (
                        <button
                          type="button"
                          key={n}
                          aria-pressed={draft.bottles === String(n)}
                          className={draft.bottles === String(n) ? "primary" : "secondary"}
                          disabled={(() => {
                            try {
                              priceQuantity(product, { crates: 0, fraction: 0, bottles: n });
                              return false;
                            } catch {
                              return true;
                            }
                          })()}
                          onClick={() => update({ bottles: String(n) })}
                        >
                          <span className="text-sm">{n} {n === 1 ? "bottle" : "bottles"}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
              )}
              <div>
                <label htmlFor="sale-bottles">
                  {pricingMode === "retail" ? "Bottles" : "Extra loose bottles"}
                  {product.bottle_price === null
                    ? " · Price not set"
                    : ` · ${formatNaira(product.bottle_price)} each`}
                </label>
                <div className="flex items-stretch gap-2">
                  <button type="button" className="secondary w-12 shrink-0 px-0 text-2xl" aria-label="Remove one bottle" disabled={Boolean(bottlesInputError) || Number(draft.bottles) === 0} onClick={() => changeNumber("bottles", -1)}>−</button>
                <input
                  className="min-w-0 flex-1 text-center text-xl font-bold tabular-nums"
                  id="sale-bottles"
                  onFocus={selectDefaultZero}
                  onClick={selectDefaultZero}
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
                  <button type="button" className="secondary w-12 shrink-0 px-0 text-2xl" aria-label="Add one bottle" disabled={!canIncreaseQuantity("bottles")} onClick={() => changeNumber("bottles", 1)}>+</button>
                </div>
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
                <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" aria-live="polite">
                  <p className="text-sm font-semibold text-emerald-950">This drink will be added as</p>
                  <p className="mt-1 text-base font-semibold text-stone-900">
                    {pricingMode === "retail" ? quantity().bottles + " bottles at retail price" : saleQuantityLabel(quantity())}
                  </p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-950">{formatNaira(preview.lineTotal)}</p>
                </div>
              ) : quantityError ? (
                <p role="alert" className="text-red-800">{quantityError}</p>
              ) : null}
              <div className="sale-sticky-actions sticky z-10 -mx-4 flex items-center gap-3 border-t border-stone-200 bg-background px-4 pb-4 pt-3 sm:mx-0 sm:px-0">
                <button
                  type="button"
                  className="secondary min-h-12 shrink-0 px-4"
                  onClick={() => update({ step: "drinks" })}
                >
                  Back
                </button>
                <button type="submit" className="primary min-w-0 flex-1" disabled={!preview}>
                  {draft.lines.some((l) => l.productId === product.id)
                    ? "Save quantity"
                    : "Add to sale"}
                </button>
              </div>
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
            <section aria-label="Payment for today&apos;s drinks" className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-stone-950">Today&apos;s sale</h2>
                <strong className="text-2xl font-bold tabular-nums text-emerald-950">{total === undefined ? "Check drinks" : formatNaira(total)}</strong>
              </div>
              <label htmlFor="sale-paid">Paying toward today&apos;s sale (₦)</label>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Quick payment for today&apos;s sale">
                <button type="button" className="secondary w-full" aria-pressed={total !== undefined && draft.paid === String(total)} disabled={total === undefined} onClick={() => total !== undefined && update({ paid: String(total) })}>
                  Pay in full
                </button>
                <button type="button" className="secondary w-full" aria-pressed={draft.paid === "0"} onClick={() => update({ paid: "0" })}>Pay later</button>
              </div>
              <input
                id="sale-paid"
                onFocus={selectDefaultZero}
                onClick={selectDefaultZero}
                inputMode="numeric"
                pattern="[0-9]+"
                maxLength={12}
                value={draft.paid}
                aria-invalid={Boolean(paymentInputError)}
                aria-describedby={paymentInputError ? "sale-paid-error" : undefined}
                onChange={(e) => update({ paid: e.target.value })}
              />
              {paymentInputError && <p id="sale-paid-error" role="alert" className="text-sm text-red-800">{paymentInputError}</p>}
            </section>
            <section aria-label="Previous customer debt" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-stone-950">Previous money owed</h2>
                <strong className="text-2xl font-bold tabular-nums text-amber-950">
                  {oldDebtAmount === null ? "Checking…" : formatNaira(oldDebtAmount)}
                </strong>
              </div>
              {debtChecking && <p role="status" className="text-sm text-amber-950">Checking the customer&apos;s current balance…</p>}
              {debtErrorMessage && (
                <div role="alert" className="space-y-2 text-sm text-amber-950">
                  <p>{debtErrorMessage}</p>
                  <button type="button" className="secondary" onClick={() => setDebtRefresh((n) => n + 1)}>Try again</button>
                </div>
              )}
              {oldDebtAmount !== null && oldDebtAmount === 0 && !debtChecking && (
                <>
                  <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                    <SaleIcon name="check" className="h-4 w-4" /> No previous money owed.
                  </p>
                  {Number(draft.oldDebtPaid) > 0 && !saveUncertain && (
                    <div role="alert" className="space-y-2">
                      <p className="text-sm text-red-800">The previous debt has been cleared. Remove the old-debt amount before continuing.</p>
                      <button type="button" className="secondary w-full" onClick={() => update({ oldDebtPaid: "0" })}>
                        Clear old-debt payment
                      </button>
                    </div>
                  )}
                </>
              )}
              {oldDebtAmount !== null && oldDebtAmount > 0 && !debtChecking && (
                <>
                  <p className="text-sm leading-5 text-stone-700">They can clear some or all of their old balance while buying these drinks.</p>
                  <label htmlFor="sale-old-debt-paid">Paying toward previous debt (₦)</label>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Quick previous-debt payment">
                    <button type="button" className="secondary w-full" aria-pressed={draft.oldDebtPaid === String(oldDebtAmount)} onClick={() => update({ oldDebtPaid: String(oldDebtAmount) })}>Pay old debt in full</button>
                    <button type="button" className="secondary w-full" aria-pressed={draft.oldDebtPaid === "0"} onClick={() => update({ oldDebtPaid: "0" })}>Not today</button>
                  </div>
                  <input
                    id="sale-old-debt-paid"
                    inputMode="numeric"
                    pattern="[0-9]+"
                    maxLength={12}
                    onFocus={selectDefaultZero}
                    onClick={selectDefaultZero}
                    value={draft.oldDebtPaid}
                    aria-invalid={Boolean(oldDebtInputError)}
                    aria-describedby={oldDebtInputError ? "old-debt-payment-error" : "old-debt-payment-note"}
                    onChange={(e) => update({ oldDebtPaid: e.target.value })}
                  />
                  <p id="old-debt-payment-note" className="text-xs text-stone-600">This pays down their older balance, not today&apos;s drinks.</p>
                  {oldDebtInputError && <p id="old-debt-payment-error" role="alert" className="text-sm text-red-800">{oldDebtInputError}</p>}
                </>
              )}
            </section>
            {Number(draft.paid) + Number(draft.oldDebtPaid) > 0 && (
              <div>
                <label htmlFor="sale-method">How is the customer paying?</label>
                <select id="sale-method" value={draft.paymentMethod} onChange={(e) => update({ paymentMethod: e.target.value })} required>
                  <option value="">Choose method</option>
                  <option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos">POS</option>
                </select>
                <p className="mt-1 text-xs text-stone-600">The same method applies to both amounts. The old-debt payment gets its own receipt.</p>
              </div>
            )}
            <section aria-label="Money to collect and customer balance" className="rounded-xl border border-emerald-200 bg-white p-4" aria-live="polite">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-stone-900">Collect now</span>
                <strong className="text-2xl font-bold tabular-nums text-emerald-950">{paymentBreakdown ? formatNaira(paymentBreakdown.collectNow) : "—"}</strong>
              </div>
              {paymentBreakdown && (
                <dl className="mt-3 space-y-2 border-t border-stone-200 pt-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-stone-600">Old debt left</dt>
                    <dd className="font-semibold">{formatNaira(paymentBreakdown.oldDebtRemaining)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-stone-600">Today&apos;s sale still unpaid</dt>
                    <dd className="font-semibold">{formatNaira(paymentBreakdown.saleRemaining)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-stone-200 pt-2 font-bold">
                    <dt>Total customer will owe</dt>
                    <dd className={paymentBreakdown.totalOwedAfter > 0 ? "text-amber-900" : "text-emerald-900"}>
                      {formatNaira(paymentBreakdown.totalOwedAfter)}
                    </dd>
                  </div>
                </dl>
              )}
            </section>
            <div className="sale-sticky-actions sticky z-10 -mx-4 flex items-center gap-3 border-t border-stone-200 bg-background px-4 pb-4 pt-3 sm:mx-0 sm:px-0">
            <button
              className="secondary min-h-12 shrink-0 px-4"
              onClick={() => update({ step: "empties" })}
            >
              Back
            </button>
            <button
              className="primary min-w-0 flex-1"
              disabled={
                pending ||
                total === undefined ||
                Boolean(paymentInputError) || Boolean(oldDebtInputError) || !paymentBreakdown || debtChecking ||
                (paymentBreakdown.collectNow > 0 && !["cash", "transfer", "pos"].includes(draft.paymentMethod))
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
                    const latestDebt = await loadCustomerMoneyOwed(draft.customerId);
                    if ("error" in latestDebt) {
                      const errorMessage = latestDebt.error ?? "Could not verify the customer's balance.";
                      if (debtKey) setDebtError({ key: debtKey, message: errorMessage });
                      setMessage(errorMessage);
                      return;
                    }
                    if (debtKey) setOldDebt({ key: debtKey, amount: latestDebt.amount });
                    salePaymentTotals(total!, Number(draft.paid), latestDebt.amount, Number(draft.oldDebtPaid));
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
              {pending
                ? "Checking…"
                : paymentBreakdown && paymentBreakdown.collectNow > 0
                  ? `Review · Collect ${formatNaira(paymentBreakdown.collectNow)}`
                  : "Review sale · pay later"}
            </button>
            </div>
          </>
        )}
        {step === "review" && (
          <>
            <p className="text-stone-700">Check this sale before saving it.</p>
            <p className="text-sm text-stone-600">
              Sale date: {draft.businessDate}
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

            <section aria-labelledby="review-drinks">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="review-drinks" className="text-xl font-bold text-stone-950">
                  Drinks · {draft.lines.length}
                </h2>
                {!saveUncertain && (
                  <button type="button" className="secondary gap-2 px-3 text-sm" onClick={() => update({ step: "drinks" })}>
                    <SaleIcon name="edit" className="h-4 w-4" /> Edit drinks
                  </button>
                )}
              </div>
              <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white px-3 sm:px-4">
                {draft.lines.map((line) => {
                  const p = catalog.products.find((item) => item.id === line.productId);
                  const packaging = emptiesReview?.lines.find(
                    (item) => item.productId === line.productId,
                  );
                  try {
                    const amount = formatNaira(reviewedLineTotal(line));
                    return (
                      <li key={line.productId} className="flex min-w-0 items-start gap-3 py-4">
                        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-stone-50">
                          {p ? <ProductImage src={p.image_url} name={p.name} /> : <span className="block p-2 text-xs">No photo</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="break-words font-semibold text-stone-950">{p ? p.name + " " + (p.size ?? "") : "Drink unavailable"}</p>
                          <p className="mt-1 text-sm text-stone-600">{saleQuantityLabel(line.quantity)}</p>
                          {packaging && (packaging.cratesOwed > 0 || packaging.bottlesOwed > 0) && (
                            <p className="mt-2 text-sm font-medium text-amber-900">{missingEmptiesMessage(packaging, p?.name ?? "Drink")}</p>
                          )}
                          <p className="mt-2 text-lg font-bold tabular-nums text-stone-950">{amount}</p>
                        </div>
                      </li>
                    );
                  } catch (e) {
                    return <li role="alert" key={line.productId} className="py-3 text-red-800">{(e as Error).message}</li>;
                  }
                })}
              </ul>
            </section>

            {emptiesReview && hasUnmatchedSaleEmpties(emptiesReview) && <div role="alert" className="rounded-lg bg-amber-50 p-3"><p>Some returned empties still need an Accept or Hold choice.</p><button type="button" className="quiet-link" onClick={() => update({ step: "empties" })}>Check these empties</button></div>}
            {emptiesReview?.decisions.map((choice, index) => <p key={`empty-choice-${index}`} className="rounded-lg bg-amber-50 p-3 text-sm">{catalog.products.find(product => product.id === choice.productId)?.name} · {choice.quantity} {choice.kind === "crate" ? catalog.crateTypes.find(crate => crate.id === choice.returnedType)?.name : choice.returnedType} {choice.kind === "crate" ? "crates" : "bottles"}: {choice.decision === "hold" ? "held for customer; correct type is still owed" : "accepted for this sale"}.</p>)}
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

            <dl className="rounded-xl border border-stone-200 bg-white px-4">
              <div className="flex justify-between gap-3 border-b border-stone-200 py-3">
                <dt>Sale total</dt>
                <dd className="font-semibold">{reviewTotal === undefined ? "Check drinks" : formatNaira(reviewTotal)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-stone-200 py-3">
                <dt>Paid toward today&apos;s sale</dt>
                <dd className="font-semibold">{formatNaira(Number(draft.paid))}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-stone-200 py-3">
                <dt>Paid toward previous debt</dt>
                <dd className="font-semibold">{formatNaira(Number(draft.oldDebtPaid))}</dd>
              </div>
              {Number(draft.paid) + Number(draft.oldDebtPaid) > 0 && <div className="flex justify-between gap-3 border-b border-stone-200 py-3"><dt>Method</dt><dd className="font-semibold">{{ cash: "Cash", transfer: "Bank transfer", pos: "POS" }[draft.paymentMethod as "cash" | "transfer" | "pos"] ?? "Choose a method"}</dd></div>}
              <div className="flex justify-between gap-3 py-3 text-lg font-semibold">
                <dt>Total to collect now</dt>
                <dd>{reviewTotal === undefined || oldDebtAmount === null ? "Check balances" : formatNaira(Number(draft.paid) + Number(draft.oldDebtPaid))}</dd>
              </div>
            </dl>
            {paymentBreakdown && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-950">Customer balance after this sale</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-amber-950">{formatNaira(paymentBreakdown.totalOwedAfter)}</p>
                <p className="mt-1 text-xs text-amber-950">Includes previous unpaid debt and any unpaid part of today&apos;s sale. Rechecked when saving.</p>
              </div>
            )}
            {debtErrorMessage && <p role="alert" className="text-sm text-amber-900">{debtErrorMessage}</p>}
            <div className="sale-sticky-actions sticky z-10 -mx-4 border-t border-stone-200 bg-background px-4 pb-4 pt-3 sm:mx-0 sm:px-0">
            <p className="mb-1 truncate text-sm font-semibold text-emerald-950">Sale for {customer?.name}</p>
            <p className="mb-2 text-xs text-stone-600">Saving updates stock, payment and any amount owed.</p>
            <button
              className="primary w-full"
              disabled={
                pending ||
                !draft.businessDate ||
                reviewTotal === undefined ||
                !emptiesReview ||
                hasUnmatchedSaleEmpties(emptiesReview) ||
                Number(draft.paid) > reviewTotal ||
                (!saveUncertain && (
                  !paymentBreakdown || debtChecking || Boolean(oldDebtInputError) ||
                  (paymentBreakdown.collectNow > 0 && !["cash", "transfer", "pos"].includes(draft.paymentMethod))
                ))
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
                  type="button"
                  className="secondary w-full gap-2"
                  onClick={() => update({ step: "empties" })}
                >
                  <SaleIcon name="edit" className="h-4 w-4" /> Edit empties
                </button>
              </>
            )}
          </>
        )}
      </fieldset>
    </>
  );
}
