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
      <h1>Edit customer</h1>
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
        <p
          role="status"
          className="mb-5 border-l-4 border-emerald-800 pl-3 text-emerald-900"
        >
          Empties terms saved.
        </p>
      )}
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
