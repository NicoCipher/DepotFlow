"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  refreshSaleCatalog,
  saveSale,
  recoverSplitSale,
} from "@/app/(shop)/record-sale/actions";
import { CustomerForm } from "./customer-form";
import { emptyCustomer } from "@/domain/customers";
import { ProductImage } from "@/components/product-image";
import { SaleIcon } from "@/components/sale-icon";
import { salePaymentTotals, debtPaymentInputError, paymentReviewIssue, needsClearHiddenOldDebtPayment, splitPaymentFromReceived, oneMethodAmountsFromReceived } from "@/domain/sale-payment";
import { allocateSplitTender } from "@/domain/sale-tenders";
import { allocateMultiTender, emptyMultiAmounts, multiPaymentFromReceived } from "@/domain/multi-tenders";
import { MultiPaymentPanel } from "./multi-payment-panel";
import { requestSaleReview } from "@/domain/sale-review-http";
import { isSaleReviewProgressMessage, saleReviewCheckingMessage, saleReviewOpeningMessage, contextualSaleReviewMessage, clearOwnSaleReviewProgress, canApplySaleBalancePreview, shouldDisableSaleDraftControls } from "@/domain/sale-review-feedback";
import { shouldFocusSaleStep } from "@/domain/sale-step-focus";
import { useSaleDrafts } from "./sale-draft-session";
import { hasSaleWork } from "@/domain/sale-drafts";
import { PausedSalesLink } from "./paused-sales-link";
import { SaleEmptiesStep } from "./sale-empties-step";
import {
  matchSaleEmpties,
  allReturnedConfirmationKey,
  hasConfirmedAllReturned,
  hasNoExpectedSaleEmpties,
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
import { saleCardPrice } from "@/domain/sale-card-price";
import { formatQuantity } from "@/domain/quantity";
import {
  matchesSaleCustomer,
  currentSaleFeedback,
  modeForSaleDrink,
  changeSaleCustomer,
  hasCustomerBoundSaleWork,
  saleSaveConfirmationKey,
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
  const [removeLineId, setRemoveLineId] = useState<string | null>(null);
  const [requestedMode, setRequestedMode] = useState<"wholesale" | "retail" | null>(null);
  const [requestedPaymentMode, setRequestedPaymentMode] = useState<"single" | "split" | "multi" | null>(null);
  const [requestedSingleMethod, setRequestedSingleMethod] = useState<"cash" | "transfer" | "pos" | null>(null);
  const [requestedCustomerId, setRequestedCustomerId] = useState<string | null>(null);
  const [confirmNewCustomer, setConfirmNewCustomer] = useState(false);
  const [confirmedSaveKey, setConfirmedSaveKey] = useState<string | null>(null);
  const pricingMode = draft.sellingMode === "retail" ? "retail" : "wholesale";
  const browsingMode = draft.preferredSellingMode === "retail" ? "retail" : "wholesale";
  const splitEnabled = process.env.NEXT_PUBLIC_SPLIT_TENDER_ENABLED === "true";
  const multiEnabled = process.env.NEXT_PUBLIC_MULTI_TENDER_ENABLED === "true";
  const [catalog, setCatalog] = useState(initialCatalog);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [oldDebt, setOldDebt] = useState<{ key: string; amount: number } | null>(null);
  const [debtError, setDebtError] = useState<{ key: string; message: string } | null>(null);
  const [debtRefresh, setDebtRefresh] = useState(0);
  // A slower background balance preview must never overwrite a fresh,
  // authoritative Review response, even if it resolves on the next tick.
  const debtPreviewGeneration = useRef(0);
  const debtPreviewAbort = useRef<AbortController | null>(null);
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
  // Review is an independent, abortable HTTP read, not a Server Action.
  // A different checkout transition must never silently swallow Review taps.
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewBusyRef = useRef(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<{ step: string; activeId: string | null } | null>(null);
  const activeId = sales.state.active
    ? `${sales.state.active.id}:${sales.state.active.resumedAt ?? ""}`
    : null;
  const reviewFeedbackAttempt = useRef(0);
  const [reviewFeedbackContext, setReviewFeedbackContext] = useState<{ customerId: string | null; activeId: string | null }>({ customerId: draft.customerId, activeId });
  const checkoutContext = useRef({ customerId: draft.customerId, activeId, step: draft.step });
  useEffect(() => {
    checkoutContext.current = { customerId: draft.customerId, activeId, step: draft.step };
  }, [draft.customerId, draft.step, activeId]);
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
  const visibleMessage = currentSaleFeedback(message, customer?.id ?? null);
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
    setConfirmedSaveKey(null);
    setRemoveLineId(null);
    setRequestedMode(null);
    setRequestedPaymentMode(null);
    setRequestedSingleMethod(null);
    setRequestedCustomerId(null);
    setConfirmNewCustomer(false);
    setMessage("");
    setNotice("");
    setCancelDraftId(null);
  }
  function setPaymentModeSafely(next: "single" | "split" | "multi") {
    if (draft.paymentMode === next) return;
    const hasPayment = draft.paymentMode === "split"
      ? draft.splitCash !== "0" || draft.splitTransfer !== "0" || draft.oldDebtPaid !== "0"
      : draft.paymentMode === "multi"
        ? Object.values(draft.multiReceived).some(v => v !== "0") ||
          Object.values(draft.multiOldDebt).some(v => v !== "0")
        : Number(draft.paid) > 0 || Number(draft.oldDebtPaid) > 0;
    if (hasPayment) {
      setRequestedPaymentMode(next);
      return;
    }
    applyPaymentMode(next);
  }
  function chooseSingleMethod(method: "cash" | "transfer" | "pos") {
    if (draft.paymentMode === "single" && draft.paymentMethod === method) return;
    if (draft.paymentMode === "multi" && draft.multiMethods.filter(m => Number(draft.multiReceived[m]) > 0).length > 1) {
      setMessage("More than one payment method has money entered. Remove the extra method before switching to one.");
      return;
    }
    if (draft.paymentMode === "split" && Number(draft.splitCash) > 0 && Number(draft.splitTransfer) > 0) {
      setMessage("Cash and Transfer are both recorded. Correct the amounts first; do not label both as one method.");
      return;
    }
    const hasPayment = Number(draft.paid) > 0 || Number(draft.oldDebtPaid) > 0 ||
      Number(draft.splitCash) > 0 || Number(draft.splitTransfer) > 0;
    if (hasPayment && (draft.paymentMode !== "single" || Boolean(draft.paymentMethod))) {
      setRequestedPaymentMode("single");
      setRequestedSingleMethod(method);
      return;
    }
    if (draft.paymentMode === "single") update({ paymentMethod: method });
    else applyPaymentMode("single", method);
  }
  function applyPaymentMode(next: "single" | "split" | "multi", method: "cash" | "transfer" | "pos" | "" = "") {
    if (next === "multi") {
      const validMethod = ["cash", "transfer", "pos"].includes(draft.paymentMethod)
        ? draft.paymentMethod as "cash" | "transfer" | "pos" : null;
      if (draft.paymentMode === "split") {
        try {
          const legs = allocateSplitTender(Number(draft.paid), Number(draft.oldDebtPaid), {
            cash: draft.splitCash, transfer: draft.splitTransfer,
            ...(draft.splitCashToSale ? { cashToSale: draft.splitCashToSale } : {}),
          });
          update({ paymentMode: "multi", paymentMethod: "mixed",
            multiMethods: ["cash", "transfer"],
            multiReceived: {cash: draft.splitCash, transfer: draft.splitTransfer, pos: "0"},
            multiOldDebt: {cash: String(legs[0].oldDebtAmount), transfer: String(legs[1].oldDebtAmount), pos: "0"} });
        } catch {
          setMessage("Correct the Cash and Transfer amounts before switching to multiple methods.");
        }
        return;
      }
      update({ paymentMode: "multi", paymentMethod: "mixed",
        multiMethods: validMethod ? [validMethod] : [],
        multiReceived: { ...emptyMultiAmounts(), ...(validMethod ? { [validMethod]: String(Number(draft.paid) + Number(draft.oldDebtPaid)) } : {}) },
        multiOldDebt: { ...emptyMultiAmounts(), ...(validMethod ? { [validMethod]: draft.oldDebtPaid } : {}) },
      });
    } else if (next === "split")
      update({ paymentMode: "split", paymentMethod: "mixed", paid: "0",
        oldDebtPaid: "0", splitCash: "0", splitTransfer: "0", splitCashToSale: "" });
    else if (draft.paymentMode === "single") {
      // Changing only the tender method must NEVER reset entered money.
      update({ paymentMethod: method });
    } else {
      if (draft.paymentMode === "multi") {
        const positive = draft.multiMethods.filter(m => Number(draft.multiReceived[m]) > 0);
        if (positive.length > 1) {
          setMessage("Remove extra payment methods before choosing one.");
          return;
        }
        const selected = positive[0];
        if (selected && selected !== method) {
          setMessage("The recorded payment is " + selected.toUpperCase() + ". Choose the same method before continuing.");
          return;
        }
        const received = selected ? Number(draft.multiReceived[selected]) : 0;
        const old = selected ? Number(draft.multiOldDebt[selected]) : 0;
        if (!Number.isSafeInteger(received) || !Number.isSafeInteger(old) || old > received) {
          setMessage("Correct the received and previous-debt amounts first.");
          return;
        }
        update({ paymentMode: "single", paymentMethod: method,
          paid: String(received - old), oldDebtPaid: String(old),
          multiMethods: [], multiReceived: emptyMultiAmounts(), multiOldDebt: emptyMultiAmounts() });
        return;
      }
      if (Number(draft.splitCash) > 0 && Number(draft.splitTransfer) > 0) {
        setMessage("Keep Cash and Transfer separate. Do not record both as one method.");
        return;
      }
      // Never carry a stale planned paid amount out of a resumed split draft.
      // Invalid received amounts are explicitly discarded, not silently
      // recorded as a valid one-method payment.
      const entry = splitPaymentFromReceived({
        saleTotal: total, oldDebt: oldDebtAmount, oldDebtPaid: draft.oldDebtPaid,
        cash: draft.splitCash, transfer: draft.splitTransfer,
      });
      update({ paymentMode: "single", paymentMethod: method,
        ...oneMethodAmountsFromReceived(entry),
        splitCash: "0", splitTransfer: "0", splitCashToSale: "" });
    }
  }
  function useMultiSingle(method: "cash" | "transfer" | "pos" | "") {
    const positives = draft.multiMethods.filter(m => Number(draft.multiReceived[m]) > 0);
    if (positives.length > 1 || (method && positives.length === 1 && positives[0] !== method)) {
      setMessage("Keep the recorded methods separate. Remove an extra method first.");
      return;
    }
    const received = method ? Number(draft.multiReceived[method]) : 0;
    const towardOld = method ? Number(draft.multiOldDebt[method]) : 0;
    if (!Number.isSafeInteger(received) || !Number.isSafeInteger(towardOld) ||
        towardOld < 0 || received < towardOld) {
      setMessage("Correct the payment amounts first.");
      return;
    }
    update({ paymentMode: "single", paymentMethod: method,
      paid: String(received - towardOld), oldDebtPaid: String(towardOld),
      multiMethods: [], multiReceived: emptyMultiAmounts(), multiOldDebt: emptyMultiAmounts() });
  }
  // Keep entered money and sale-paid ledger fields in one atomic draft patch.
  // An invalid/incomplete input stays editable, but never creates a new paid amount.
  function updateSplitTender(field: "splitCash" | "splitTransfer", raw: string) {
    const cash = field === "splitCash" ? raw : draft.splitCash;
    const transfer = field === "splitTransfer" ? raw : draft.splitTransfer;
    const entry = splitPaymentFromReceived({
      saleTotal: total, oldDebt: oldDebtAmount,
      oldDebtPaid: draft.oldDebtPaid, cash, transfer,
    });
    update({
      [field]: raw,
      ...(entry.issue === null && entry.salePaid !== null
        ? { paid: String(entry.salePaid) } : {}),
    });
  }
  function updateSplitOldDebt(raw: string) {
    const entry = splitPaymentFromReceived({
      saleTotal: total, oldDebt: oldDebtAmount,
      oldDebtPaid: raw, cash: draft.splitCash, transfer: draft.splitTransfer,
    });
    update({
      oldDebtPaid: raw,
      splitCashToSale: "",
      ...(entry.issue === null && entry.salePaid !== null
        ? { paid: String(entry.salePaid) } : {}),
    });
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
    const desiredMode = modeForSaleDrink(draft, q);
    const mode = desiredMode === "retail" && p.bottle_price === null ? "wholesale" : desiredMode;
    update({
      sellingMode: mode,
      step: "quantity",
      editingId: p.id,
      crates: String(q?.crates ?? 0),
      fraction: q?.fraction ?? 0,
      eighths: q?.eighths ?? 0,
      bottles: String(q?.bottles ?? 0),
    });
    if (desiredMode === "retail" && mode === "wholesale")
      setMessage("This drink has no retail bottle price. Check the wholesale price before adding it.");
  }
  function requestQuantityMode(next: "wholesale" | "retail") {
    if (next === pricingMode) return;
    if (Number(draft.crates) > 0 || Number(draft.bottles) > 0 || draft.fraction > 0 || (draft.eighths ?? 0) > 0) {
      setRequestedMode(next);
      return;
    }
    update({ sellingMode: next, crates: "0", fraction: 0, eighths: 0, bottles: "0" });
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
  const emptiesNeedConfirmation = draft.emptiesV2.mode === "exact" &&
    (!emptiesReview || !hasConfirmedAllReturned(draft, emptiesReview));
  const paymentInputError = (() => {
    const inputError = wholeNumberInputMessage(draft.paid, "amount paid");
    if (inputError) return inputError;
    if (total !== undefined && Number(draft.paid) > total)
      return `Amount paid cannot be more than ${formatNaira(total)}.`;
    return "";
  })();

  async function quickCheck() {
    // The catalogue was loaded by the server for this visit and refreshed in
    // the background. Don't wait for another full network fetch just to show
    // empty-return questions. The payment review fetches fresh prices, stock
    // and customer debt, and the sale RPC independently validates again.
    const checked = revalidateSaleDraft(draft, catalog);
    if (checked.warnings.length) {
      setMessage(checked.warnings[0]);
      return;
    }
    let expected: ReturnType<typeof matchSaleEmpties>;
    try {
      expected = matchSaleEmpties({
        ...draft, emptiesV2: { ...draft.emptiesV2, mode: "exact", decisions: [] },
      }, catalog);
    } catch (cause) {
      await sales.update({ step: "empties" });
      setMessage(cause instanceof Error ? cause.message : "Check the empty crates and empty bottles.");
      return;
    }
    const skipEmpties = draft.emptiesV2.mode === "exact" && hasNoExpectedSaleEmpties(expected);
    const updated = await sales.update(skipEmpties
      ? {
          step: "payment",
          emptiesV2: {
            ...draft.emptiesV2, mode: "exact", decisions: [],
            confirmedAllReturned: allReturnedConfirmationKey(draft, expected),
          },
        }
      : { step: "empties" });
    if (!updated) {
      setMessage("Could not save this step on your device. Try again.");
      return;
    }
    setMessage("");
  }
  function available(p: SaleProduct) {
    return p.available === null
      ? "Stock not recorded"
      : p.available === 0
        ? "Out of stock"
        : `Available: ${formatQuantity(p.available, p.bottles_per_crate)}`;
  }
  const step = customer ? draft.step : "customer";
  const paymentDisplayMessage = contextualSaleReviewMessage(visibleMessage,
    reviewFeedbackContext, { customerId: draft.customerId, activeId, step });
  const customerToCheck = customer?.id ?? null;
  const debtKey = customerToCheck && (step === "payment" || step === "review")
    ? `${customerToCheck}:${debtRefresh}`
    : null;
  useEffect(() => {
    if (!customerToCheck || !debtKey) return;
    let current = true;
    const generation = ++debtPreviewGeneration.current;
    const controller = new AbortController();
    debtPreviewAbort.current = controller;
    const canApply = () => canApplySaleBalancePreview(generation, debtPreviewGeneration.current, current);
    // Unlike a Server Function, this independent HTTP request can be aborted.
    // A stalled read must never trap the customer on this payment screen.
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    void (async () => {
      try {
        const response = await fetch("/api/sales/customer-balance", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: customerToCheck }),
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!canApply()) return;
        if (response.status === 401 || response.status === 403) {
          setSessionExpired(true);
          setMessage(saleSessionExpiredMessage);
          return;
        }
        if (!response.ok) {
          const explanation = typeof payload === "object" && payload !== null && "error" in payload
            && typeof payload.error === "string"
            ? payload.error : "Could not load the previous balance. Try again.";
          setDebtError({ key: debtKey, message: explanation });
          return;
        }
        const amount = typeof payload === "object" && payload !== null && "amount" in payload
          ? payload.amount : null;
        if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
          setDebtError({ key: debtKey, message: "Could not verify the previous balance. Try again." });
          return;
        }
        setOldDebt({ key: debtKey, amount });
        setDebtError(null);
      } catch {
        if (canApply()) {
          setDebtError({
            key: debtKey,
            message: controller.signal.aborted
              ? "Balance check took too long. Try again."
              : "Could not load the previous balance. Try again.",
          });
        }
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      current = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [customerToCheck, debtKey]);
  const debtErrorMessage = debtError?.key === debtKey ? debtError.message : "";
  const debtChecking = Boolean(debtKey && oldDebt?.key !== debtKey && !debtErrorMessage);
  const oldDebtAmount = debtKey && oldDebt?.key === debtKey ? oldDebt.amount : null;
  const oldDebtInputError = debtPaymentInputError(draft.oldDebtPaid, oldDebtAmount);
  const splitEntry = splitEnabled && draft.paymentMode === "split" ? splitPaymentFromReceived({
    saleTotal: total, oldDebt: oldDebtAmount,
    oldDebtPaid: draft.oldDebtPaid, cash: draft.splitCash, transfer: draft.splitTransfer,
  }) : null;
  const splitConversionPreview = draft.paymentMode === "split" ?
    splitPaymentFromReceived({
      saleTotal: total, oldDebt: oldDebtAmount,
      oldDebtPaid: draft.oldDebtPaid, cash: draft.splitCash, transfer: draft.splitTransfer,
    }) : null;
  const splitEntryNeedsSync = !!splitEntry && splitEntry.issue === null &&
    splitEntry.salePaid !== Number(draft.paid);
  const paymentBreakdown = (() => {
    if (splitEntry && (splitEntry.issue || splitEntryNeedsSync)) return null;
    if (total === undefined || paymentInputError || oldDebtInputError) return null;
    // Until a fresh balance arrives, use zero ONLY to preview what is
    // collected today when no old debt is being paid. Never display the
    // unverified final customer balance as though it were authoritative.
    if (oldDebtAmount === null && Number(draft.oldDebtPaid) !== 0) return null;
    try { return salePaymentTotals(total, Number(draft.paid), oldDebtAmount ?? 0, Number(draft.oldDebtPaid)); }
    catch { return null; }
  })();
  const splitLegsPreview = (() => {
    if (!splitEnabled || draft.paymentMode !== "split") return null;
    try {
      return allocateSplitTender(Number(draft.paid), Number(draft.oldDebtPaid), {
        cash: draft.splitCash, transfer: draft.splitTransfer,
        ...(draft.splitCashToSale ? { cashToSale: draft.splitCashToSale } : {}),
      });
    } catch {
      return null;
    }
  })();
  const paymentIssue = paymentReviewIssue({
    saleTotal: total,
    paymentInputError,
    oldDebtInputError,
    oldDebtAmount,
    oldDebtPaid: draft.oldDebtPaid,
    debtChecking,
    debtErrorMessage,
    breakdown: paymentBreakdown,
    paymentMethod: draft.paymentMethod,
    salePaid: draft.paid,
    paymentMode: draft.paymentMode,
    splitCash: draft.splitCash,
    splitTransfer: draft.splitTransfer,
    splitCashToSale: draft.splitCashToSale,
    splitEnabled,
    splitEntryIssue: splitEntry?.issue || (splitEntryNeedsSync
      ? "Use the received Cash + Transfer amount to update this unfinished sale." : null),
  });
  const navigationBusy = pending || reviewBusy;
  const reviewKey = saleSaveConfirmationKey(draft, oldDebtAmount, reviewTotal);
  const finalSaveConfirmed = confirmedSaveKey === reviewKey;
  // Keep the first-step button mounted at the same location: repeated taps
  // activate Check again, never the distinct final Save action.
  const savePromptRef = useRef<HTMLParagraphElement>(null);
  // Move keyboard focus to non-actionable guidance; Tab then reaches final Save.
  // Never autofocus the financial write button or reuse the initial tap target.
  useEffect(() => {
    if (finalSaveConfirmed && !saveUncertain) savePromptRef.current?.focus();
  }, [finalSaveConfirmed, saveUncertain]);
  // "Check Sale" must remain usable even when catalogue refresh is offline:
  // an uncertain save can only be resolved by the original request ID.
  const reviewSaveBlocked = pending || (!ready && !saveUncertain) || !draft.businessDate ||
    reviewTotal === undefined || !emptiesReview || emptiesNeedConfirmation ||
    hasUnmatchedSaleEmpties(emptiesReview) || Number(draft.paid) > reviewTotal ||
    (!saveUncertain && (!paymentBreakdown || debtChecking || Boolean(oldDebtInputError) ||
      (draft.paymentMode === "split" && (!splitEnabled || !splitLegsPreview)) ||
      (paymentBreakdown.collectNow > 0 && draft.paymentMode !== "split" &&
        !["cash", "transfer", "pos"].includes(draft.paymentMethod))));
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
  const backStep = step === "drinks" ? "customer" :
    step === "quantity" || step === "empties" ? "drinks" :
    step === "payment" ? (emptiesReview && hasNoExpectedSaleEmpties(emptiesReview) ? "drinks" : "empties") :
    step === "review" ? "payment" : null;
  const backLabel = backStep === "customer" ? "Customer" :
    backStep === "drinks" ? "Drinks" : backStep === "empties" ? "Empty returns" : "Payment";
  const matchedCustomers = catalog.customers.filter((c) => matchesSaleCustomer(c, customerQuery));
  useEffect(() => {
    const previous = previousStep.current;
    // Rehydrating a locally saved draft switches the initial empty "customer"
    // snapshot to its restored step. That is NOT user navigation and should
    // not focus/draw a green rectangle around the heading after refresh.
    if (shouldFocusSaleStep(previous, { step, activeId })) {
      stepHeading.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    previousStep.current = { step, activeId };
  }, [step, activeId]);
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
            <p className="mt-2 text-stone-600">This accounting receipt records the old-debt payment separately from today&apos;s sale.</p>
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
            setMessage("");
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
        <div role={checkError ? "alert" : "status"} className="mb-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
          <p>{checkError || "Checking current prices and stock in the background. You can keep preparing the sale."}</p>
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
        disabled={shouldDisableSaleDraftControls(step, pending, reviewBusy)}
        aria-busy={reviewBusy || pending}
        aria-label="Sale draft"
        className="space-y-3 pb-4"
      >
        <header className={step === "payment" ? "space-y-2 border-b border-stone-200 pb-2" : "space-y-3 border-b border-stone-200 pb-3"}>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="shrink-0 text-xs font-bold uppercase tracking-wide text-emerald-800">
              Step {progressStep + 1} of 5
            </p>
            {saleHasWork && (
              <div role="group" aria-label="Unfinished sale actions" className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-950 hover:border-emerald-700 hover:bg-emerald-100"
                  disabled={saveUncertain || navigationBusy}
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
                  disabled={saveUncertain || navigationBusy}
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
          {backStep && !saveUncertain && step !== "payment" && (
            <button type="button" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-900"
              disabled={navigationBusy}
              onClick={() => update({ step: backStep })}>
              <span aria-hidden="true">←</span> Back to {backLabel}
            </button>
          )}
          <h1 ref={stepHeading} tabIndex={-1} className={step === "payment" ? "text-2xl font-bold tracking-tight text-emerald-950 outline-none" : "outline-none"}>
            {step === "customer" ? "Who is buying?" : step === "drinks" ? "Choose drinks" : step === "quantity" ? "Set the quantity" : step === "empties" ? "Check the empties" : step === "payment" ? "Record payment" : "Review and save"}
          </h1>
          {step !== "drinks" && step !== "payment" && (
            <p className="text-sm leading-5 text-stone-600">
              {step === "customer" ? "Find the customer to begin." : step === "quantity" ? "Enter the quantity, then add it to the sale." : step === "empties" ? "Check the empty crates and empty bottles returned." : "Check the sale details before saving."}
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
          <section aria-label="Current customer" className={step === "payment" ? "flex min-w-0 items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2" : "flex min-w-0 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2"}>
            <span className={step === "payment" ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-900" : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-900"}>
              <SaleIcon name="user" className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-xs text-stone-500">Customer</span>
              <strong className="block truncate text-sm text-stone-950 sm:text-base" title={customer.name}>{customer.name}</strong>
            </div>
            <button type="button" className={step === "payment" ? "min-h-11 shrink-0 rounded-lg px-2 text-sm font-semibold text-emerald-900 underline underline-offset-2" : "secondary min-h-11 shrink-0 gap-1 px-3 py-2 text-sm"} onClick={() => update({ step: "customer" })}>
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
                    disabled={navigationBusy}
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
                    disabled={navigationBusy}
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
        {visibleMessage && step !== "payment" && !isSaleReviewProgressMessage(visibleMessage) && (
          <p
            role="alert"
            className={saveUncertain ? "text-amber-900" : "text-red-800"}
          >
            {visibleMessage}
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
              onClick={() => {
                if (draft.customerId && hasCustomerBoundSaleWork(draft)) setConfirmNewCustomer(true);
                else setNewCustomer({ id: crypto.randomUUID(), draftId: sales.state.active?.id ?? null });
              }}
            >
              <SaleIcon name="plus" className="h-5 w-5" /> Add new customer
            </button>
            {confirmNewCustomer && (
              <div role="group" aria-label="Confirm creating a new customer for this sale" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="font-bold text-amber-950">Create a different customer for this sale?</p>
                <p className="mt-1 text-sm text-amber-950">Your drinks will stay, but payments and empty-return choices for the current customer will be cleared after the new customer is created.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" className="secondary min-h-11" onClick={() => setConfirmNewCustomer(false)}>Keep customer</button>
                  <button type="button" className="primary min-h-11" onClick={() => {
                    setConfirmNewCustomer(false);
                    setNewCustomer({ id: crypto.randomUUID(), draftId: sales.state.active?.id ?? null });
                  }}>Continue</button>
                </div>
              </div>
            )}
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
            {requestedCustomerId && requestedCustomerId !== draft.customerId && (
              <div role="group" aria-label="Confirm changing customer" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="font-bold text-amber-950">
                  Change this sale to {catalog.customers.find((c) => c.id === requestedCustomerId)?.name ?? "another customer"}?
                </p>
                <p className="mt-1 text-sm text-amber-950">The drinks will stay. The amounts paid and empty-return choices will be cleared so they cannot be put on the wrong customer&apos;s account.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" className="secondary min-h-11" onClick={() => setRequestedCustomerId(null)}>Keep customer</button>
                  <button type="button" className="primary min-h-11" onClick={() => {
                    update(changeSaleCustomer(draft, requestedCustomerId));
                  }}>Yes, change customer</button>
                </div>
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
                    onClick={() => {
                      if (draft.customerId && draft.customerId !== c.id && hasCustomerBoundSaleWork(draft)) {
                        setRequestedCustomerId(c.id);
                        return;
                      }
                      update(changeSaleCustomer(draft, c.id));
                    }}
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
            <section aria-labelledby="sale-price-preference" className="rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
              <h2 id="sale-price-preference" className="text-base font-bold text-stone-950">How is the customer buying?</h2>
              <p className="mt-1 text-sm text-stone-600">Choose how to price the next drink. You can change it for each drink.</p>
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Pricing for the next drink">
                {(["wholesale", "retail"] as const).map((mode) => (
                  <button key={mode} type="button"
                    aria-pressed={browsingMode === mode}
                    className={(browsingMode === mode
                      ? "border-emerald-800 bg-emerald-50 text-emerald-950"
                      : "border-stone-200 bg-white text-stone-800") + " min-h-16 rounded-xl border-2 px-3 py-3 text-left"}
                    onClick={() => update({ preferredSellingMode: mode })}>
                    <span className="block font-bold">{mode === "retail" ? "Retail" : "Wholesale"}</span>
                    <span className="mt-1 block text-xs">{mode === "retail" ? "Bottles at bottle price" : "Crates and parts of crates"}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-emerald-900" role="status">
                Showing {browsingMode === "retail" ? "retail bottle" : "wholesale crate"} prices below.
              </p>
              {draft.lines.length > 0 && <p className="mt-1 text-xs text-stone-600">Already added drinks keep their prices. This choice only affects the next new drink.</p>}
            </section>
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
                            <button type="button" className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-red-800 hover:border-red-300 hover:bg-red-50"
                              aria-expanded={removeLineId === line.productId}
                              onClick={() => setRemoveLineId(removeLineId === line.productId ? null : line.productId)}>
                              <SaleIcon name="trash" className="h-4 w-4" /> Remove
                            </button>
                          </div>
                          {removeLineId === line.productId && (
                            <div role="group" aria-label="Confirm removing drink" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                              <p className="text-sm font-bold text-red-950">Remove {item?.name ?? "this drink"} from the sale?</p>
                              <p className="mt-1 text-xs text-red-900">Only this unsaved drink will be removed. The total and expected empty returns will update.</p>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <button type="button" className="secondary min-h-11" onClick={() => setRemoveLineId(null)}>Keep drink</button>
                                <button type="button" className="min-h-11 rounded-lg bg-red-800 px-3 text-sm font-bold text-white" onClick={() => update({ lines: removeSaleLine(draft.lines, line.productId) })}>Yes, remove</button>
                              </div>
                            </div>
                          )}
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
                  const shownPrice = saleCardPrice(p, browsingMode);
                  const selectable = Boolean(p.available) && !setupIssue && shownPrice.available;
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
                            <span className="mt-1 block text-sm font-bold text-emerald-950" aria-label={browsingMode + " price: " + shownPrice.primary}>
                              {shownPrice.primary}
                            </span>
                            <span className="block text-xs text-stone-600">{shownPrice.secondary}</span>
                            <span className={line ? "mt-2 flex items-center gap-1 text-sm font-bold text-emerald-900" : "mt-2 flex items-center gap-1 text-sm font-bold text-emerald-800"}>
                              {setupIssue ? "Setup needed" : !p.available ? "Cannot add" : !shownPrice.available ? "Set price for " + browsingMode : line
                                ? <><SaleIcon name="check" className="h-4 w-4" /> In this sale · Change</>
                                : <><SaleIcon name="plus" className="h-4 w-4" /> Add this drink</>}
                            </span>
                          </span>
                        </button>
                        {(setupIssue || !shownPrice.available) && (
                          <Link className="quiet-link mx-3 mb-2 inline-block text-sm" href={"/products/" + p.id + "/edit"}>
                            {setupIssue ? "Finish drink setup" : browsingMode === "retail" ? "Set retail bottle price" : "Set wholesale crate price"}
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
                {pending ? "Working…" : draft.lines.length ? "Next: Empty returns" : "Add a drink"}
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
                  <button type="button" aria-pressed={pricingMode === "wholesale"} className={(pricingMode === "wholesale" ? "border-emerald-800 bg-emerald-50 text-emerald-950" : "border-stone-200 bg-white text-stone-800") + " min-h-24 rounded-lg border-2 px-3 py-3 text-left"} onClick={() => requestQuantityMode("wholesale")}>
                    <span className="block font-bold">Wholesale</span>
                    <span className="mt-1 block text-xs leading-5">Crates and parts of a crate</span>
                  </button>
                  <button type="button" aria-pressed={pricingMode === "retail"} className={(pricingMode === "retail" ? "border-emerald-800 bg-emerald-50 text-emerald-950" : "border-stone-200 bg-white text-stone-800") + " min-h-24 rounded-lg border-2 px-3 py-3 text-left"} disabled={product.bottle_price === null} onClick={() => requestQuantityMode("retail")}>
                    <span className="block font-bold">Retail</span>
                    <span className="mt-1 block text-xs leading-5">Every bottle at bottle price</span>
                  </button>
                </div>
                {requestedMode && requestedMode !== pricingMode && (
                  <div role="group" aria-label="Confirm price mode change" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="font-bold text-amber-950">Switch this drink to {requestedMode === "retail" ? "Retail" : "Wholesale"}?</p>
                    <p className="mt-1 text-sm text-amber-950">The quantity entered on this screen will be cleared. Any drink already saved in this sale remains unchanged until you save a new quantity.</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" className="secondary min-h-11" onClick={() => setRequestedMode(null)}>Keep quantity</button>
                      <button type="button" className="primary min-h-11" onClick={() => update({ sellingMode: requestedMode, crates: "0", fraction: 0, eighths: 0, bottles: "0" })}>Yes, switch mode</button>
                    </div>
                  </div>
                )}
                {!requestedMode && <p className="mt-2 text-xs leading-5 text-stone-600">Changing the pricing mode clears the quantity on this screen, after you confirm.</p>}
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
            <fieldset disabled={pending || reviewBusy} aria-label="Payment details" className="min-w-0">
              <section id="sale-method" tabIndex={-1} aria-label="Payment and customer balance"
                className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_4px_18px_rgba(16,65,46,0.07)]">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-800 px-4 py-3.5 text-white">
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium text-emerald-100">Today&apos;s sale</h2>
                    <p className="mt-0.5 text-xs text-emerald-200">Amount to settle</p>
                  </div>
                  <strong className="min-w-0 break-words text-2xl font-bold tracking-tight tabular-nums text-white [overflow-wrap:anywhere]">
                    {total === undefined ? "Check drinks" : formatNaira(total)}
                  </strong>
                </div>
                <div className="px-3 pb-4 pt-3 sm:px-4">
                <div>
                  <p className="mb-2 text-sm font-semibold tracking-tight text-stone-900">How was it paid?</p>
                  <div role="group" aria-label="How the customer paid"
                    className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(["cash", "transfer", "pos"] as const).map((method) => (
                      <button key={method} type="button"
                        className={draft.paymentMode !== "split" && draft.paymentMethod === method
                          ? "flex min-h-12 items-center justify-center gap-2 rounded-xl border border-emerald-800 bg-emerald-900 px-2 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors"
                          : "flex min-h-12 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-50/70 px-2 py-2.5 text-sm font-semibold text-stone-800 transition-colors hover:border-emerald-300 hover:bg-emerald-50"}
                        aria-pressed={draft.paymentMode !== "split" && draft.paymentMethod === method}
                        onClick={() => chooseSingleMethod(method)}>
                        <SaleIcon name={method} className="h-[18px] w-[18px] shrink-0" />
                        {method === "cash" ? "Cash" : method === "transfer" ? "Transfer" : "POS"}
                      </button>
                    ))}
                    {splitEnabled && (
                      <button type="button"
                        className={draft.paymentMode === "split"
                          ? "flex min-h-12 items-center justify-center gap-2 rounded-xl border border-emerald-800 bg-emerald-900 px-2 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors"
                          : "flex min-h-12 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-50/70 px-2 py-2.5 text-sm font-semibold text-stone-800 transition-colors hover:border-emerald-300 hover:bg-emerald-50"}
                        aria-pressed={draft.paymentMode === "split"}
                        onClick={() => setPaymentModeSafely("split")}>
                        <SaleIcon name="split" className="h-[18px] w-[18px] shrink-0" />
                        Cash + Transfer
                      </button>
                    )}
                  </div>
                  {draft.paymentMode === "split" && Number(draft.splitCash) > 0 &&
                    Number(draft.splitTransfer) > 0 && (
                    <p className="mt-2 text-xs text-stone-600">Both methods have money entered. Change one amount to ₦0 before switching to one method.</p>
                  )}
                  {requestedPaymentMode && (
                    <div role="group" aria-label="Confirm payment method change"
                      className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                      <p className="font-semibold text-stone-900">Change payment method?</p>
                      <p className="mt-1 text-stone-700">
                        {requestedPaymentMode === "split"
                          ? "The previous payment amount will reset. Enter Cash and Transfer received."
                          : draft.paymentMode === "split"
                            ? splitConversionPreview?.issue
                              ? "The Cash + Transfer amounts cannot be verified. Changing methods will clear those amounts and reset both payments to ₦0. Keep the current method if this is not what you want."
                              : "The split breakdown will be cleared and the verified received amount will be used."
                            : "The amount stays the same, but its payment method will change."}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button type="button" className="secondary min-h-11 text-sm"
                          onClick={() => { setRequestedPaymentMode(null); setRequestedSingleMethod(null); }}>Keep current</button>
                        <button type="button" className="primary min-h-11 text-sm"
                          onClick={() => applyPaymentMode(requestedPaymentMode, requestedSingleMethod ?? "")}>Confirm change</button>
                      </div>
                    </div>
                  )}
                  {draft.paymentMode === "split" && !splitEnabled && (
                    <div id="sale-split-payment" role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                      <p>Cash + Transfer is temporarily unavailable. Keep both real payment methods recorded. If both have money entered, park this sale until split payments return; do not record them as one method.</p>
                      <p className="mt-1 font-semibold">Cash {draft.splitCash ? formatNaira(Number(draft.splitCash)) : "—"} · Transfer {draft.splitTransfer ? formatNaira(Number(draft.splitTransfer)) : "—"}</p>
                      {!(Number(draft.splitCash) > 0 && Number(draft.splitTransfer) > 0) && (
                        <button type="button" className="secondary mt-2 w-full min-h-11"
                          onClick={() => setPaymentModeSafely("single")}>Return to one method</button>
                      )}
                    </div>
                  )}
                </div>

                {draft.paymentMode !== "split" && (
                  <div className="mt-4 border-t border-stone-100 pt-3">
                    <label className="mb-1 text-sm" htmlFor="sale-paid">Received for today&apos;s sale (₦)</label>
                    <div className="flex min-w-0 gap-2">
                      <input id="sale-paid" inputMode="numeric" pattern="[0-9]+" maxLength={12}
                        onFocus={selectDefaultZero} onClick={selectDefaultZero}
                        value={draft.paid} aria-invalid={Boolean(paymentInputError)}
                        aria-describedby={paymentInputError ? "sale-paid-error" : undefined}
                        onChange={(event) => update({ paid: event.target.value })} />
                      <button type="button" className="secondary min-h-11 shrink-0 px-3 text-sm"
                        disabled={total === undefined}
                        onClick={() => total !== undefined && update({ paid: String(total) })}>
                        Full
                      </button>
                    </div>
                    {paymentInputError && <p id="sale-paid-error" role="alert" className="mt-1 text-sm text-red-800">{paymentInputError}</p>}
                    {Number(draft.paid) === 0 && <p className="mt-1 text-xs text-stone-500">₦0 means the customer will pay later.</p>}
                  </div>
                )}

                {draft.paymentMode === "split" && splitEnabled && (
                  <div id="sale-split-payment" tabIndex={-1} className="mt-4 border-t border-stone-100 pt-3">
                    <p className="mb-2 text-sm font-semibold text-stone-900">Amount received</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <label className="mb-1 text-xs" htmlFor="sale-cash-received">Cash (₦)</label>
                        <input id="sale-cash-received" inputMode="numeric" pattern="[0-9]+" maxLength={12}
                          value={draft.splitCash} onFocus={selectDefaultZero} onClick={selectDefaultZero}
                          onChange={(event) => updateSplitTender("splitCash", event.target.value)} />
                      </div>
                      <div className="min-w-0">
                        <label className="mb-1 text-xs" htmlFor="sale-transfer-received">Transfer (₦)</label>
                        <input id="sale-transfer-received" inputMode="numeric" pattern="[0-9]+" maxLength={12}
                          value={draft.splitTransfer} onFocus={selectDefaultZero} onClick={selectDefaultZero}
                          onChange={(event) => updateSplitTender("splitTransfer", event.target.value)} />
                      </div>
                    </div>
                    {splitEntry && splitEntry.issue === null && splitEntry.received !== null &&
                      ((Number(draft.splitCash) > 0 && Number(draft.splitTransfer) === 0) ||
                       (Number(draft.splitTransfer) > 0 && Number(draft.splitCash) === 0)) && (
                      <button type="button" className="mt-2 text-sm font-semibold text-emerald-900 underline underline-offset-2"
                        onClick={() => update({
                          paymentMode: "single",
                          paymentMethod: Number(draft.splitCash) > 0 ? "cash" : "transfer",
                          ...oneMethodAmountsFromReceived(splitEntry),
                          splitCash: "0", splitTransfer: "0", splitCashToSale: "",
                        })}>
                        Only one method received? Switch to {Number(draft.splitCash) > 0 ? "Cash" : "Transfer"}
                      </button>
                    )}
                    {Number(draft.splitCash) === 0 && Number(draft.splitTransfer) === 0 &&
                      Number(draft.oldDebtPaid) === 0 && (
                      <button type="button" className="mt-2 text-sm font-semibold text-emerald-900 underline underline-offset-2"
                        onClick={() => update({ paymentMode: "single", paymentMethod: "", paid: "0",
                          oldDebtPaid: "0", splitCash: "0", splitTransfer: "0", splitCashToSale: "" })}>
                        No payment today? Record as pay later
                      </button>
                    )}
                    {splitEntry?.issue && (
                      <p role="alert" className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-950">{splitEntry.issue}</p>
                    )}
                    {splitEntry && splitEntry.extraForOldDebt > 0 && oldDebtAmount !== null &&
                      Number(draft.oldDebtPaid) + splitEntry.extraForOldDebt <= oldDebtAmount && (
                      <button type="button" className="secondary mt-2 min-h-11 w-full text-sm"
                        onClick={() => updateSplitOldDebt(String(Number(draft.oldDebtPaid) + splitEntry.extraForOldDebt))}>
                        Apply extra {formatNaira(splitEntry.extraForOldDebt)} to old debt
                      </button>
                    )}
                    {Number(draft.oldDebtPaid) === 0 && draft.splitCashToSale !== "" && (
                      <button type="button" className="secondary mt-2 min-h-11 w-full text-sm"
                        onClick={() => update({ splitCashToSale: "" })}>
                        Clear previous Cash allocation
                      </button>
                    )}
                    {splitEntryNeedsSync && splitEntry?.salePaid !== null && (
                      <button type="button" className="secondary mt-2 min-h-11 w-full text-sm"
                        onClick={() => update({ paid: String(splitEntry.salePaid) })}>
                        Reconcile resumed payment to {formatNaira(splitEntry.received ?? 0)}
                      </button>
                    )}
                  </div>
                )}

                <div id="sale-previous-debt" tabIndex={-1} className="mt-4 border-t border-stone-100 pt-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold text-stone-800">Previous debt</span>
                    <strong className="tabular-nums text-stone-900">
                      {oldDebtAmount === null ? "Checking…" : formatNaira(oldDebtAmount)}
                    </strong>
                  </div>
                  {debtChecking && <p role="status" className="mt-1 text-xs text-stone-600">Checking the current balance…</p>}
                  {debtErrorMessage && (
                    <div role="alert" className="mt-2 flex items-center justify-between gap-2 text-sm text-amber-950">
                      <span>{debtErrorMessage}</span>
                      <button type="button" className="secondary shrink-0 min-h-11 px-2 text-sm"
                        onClick={() => setDebtRefresh((value) => value + 1)}>Retry</button>
                    </div>
                  )}
                  {oldDebtAmount === 0 && needsClearHiddenOldDebtPayment(draft.oldDebtPaid) && (
                    <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-950">
                      Previous debt is cleared. Remove the old-debt payment to continue.
                      <button type="button" className="secondary mt-2 w-full min-h-11 text-sm"
                        onClick={() => splitEnabled && draft.paymentMode === "split" ?
                          updateSplitOldDebt("0") : update({ oldDebtPaid: "0", splitCashToSale: "" })}>
                        Clear old-debt payment
                      </button>
                    </div>
                  )}
                  {oldDebtAmount !== null && oldDebtAmount > 0 && (
                    <details open={Number(draft.oldDebtPaid) > 0 || Boolean(oldDebtInputError)}
                      className="mt-2 rounded-lg border border-stone-200 px-3 py-2">
                      <summary className="flex min-h-11 cursor-pointer items-center py-2 text-sm font-semibold text-emerald-900">
                        {Number(draft.oldDebtPaid) > 0
                          ? `${formatNaira(Number(draft.oldDebtPaid))} paying old debt · Change`
                          : "Pay some old debt (optional)"}
                      </summary>
                      <p className="mt-1 text-xs text-stone-600">Only money actually received can be applied to previous debt.</p>
                      <label className="mb-1 mt-2 text-sm" htmlFor="sale-old-debt-paid">Amount for old debt (₦)</label>
                      <input id="sale-old-debt-paid" inputMode="numeric" pattern="[0-9]+" maxLength={12}
                        onFocus={selectDefaultZero} onClick={selectDefaultZero}
                        value={draft.oldDebtPaid} aria-invalid={Boolean(oldDebtInputError)}
                        aria-describedby={oldDebtInputError ? "old-debt-payment-error" : undefined}
                        onChange={(event) => draft.paymentMode === "split" && splitEnabled
                          ? updateSplitOldDebt(event.target.value)
                          : update({ oldDebtPaid: event.target.value, splitCashToSale: "" })} />
                      {oldDebtInputError && <p id="old-debt-payment-error" role="alert" className="mt-1 text-sm text-red-800">{oldDebtInputError}</p>}
                      {draft.paymentMode === "split" && splitEnabled && Number(draft.oldDebtPaid) > 0 && (
                        <details open={draft.splitCashToSale !== ""} className="mt-2 rounded-lg border border-stone-200 px-2 py-2">
                          <summary className="cursor-pointer text-xs font-semibold text-emerald-900">
                            Adjust Cash used for today&apos;s sale
                          </summary>
                          <label className="mt-2 text-sm" htmlFor="sale-split-cash-sale">Cash for today&apos;s sale (₦)</label>
                          <input id="sale-split-cash-sale" inputMode="numeric" pattern="[0-9]+" maxLength={12}
                            placeholder="Cash first" value={draft.splitCashToSale}
                            onChange={(event) => update({ splitCashToSale: event.target.value })} />
                          {splitLegsPreview && (
                            <p className="mt-1 text-xs text-stone-600">
                              Today&apos;s sale: Cash {formatNaira(splitLegsPreview[0].saleAmount)} + Transfer {formatNaira(splitLegsPreview[1].saleAmount)}.
                              Old debt: Cash {formatNaira(splitLegsPreview[0].oldDebtAmount)} + Transfer {formatNaira(splitLegsPreview[1].oldDebtAmount)}.
                            </p>
                          )}
                        </details>
                      )}
                    </details>
                  )}
                </div>
                <dl className="mt-4 rounded-xl border border-emerald-100 bg-gradient-to-b from-emerald-50/80 to-white px-3 py-3 text-sm sm:px-4" aria-live="polite">
                  <div className="grid grid-cols-1 gap-3 min-[440px]:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Received now</dt>
                      <dd className="mt-1 break-words text-xl font-bold tabular-nums text-emerald-950 [overflow-wrap:anywhere]">
                        {paymentBreakdown ? formatNaira(paymentBreakdown.collectNow)
                          : splitEntry?.received !== null && splitEntry?.received !== undefined
                            ? formatNaira(splitEntry.received) : "—"}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-stone-600">Unpaid today</dt>
                      <dd className="mt-1 break-words text-xl font-bold tabular-nums text-stone-900 [overflow-wrap:anywhere]">
                        {paymentBreakdown ? formatNaira(paymentBreakdown.saleRemaining) : "—"}
                      </dd>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-emerald-100 pt-2.5">
                    <dt className="text-stone-600">Old debt left</dt>
                    <dd className="min-w-0 break-words text-right font-semibold tabular-nums [overflow-wrap:anywhere]">
                      {paymentBreakdown && oldDebtAmount !== null
                        ? formatNaira(paymentBreakdown.oldDebtRemaining)
                        : "Confirm on Review"}
                    </dd>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <dt className="font-semibold text-stone-900">Total customer will owe</dt>
                    <dd className="min-w-0 break-words text-right text-base font-bold tabular-nums text-amber-900 [overflow-wrap:anywhere]">
                      {paymentBreakdown && oldDebtAmount !== null
                        ? formatNaira(paymentBreakdown.totalOwedAfter)
                        : "Confirm on Review"}
                    </dd>
                  </div>
                </dl>
                </div>
              </section>
            </fieldset>
            <div className="sale-sticky-actions sticky z-10 -mx-4 space-y-2 border-t border-stone-200 bg-background px-4 pb-4 pt-3 sm:mx-0 sm:px-0">
            {paymentIssue && (
              <p id="payment-review-help" role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                {paymentIssue.message}
              </p>
            )}
            {!paymentIssue && oldDebtAmount === null && (
              <p role="status" className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                Previous balance will be checked securely when you tap Review. No payment toward old debt will be recorded.
              </p>
            )}
            {!paymentIssue && paymentDisplayMessage && (
              isSaleReviewProgressMessage(paymentDisplayMessage) ? (
                <p id="payment-review-progress" role="status" className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700">
                  {paymentDisplayMessage}
                </p>
              ) : (
                <p id="payment-review-error" role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
                  {paymentDisplayMessage}
                </p>
              )
            )}
            <div className="flex items-center gap-3">
            <button
              className="secondary min-h-12 shrink-0 px-4"
              disabled={navigationBusy}
              onClick={() => update({ step: backStep ?? "empties" })}
            >
              Back
            </button>
            <button
              type="button"
              className="primary min-w-0 flex-1"
              disabled={reviewBusy}
              aria-describedby={paymentIssue ? "payment-review-help" : undefined}
              onClick={() => {
                if (paymentIssue) {
                  // Explain why the tap cannot advance, rather than only
                  // scrolling to a field (which appeared to do nothing).
                  setMessage(paymentIssue.message);
                  const target = document.getElementById(paymentIssue.target);
                  target?.scrollIntoView({ behavior: "smooth", block: "center" });
                  target?.focus({ preventScroll: true });
                  return;
                }
                if (reviewBusyRef.current) return;
                reviewBusyRef.current = true;
                setReviewBusy(true);
                // Immediate visible acknowledgement proves the tap was received.
                // This also distinguishes a blocked network read from a blocked
                // draft-storage write on the customer's phone.
                const requestId = ++reviewFeedbackAttempt.current;
                setReviewFeedbackContext({ customerId: customer?.id ?? null, activeId });
                setMessage(saleReviewCheckingMessage);
                const clearOwnProgress = () => setMessage((current) =>
                  clearOwnSaleReviewProgress(current, requestId, reviewFeedbackAttempt.current));
                void (async () => {
                  try {
                    const customerForReview = customer?.id;
                    const saleForReview = activeId;
                    if (!customerForReview) {
                      setMessage("Choose a customer first.");
                      return;
                    }
                    const reviewIsCurrent = () =>
                      checkoutContext.current.customerId === customerForReview &&
                      checkoutContext.current.activeId === saleForReview &&
                      checkoutContext.current.step === "payment" &&
                      reviewFeedbackAttempt.current === requestId;
                    let fresh: SaleCatalog;
                    let latestDebt: number;
                    try {
                      // A stalled background Server Function must not block
                      // payment Review. This independent HTTP read is abortable.
                      const controller = new AbortController();
                      const timeout = window.setTimeout(() => controller.abort(), 20000);
                      let response: Awaited<ReturnType<typeof requestSaleReview>>;
                      try {
                        response = await requestSaleReview(customerForReview, controller.signal);
                      } finally {
                        window.clearTimeout(timeout);
                      }
                      // Auth expiry affects the entire checkout, even if another
                      // customer or draft was selected while the request ran.
                      if ("error" in response && response.code === "session_expired") {
                        setSessionExpired(true);
                        setMessage(saleSessionExpiredMessage);
                        return;
                      }
                      // Customer-bound responses belong only to their original
                      // customer, active sale and payment step.
                      if (!reviewIsCurrent()) {
                        clearOwnProgress();
                        return;
                      }
                      if ("error" in response) {
                        const errorMessage = response.error ?? saleNetworkMessage;
                        if (response.code === "debt_unavailable") {
                          if (debtKey) setDebtError({ key: debtKey, message: errorMessage });
                        }
                        setMessage(errorMessage);
                        return;
                      }
                      fresh = response.catalog;
                      latestDebt = response.amount;
                      setMessage(saleReviewOpeningMessage);
                      if (activeId) setVerifiedId(activeId);
                      setCheckError("");
                    } catch {
                      // Any failed/hung request returns an actionable message
                      // beside Review. A retry creates a new independent fetch.
                      if (reviewIsCurrent())
                        setMessage("Could not check this sale. Check your connection and tap Review again.");
                      else clearOwnProgress();
                      return;
                    }
                    try {
                      // Review is the authority. Invalidate any older preview
                      // request BEFORE installing this balance, or a stale
                      // response could overwrite it after navigation.
                      debtPreviewGeneration.current++;
                      debtPreviewAbort.current?.abort();
                      debtPreviewAbort.current = null;
                      if (debtKey) setOldDebt({ key: debtKey, amount: latestDebt });
                      setDebtError(null);
                      salePaymentTotals(total!, Number(draft.paid), latestDebt, Number(draft.oldDebtPaid));
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
                      const moved = await sales.enterReview(draft, {
                        lines,
                        businessDate:
                          draft.businessDate ||
                          new Date().toLocaleDateString("sv-SE"),
                      });
                      if (!moved) {
                        if (reviewIsCurrent()) setMessage("Could not open Review. The active sale may have changed in another tab, or this device could not save the step. Check the currently open or paused sale before retrying.");
                        else clearOwnProgress();
                        return;
                      }
                      clearOwnProgress();
                    } catch (e) {
                      if (reviewIsCurrent()) setMessage(
                        e instanceof Error
                          ? e.message
                          : "Check this sale and try again.",
                      );
                      else clearOwnProgress();
                    }
                  } finally {
                    reviewBusyRef.current = false;
                    setReviewBusy(false);
                  }
                })();
              }}
            >
              {reviewBusy
                ? "Checking sale…"
                : paymentIssue ? (paymentIssue.target === "sale-method" ? "Choose payment method" : "Fix payment details to continue")
                : paymentBreakdown && paymentBreakdown.collectNow > 0
                  ? draft.paymentMode === "split"
                    ? `Review · Received ${formatNaira(paymentBreakdown.collectNow)}`
                    : `Review · Collect ${formatNaira(paymentBreakdown.collectNow)}`
                  : "Review sale · pay later"}
            </button>
            </div>
            </div>
          </>
        )}
        {step === "review" && (
          <>
            <section aria-label="Sale overview" className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Final review</p>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="min-w-0 break-words text-lg font-bold text-stone-950">{customer?.name ?? "Customer"}</h2>
                <p className="text-2xl font-bold tabular-nums text-stone-950">{reviewTotal === undefined ? "Check drinks" : formatNaira(reviewTotal)}</p>
              </div>
              <p className="mt-1 text-sm text-stone-600">{draft.lines.length} {draft.lines.length === 1 ? "drink" : "drinks"} · Check amounts and empty returns below before saving.</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-600">
                <span>Sale date: {draft.businessDate}</span>
                <details>
                  <summary className="cursor-pointer font-semibold text-emerald-800 underline underline-offset-4">Change date</summary>
                  <label className="mt-2 block" htmlFor="sale-date">Business date</label>
                  <input id="sale-date" type="date" disabled={saveUncertain} value={draft.businessDate} onChange={(e) => update({ businessDate: e.target.value })} />
                </details>
              </div>
            </section>

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
                      <li key={line.productId} className="flex min-w-0 items-start gap-3 py-3">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-stone-50 sm:h-20 sm:w-20">
                          {p ? <ProductImage src={p.image_url} name={p.name} /> : <span className="block p-2 text-xs">No photo</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="break-words font-semibold text-stone-950">{p ? p.name + " " + (p.size ?? "") : "Drink unavailable"}</p>
                          <p className="mt-1 text-sm text-stone-600">{saleQuantityLabel(line.quantity)}</p>
                          {packaging && (packaging.cratesOwed > 0 || packaging.bottlesOwed > 0) && (
                            <p className="mt-2 text-sm font-medium text-amber-900">{missingEmptiesMessage(packaging, p?.name ?? "Drink")}</p>
                          )}
                          <p className="mt-1 text-base font-bold tabular-nums text-stone-950">{amount}</p>
                        </div>
                      </li>
                    );
                  } catch (e) {
                    return <li role="alert" key={line.productId} className="py-3 text-red-800">{(e as Error).message}</li>;
                  }
                })}
              </ul>
            </section>

            {emptiesReview && (
              <section aria-labelledby="sale-review-empty-returns" className="rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="sale-review-empty-returns" className="font-bold text-stone-950">Empty crates and empty bottles</h2>
                  {!saveUncertain && emptiesReview.lines.some((line) => line.cratesOut > 0 || line.bottlesOut > 0) && (
                    <button type="button" className="secondary min-h-11 px-3 text-sm" onClick={() => update({ step: "empties" })}>
                      Edit empty returns
                    </button>
                  )}
                </div>
                {(() => {
                  const cratesOwed = emptiesReview.lines.reduce((sum, line) => sum + line.cratesOwed, 0);
                  const bottlesOwed = emptiesReview.lines.reduce((sum, line) => sum + line.bottlesOwed, 0);
                  const needed = emptiesReview.lines.some((line) => line.cratesOut > 0 || line.bottlesOut > 0);
                  if (!needed) return <p className="mt-2 text-sm text-stone-700">No empty crates or empty bottles required for this sale.</p>;
                  if (emptiesNeedConfirmation) {
                    return <p role="alert" className="mt-2 text-sm font-semibold text-amber-950">The empty crate or empty bottle requirements changed. Confirm what came back before saving.</p>;
                  }
                  return cratesOwed || bottlesOwed
                    ? <p className="mt-2 text-sm font-semibold text-amber-950">
                        After this sale, the customer will still owe {cratesOwed} {cratesOwed === 1 ? "empty crate" : "empty crates"} and {bottlesOwed} {bottlesOwed === 1 ? "empty bottle" : "empty bottles"} from these drinks.
                      </p>
                    : <p className="mt-2 text-sm font-semibold text-emerald-900">All expected empty crates and empty bottles accounted for. This sale adds no new empties owed.</p>;
                })()}
                <p className="mt-2 text-xs text-stone-600">This is only for today&apos;s sale. Any older empty returns owed remain on the customer account. No records change until Save Sale.</p>
              </section>
            )}
            {emptiesNeedConfirmation && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-semibold text-amber-950">Empty crates and empty bottles need confirmation.</p><p className="mt-1 text-amber-950">Check the empty crates and empty bottles expected before saving.</p><button type="button" className="quiet-link mt-2" onClick={() => update({ step: "empties" })}>Confirm empty returns</button></div>}
            {emptiesReview && hasUnmatchedSaleEmpties(emptiesReview) && <div role="alert" className="rounded-lg bg-amber-50 p-3"><p>Some different empty crates or empty bottles still need a decision.</p><button type="button" className="quiet-link" onClick={() => update({ step: "empties" })}>Check different empty returns</button></div>}
            {emptiesReview?.decisions.map((choice, index) => <p key={`empty-choice-${index}`} className="rounded-lg bg-amber-50 p-3 text-sm">{catalog.products.find(product => product.id === choice.productId)?.name} · {choice.quantity} {choice.kind === "crate" ? catalog.crateTypes.find(crate => crate.id === choice.returnedType)?.name : choice.returnedType} {choice.kind === "crate" ? "empty crates" : "empty bottles"}: {choice.decision === "hold" ? "held for customer; correct type is still owed" : "accepted for this sale"}.</p>)}
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
                  Empty crate replacement: {swap.quantity} {from?.name ?? "returned empty crate"} for{" "}
                  {to?.name ?? "expected empty crate"}
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
              {Number(draft.oldDebtPaid) > 0 && (
                <div className="flex justify-between gap-3 border-b border-stone-200 py-3">
                  <dt>Paid toward previous debt</dt>
                  <dd className="font-semibold">{formatNaira(Number(draft.oldDebtPaid))}</dd>
                </div>
              )}
              {Number(draft.paid) + Number(draft.oldDebtPaid) > 0 && (
                <>
                  <div className="flex justify-between gap-3 border-b border-stone-200 py-3">
                    <dt>Method</dt>
                    <dd className="font-semibold">{draft.paymentMode === "split" ? "Cash + Transfer" : ({ cash: "Cash", transfer: "Bank transfer", pos: "POS" }[draft.paymentMethod as "cash" | "transfer" | "pos"] ?? "Choose a method")}</dd>
                  </div>
                  {splitLegsPreview && splitLegsPreview.map((leg) => (
                    <div key={leg.method} className="flex justify-between gap-3 border-b border-stone-200 py-2 text-sm">
                      <dt>{leg.method === "cash" ? "Cash received" : "Transfer received"}</dt>
                      <dd className="font-semibold">{formatNaira(leg.amount)}</dd>
                    </div>
                  ))}
                </>
              )}
              <div className="flex justify-between gap-3 py-3 text-lg font-semibold">
                <dt>Total to collect now</dt>
                <dd>{reviewTotal === undefined ? "Check drinks" : oldDebtAmount === null && Number(draft.oldDebtPaid) !== 0 ? "Check balances" : formatNaira(Number(draft.paid) + Number(draft.oldDebtPaid))}</dd>
              </div>
            </dl>
            {paymentBreakdown && oldDebtAmount !== null && (
              <div className={paymentBreakdown.totalOwedAfter > 0 ? "rounded-xl border border-amber-200 bg-amber-50 p-4" : "rounded-xl border border-emerald-200 bg-emerald-50 p-4"}>
                <p className={paymentBreakdown.totalOwedAfter > 0 ? "text-sm font-semibold text-amber-950" : "text-sm font-semibold text-emerald-950"}>
                  {paymentBreakdown.totalOwedAfter > 0 ? "Customer will still owe" : "No balance owed after this sale"}
                </p>
                <p className={paymentBreakdown.totalOwedAfter > 0 ? "mt-1 text-2xl font-bold tabular-nums text-amber-950" : "mt-1 text-2xl font-bold tabular-nums text-emerald-950"}>{formatNaira(paymentBreakdown.totalOwedAfter)}</p>
                {paymentBreakdown.totalOwedAfter > 0 && <p className="mt-1 text-xs text-amber-950">Includes unpaid previous debt and any unpaid amount from this sale.</p>}
              </div>
            )}
            {oldDebtAmount === null && !saveUncertain && (
              <p role="status" className="text-sm text-stone-600">Checking the customer&apos;s previous balance. Any amount still owed will be confirmed when saving.</p>
            )}
            {debtErrorMessage && <p role="alert" className="text-sm text-amber-900">{debtErrorMessage}</p>}
            <div className="sale-sticky-actions sticky z-10 -mx-4 border-t border-stone-200 bg-background/95 px-4 pb-3 pt-3 shadow-[0_-6px_18px_rgba(0,0,0,0.04)] backdrop-blur-sm sm:mx-0 sm:px-0 sm:shadow-none">
              {!saveUncertain && finalSaveConfirmed && (
                <div role="status" aria-live="polite" aria-label="Confirm saving sale" className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p ref={savePromptRef} tabIndex={-1} className="font-bold text-emerald-950">Save this sale?</p>
                  <p className="mt-1 text-sm text-emerald-950">{customer?.name} · {reviewTotal === undefined ? "Check total" : formatNaira(reviewTotal)} sale · Collect {formatNaira(Number(draft.paid) + Number(draft.oldDebtPaid))}</p>
                  <p className="mt-1 text-xs text-stone-700">Confirm to update stock, payment and customer balance.</p>
                </div>
              )}
            {(saveUncertain || finalSaveConfirmed) && (
              <button
                type="button"
                className="primary w-full"
                disabled={reviewSaveBlocked}
              onClick={() => {
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
                    // Never re-run a split financial write while its original
                    // outcome is uncertain, even if the feature flag is still on.
                    // Reconcile the saved request under its advisory lock.
                    response = saveUncertain && draft.paymentMode === "split"
                      ? await recoverSplitSale(requestId, draft)
                      : await saveSale(requestId, draft);
                  } catch {
                    setMessage(saleSaveUncertainMessage);
                    return;
                  }

                  if (response.error) {
                    if (response.code === "save_uncertain") {
                      setMessage(response.error);
                      return;
                    }
                    if (response.code === "sale_not_saved") {
                      // The database fenced the original ID against late
                      // writes. Rotate the draft ID before unlocking it.
                      // Never unlock the old request, even if device storage
                      // cannot be updated right now.
                      if (!(await sales.restartAfterConfirmedNonSave(requestId))) {
                        setMessage(sales.error ||
                          "This sale was not saved, but the draft could not be unlocked. Keep it open and tap Check Sale again.");
                        return;
                      }
                      setConfirmedSaveKey(null);
                      setVerifiedId(null);
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

                    if (response.code === "empties_changed") {
                      // The server checked the latest product/empty setup before
                      // starting the sale transaction. Keep the unfinished sale,
                      // discard the old confirmation, and require fresh catalog
                      // details before the operator can confirm it again.
                      const moved = await sales.update({
                        step: "empties",
                        emptiesV2: { ...draft.emptiesV2, confirmedAllReturned: null },
                      });
                      if (!moved) {
                        setMessage(sales.error || "Could not update the sale on this device. Try again.");
                        return;
                      }
                      setVerifiedId(null);
                      setCheckAttempt((n) => n + 1);
                      setMessage(response.error);
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

                  if ("result" in response && response.result) {
                    if (await sales.complete(requestId))
                      setSaved({
                        ...response.result,
                        name: customer?.name ?? "Customer",
                      });
                  }
                });
              }}
            >
              {pending
                ? saveUncertain
                  ? "Checking…"
                  : "Saving…"
                : saveUncertain
                  ? "Check Sale"
                  : finalSaveConfirmed
                    ? "Confirm & save sale"
                    : "Confirm sale details"}
              </button>
              )}
              {!saveUncertain && (
                <>
                  <button
                    type="button"
                    className={finalSaveConfirmed ? "secondary mt-2 w-full" : "primary w-full"}
                    disabled={reviewSaveBlocked}
                    onClick={() => setConfirmedSaveKey(finalSaveConfirmed ? null : reviewKey)}
                  >
                    {finalSaveConfirmed ? "Check again" : "Continue to save"}
                  </button>
                  <button type="button" className="quiet-link mt-1 w-full text-sm font-semibold" onClick={() => update({ step: "payment" })}>
                    ← Edit payment
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </fieldset>
    </>
  );
}
