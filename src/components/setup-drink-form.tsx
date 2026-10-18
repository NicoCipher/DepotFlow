"use client";

import { useActionState } from "react";
import { addSetupDrink } from "@/app/businesses/[businessId]/drinks/actions";
import type { AssortmentSetup } from "@/domain/business-assortment";

export function SetupDrinkForm({
  businessId, productId, catalogueId, crates,
}: {
  businessId: string;
  productId: string;
  catalogueId: string;
  crates: AssortmentSetup["crateTypes"];
}) {
  const [state, action, pending] = useActionState(addSetupDrink, { message: "" });
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4">
      <input type="hidden" name="business_id" value={businessId} />
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="catalogue_id" value={catalogueId} />
      <div>
        <label htmlFor="setup-physical-crate">Exact physical crate</label>
        <select id="setup-physical-crate" name="crate_type_id" required defaultValue=""
          className="w-full">
          <option value="" disabled>Select the matching crate type</option>
          {crates.map((crate) => (
            <option value={crate.id} key={crate.id}>
              {crate.name} · {crate.pockets} pockets · {crate.family}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs leading-5 text-stone-600">
          Choose the same crate type only when physical crates are interchangeable.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="setup-drink-pack">Bottles per crate</label>
          <input id="setup-drink-pack" name="pack" type="number"
            min={1} max={120} step={1} required placeholder="20" />
        </div>
        <div>
          <label htmlFor="setup-drink-size">Drink size (optional)</label>
          <input id="setup-drink-size" name="size" maxLength={120}
            placeholder="e.g. 60cl" />
        </div>
      </div>
      <div>
        <label htmlFor="setup-full-price">Your selling price per full crate (₦)</label>
        <input id="setup-full-price" name="full_price" type="number"
          min={50} step={50} required inputMode="numeric" placeholder="10000" />
        <p className="mt-1 text-xs text-stone-600">
          Use ₦50 increments. This is a selling price, not your buying cost.
        </p>
      </div>
      <div>
        <label htmlFor="setup-bottle-price">Selling price per loose bottle (₦, optional)</label>
        <input id="setup-bottle-price" name="bottle_price" type="number"
          min={0} step={50} inputMode="numeric" placeholder="500" />
      </div>
      <label className="flex items-center gap-3 text-sm leading-6">
        <input name="returnable" type="checkbox" className="size-4" />
        Customers return empty bottles for this drink
      </label>
      <div>
        <label htmlFor="setup-bottle-type">Returnable bottle type (only if checked)</label>
        <input id="setup-bottle-type" name="bottle_type" maxLength={120}
          placeholder="e.g. Goldberg empty bottle" />
        <p className="mt-1 text-xs leading-5 text-stone-600">
          Keep bottle identity separate from its physical empty crate.
        </p>
      </div>
      {state.message && <p role="alert" className="text-sm text-red-800">{state.message}</p>}
      <button className="primary min-h-12 w-full" disabled={pending || crates.length===0}>
        {pending ? "Adding drink…" : "Add drink to this depot"}
      </button>
      <p className="text-xs leading-5 text-stone-600">
        Drinks and prices are saved for this depot only. Stock counts are recorded
        later using separately audited opening balances.
      </p>
    </form>
  );
}
