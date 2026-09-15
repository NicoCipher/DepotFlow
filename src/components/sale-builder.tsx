"use client";
import { useEffect, useState, useTransition } from "react";
import { loadSaleCatalog } from "@/app/(shop)/record-sale/actions";
import { ProductImage } from "@/components/product-image";
import { useSaleDrafts } from "./sale-draft-session";
import { PausedSalesLink } from "./paused-sales-link";
import { formatNaira } from "@/domain/products";
import { formatQuantity } from "@/domain/quantity";
import {
  matchesSaleCustomer,
  quantityPriceSet,
  revalidateSaleDraft,
  priceQuantity,
  putSaleLine,
  removeSaleLine,
  saleQuantityLabel,
  saleTotal,
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
  const [customerQuery, setCustomerQuery] = useState("");
  const [catalog, setCatalog] = useState(initialCatalog);
  const [message, setMessage] = useState("");
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
  let preview: ReturnType<typeof priceQuantity> | undefined;
  let quantityError = "";
  if (product)
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
  function quickCheck() {
    startTransition(async () => {
      try {
        const fresh = await loadSaleCatalog();
        setCatalog(fresh);
        await sales.update({ step: "check" });
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
                : "Quick Check"}
        </h1>
        <p className="text-sm text-stone-600">Record Sale · Draft only</p>
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
              <p>
                No customers yet. Add a customer in Customers before starting a
                sale.
              </p>
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
                  return (
                    <li key={p.id} className="py-4">
                      <button
                        className="flex min-h-24 w-full items-center gap-4 text-left"
                        disabled={!p.available}
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
                          {line && (
                            <span className="block font-semibold">
                              In sale: {saleQuantityLabel(line.quantity)} ·
                              Change
                            </span>
                          )}
                        </span>
                      </button>
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
                disabled={!draft.lines.length || pending}
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
                  onChange={(e) => update({ crates: e.target.value })}
                />
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
                  {product.quarter_crate_price === null
                    ? "Price not set"
                    : formatNaira(product.quarter_crate_price)}{" "}
                  · ½:{" "}
                  {product.half_crate_price === null
                    ? "Price not set"
                    : formatNaira(product.half_crate_price)}
                  . ¾ uses half + quarter.
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
                  onChange={(e) => update({ bottles: e.target.value })}
                />
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
              ) : (
                <p role="status" className="text-red-800">
                  {quantityError}
                </p>
              )}
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
          </>
        )}
      </fieldset>
    </>
  );
}
