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
  const [crates, bottles, types, held, rules] = await Promise.all([
    supabase.from("crate_obligations").select("crate_type_id,crate_type,quantity")
      .eq("customer_id", id).gt("quantity", 0).order("crate_type_id"),
    supabase.from("bottle_obligations").select("bottle_type,quantity")
      .eq("customer_id", id).gt("quantity", 0).order("bottle_type"),
    supabase.from("crate_types").select("id,name,pocket_count,is_legacy"),
    supabase.from("sale_empty_decisions").select("id,kind,returned_name,quantity")
      .eq("customer_id", id).eq("decision", "hold").is("released_at", null).order("id"),
    supabase.from("crate_swap_rules").select("owed_crate_type_id,returned_crate_type_id"),
  ]);
  if ([crates, bottles, types, held, rules].some(result => result.error))
    throw new Error("Could not load this customer's empties.");
  const identities = new Map((types.data ?? []).map(type => [type.id, type]));
  const owedIds = new Set((crates.data ?? []).map(row => row.crate_type_id));
  const swaps = (rules.data ?? []).flatMap(rule => {
    const owed = identities.get(rule.owed_crate_type_id);
    const actual = identities.get(rule.returned_crate_type_id);
    if (!owedIds.has(rule.owed_crate_type_id) || !owed || !actual ||
      owed.is_legacy || actual.is_legacy || owed.pocket_count === null ||
      owed.pocket_count !== actual.pocket_count) return [];
    return [{
      owedId: owed.id,
      returnedId: actual.id,
      returnedName: actual.name,
    }];
  }).sort((a, b) => a.returnedName.localeCompare(b.returnedName));
  return (
    <div className="space-y-5">
      <Link href={`/customers/${id}`} className="quiet-link">← {customer.name}</Link>
      <header>
        <h1>Record empty crates and empty bottles returned</h1>
        <p className="mt-2 text-stone-600">
          {customer.name} · Count what physically came back today. Approved crate replacements
          reduce the original crate debt, but go into stock under the crate actually received.
          Money owed is not changed here.
        </p>
      </header>
      <EmptyReturnForm
        request={randomUUID()}
        customer={id}
        crates={(crates.data ?? []).map(row => ({
          id: row.crate_type_id,
          name: identities.get(row.crate_type_id)?.name ?? row.crate_type ?? "Empty crate",
          owed: row.quantity,
        }))}
        bottles={(bottles.data ?? []).map(row => ({
          id: row.bottle_type, name: row.bottle_type, owed: row.quantity,
        }))}
        swaps={swaps}
        held={held.data ?? []}
      />
    </div>
  );
}
