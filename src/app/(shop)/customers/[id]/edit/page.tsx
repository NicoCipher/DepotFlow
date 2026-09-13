import { getCustomer } from "@/lib/customers/data";
import { CustomerForm } from "@/components/customer-form";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { customer } = await getCustomer(id);
  return (
    <>
      <h1>Edit customer</h1>
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
    </>
  );
}
