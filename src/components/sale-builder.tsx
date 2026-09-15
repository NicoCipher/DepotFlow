"use client";
import { useState, useTransition } from "react";
import { loadSaleCatalog } from "@/app/(shop)/record-sale/actions";
import { ProductImage } from "@/components/product-image";
import { useSaleDraft } from "./sale-draft-session";
import { formatNaira } from "@/domain/products";
import { formatQuantity } from "@/domain/quantity";
import {
  matchesSaleCustomer,
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
  const [draft, writeDraft] = useSaleDraft(ownerId);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const customer = catalog.customers.find((c) => c.id === draft.customerId);
  const product = catalog.products.find((p) => p.id === draft.editingId);
  function update(patch: Partial<SaleDraft>) {
    writeDraft(patch);
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
        update({ step: "check" });
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
    <fieldset disabled={pending} aria-label="Sale draft" className="space-y-5">
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
          <label htmlFor="sale-customer-search">Search by name or phone</label>
          <input
            id="sale-customer-search"
            type="search"
            maxLength={120}
            value={draft.customerQuery}
            onChange={(e) => update({ customerQuery: e.target.value })}
          />
          {!catalog.customers.length && (
            <p>
              No customers yet. Add a customer in Customers before starting a
              sale.
            </p>
          )}
          <ul className="divide-y divide-stone-200">
            {catalog.customers
              .filter((c) => matchesSaleCustomer(c, draft.customerQuery))
              .map((c) => (
                <li key={c.id}>
                  <button
                    className="min-h-20 w-full py-4 text-left"
                    onClick={() => update({ customerId: c.id, step: "drinks" })}
                  >
                    <span className="block font-semibold">{c.name}</span>
                    <span className="text-sm text-stone-600">{c.phone}</span>
                  </button>
                </li>
              ))}
          </ul>
          {catalog.customers.length > 0 &&
            !catalog.customers.some((c) =>
              matchesSaleCustomer(c, draft.customerQuery),
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
                          {formatNaira(p.full_crate_price)} / crate
                        </span>
                        {line && (
                          <span className="block font-semibold">
                            In sale: {saleQuantityLabel(line.quantity)} · Change
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
              {pending ? "Checking stock…" : "Quick Check"}
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
                Whole crates · {formatNaira(product.full_crate_price)} each
              </label>
              <input
                id="sale-crates"
                inputMode="numeric"
                pattern="[0-9]+"
                required
                maxLength={10}
                value={draft.crates}
                onChange={(e) => update({ crates: e.target.value })}
              />
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
                      className={draft.fraction === f ? "primary" : "secondary"}
                      disabled={disabled}
                      onClick={() => update({ fraction: f })}
                    >
                      {["None", "¼", "½", "¾"][f]}
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
                inputMode="numeric"
                pattern="[0-9]+"
                required
                maxLength={10}
                value={draft.bottles}
                onChange={(e) => update({ bottles: e.target.value })}
              />
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
  );
}
