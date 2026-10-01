import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getCustomer } from "@/lib/customers/data";
import { EmptyReturnForm } from "@/components/empty-return-form";
export default async function ReturnEmptiesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { customer, supabase } = await getCustomer(id);
  const [crates, bottles, types, held] = await Promise.all([
    supabase
      .from("crate_obligations")
      .select("crate_type_id,crate_type,quantity")
      .eq("customer_id", id)
      .gt("quantity", 0)
      .order("crate_type_id"),
    supabase
      .from("bottle_obligations")
      .select("bottle_type,quantity")
      .eq("customer_id", id)
      .gt("quantity", 0)
      .order("bottle_type"),
    supabase.from("crate_types").select("id,name"),
    supabase
      .from("sale_empty_decisions")
      .select("id,kind,returned_name,quantity")
      .eq("customer_id", id)
      .eq("decision", "hold")
      .is("released_at", null)
      .order("id"),
  ]);
  if ([crates, bottles, types, held].some((result) => result.error))
    throw new Error("Could not load this customer's empties.");
  const names = new Map(types.data?.map((type) => [type.id, type.name]));
  return (
    <div className="space-y-5">
      <Link href={`/customers/${id}`} className="quiet-link">
        ← {customer.name}
      </Link>
      <header>
        <h1>Empties brought back</h1>
        <p className="mt-2 text-stone-600">
          {customer.name} · Enter the correct types that came back today.
        </p>
      </header>
      <EmptyReturnForm
        request={randomUUID()}
        customer={id}
        crates={(crates.data ?? []).map((row) => ({
          id: row.crate_type_id,
          name: names.get(row.crate_type_id) ?? row.crate_type ?? "Empty crate",
          owed: row.quantity,
        }))}
        bottles={(bottles.data ?? []).map((row) => ({
          id: row.bottle_type,
          name: row.bottle_type,
          owed: row.quantity,
        }))}
        held={held.data ?? []}
      />
    </div>
  );
}
