import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/auth/owner";
import { CustomerForm } from "@/components/customer-form";
import { emptyCustomer } from "@/domain/customers";

export default async function NewCustomerPage() {
  await requireOwner();
  return (
    <>
      <h1>Add Customer</h1>
      <CustomerForm id={randomUUID()} initialValues={emptyCustomer} />
    </>
  );
}
