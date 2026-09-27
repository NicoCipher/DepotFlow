import { getCustomer } from "@/lib/customers/data";
import { CustomerForm } from "@/components/customer-form";
import { ArchiveCustomerControl } from "@/components/archive-customer-control";

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
      {(saved === "archive-failed" || saved === "restore-failed") && (
        <p
          role="alert"
          className="mb-5 border-l-4 border-red-800 pl-3 text-red-900"
        >
          Could not {saved === "archive-failed" ? "archive" : "restore"} this
          customer. Please try again.
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
      <ArchiveCustomerControl
        id={id}
        archived={Boolean(customer.archived_at)}
      />
    </>
  );
}
