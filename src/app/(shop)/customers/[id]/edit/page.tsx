import Link from "next/link";
import { SuccessToast } from "@/components/success-toast";
import { getCustomer } from "@/lib/customers/data";
import { CustomerForm } from "@/components/customer-form";
import { ArchiveCustomerControl } from "@/components/archive-customer-control";
import {
  allowCustomerToOweEmpties,
  requireCustomerEmptiesDeposit,
} from "@/app/(shop)/customers/actions";

export default async function EditCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { customer } = await getCustomer(id);
  const { saved } = await searchParams;
  return (
    <>
      <Link className="quiet-link mb-3 self-start" href={`/customers/${id}`}>
        ← Customer account
      </Link>
      <h1>Manage Customer</h1>
      <p className="mt-2 break-words text-xl font-semibold text-stone-700">
        {customer.name}
      </p>
      <Link
        href={`/customers/${id}/opening-balances`}
        className="mb-6 mt-5 flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4"
      >
        <span>
          <strong className="block text-emerald-950">Opening Balances</strong>
          <span className="mt-1 block text-sm leading-6 text-stone-600">
            Money, crates and bottles owed before DepotFlow
          </span>
        </span>
        <span aria-hidden="true">→</span>
      </Link>
      {(saved === "archive-failed" ||
        saved === "restore-failed" ||
        saved === "empties-terms-failed") && (
        <p
          role="alert"
          className="mb-5 border-l-4 border-red-800 pl-3 text-red-900"
        >
          {saved === "empties-terms-failed"
            ? "Could not save the empties terms. Please try again."
            : `Could not ${saved === "archive-failed" ? "archive" : "restore"} this customer. Please try again.`}
        </p>
      )}
      {saved === "empties-terms" && (
        <SuccessToast message="Empties terms saved." />
      )}
      <h2 className="mb-4 text-lg font-semibold">Customer details</h2>
      <CustomerForm
        id={id}
        editing
        initialValues={{
          name: customer.name,
          phone: customer.phone,
          business_name: customer.business_name ?? "",
          address: customer.address ?? "",
        }}
      />
      <section className="mt-10 border-t border-stone-300 pt-6">
        <h2 className="text-xl font-semibold">If empties are missing</h2>
        <p className="mt-2 text-stone-600">
          DepotFlow will use this automatically during a sale.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <form action={allowCustomerToOweEmpties.bind(null, id)}>
            <button
              className={
                customer.empties_deposit_required
                  ? "secondary w-full"
                  : "primary w-full"
              }
            >
              Can owe empties
            </button>
          </form>
          <form action={requireCustomerEmptiesDeposit.bind(null, id)}>
            <button
              className={
                customer.empties_deposit_required
                  ? "primary w-full"
                  : "secondary w-full"
              }
            >
              Deposit required
            </button>
          </form>
        </div>
      </section>
      <ArchiveCustomerControl
        id={id}
        archived={Boolean(customer.archived_at)}
      />
    </>
  );
}
