import { HomeDashboard, type HomeSnapshot } from "@/components/home-dashboard";
import { crateFitsProduct, crateNeedsSetup } from "@/domain/crate-types";
import { requireOwnerSession } from "@/lib/auth/owner";

function todayLagos(at: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export default async function Home() {
  const { user, supabase } = await requireOwnerSession();
  const now = new Date();
  const day = todayLagos(now);
  const dayLabel = new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long",
  }).format(now);

  async function loadCrateCustomers() {
    const ids: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("crate_obligations")
        .select("customer_id")
        .gt("quantity", 0)
        .order("customer_id")
        .range(offset, offset + 999);
      if (result.error) throw new Error("Could not load customer empties.");
      ids.push(...result.data.map((row) => row.customer_id));
      if (result.data.length < 1000) return ids;
    }
  }

  async function loadBottleCustomers() {
    const ids: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("bottle_obligations")
        .select("customer_id")
        .gt("quantity", 0)
        .order("customer_id")
        .range(offset, offset + 999);
      if (result.error) throw new Error("Could not load customer empties.");
      ids.push(...result.data.map((row) => row.customer_id));
      if (result.data.length < 1000) return ids;
    }
  }

  async function loadHeldEmpties() {
    const rows: { customer_id: string; kind: string; quantity: number }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("sale_empty_decisions")
        .select("customer_id,kind,quantity")
        .eq("decision", "hold")
        .is("released_at", null)
        .order("customer_id")
        .order("id")
        .range(offset, offset + 999);
      if (result.error) throw new Error("Could not load held empties.");
      rows.push(...result.data);
      if (result.data.length < 1000) return rows;
    }
  }

  async function loadProductsForSetup() {
    const rows: {
      id: string;
      bottles_per_crate: number;
      crate_types: {
        is_legacy: boolean;
        pocket_count: number | null;
        empty_family: string | null;
      } | null;
    }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("products")
        .select(
          "id,bottles_per_crate,crate_types(is_legacy,pocket_count,empty_family)",
        )
        .order("id")
        .range(offset, offset + 999);
      if (result.error) throw new Error("Could not load drink setup.");
      rows.push(...result.data);
      if (result.data.length < 1000) return rows;
    }
  }

  const [
    snapshotResult,
    crateCustomerIds,
    bottleCustomerIds,
    heldRows,
    productsForSetup,
  ] = await Promise.all([
    supabase.rpc("manager_snapshot", { p_day: day }),
    loadCrateCustomers(),
    loadBottleCustomers(),
    loadHeldEmpties(),
    loadProductsForSetup(),
  ]);

  if (snapshotResult.error) {
    throw new Error("Could not load today’s shop snapshot.");
  }

  const snapshot = snapshotResult.data as HomeSnapshot;

  const emptiesCustomers = new Set([...crateCustomerIds, ...bottleCustomerIds]).size;
  const heldCrates = heldRows
    .filter((row) => row.kind === "crate")
    .reduce((sum, row) => sum + row.quantity, 0);
  const heldBottles = heldRows
    .filter((row) => row.kind === "bottle")
    .reduce((sum, row) => sum + row.quantity, 0);
  const drinksNeedingSetup = productsForSetup.filter((product) => {
    const crate = product.crate_types;
    return (
      !crate ||
      crateNeedsSetup({
        ...crate,
        id: null,
        crate_type_id: null,
        name: null,
        variant: null,
      }) ||
      !crateFitsProduct(crate.pocket_count, product.bottles_per_crate)
    );
  }).length;
  return (
    <HomeDashboard
      ownerId={user.id}
      dayLabel={dayLabel}
      snapshot={snapshot}
      emptiesCustomers={emptiesCustomers}
      heldCrates={heldCrates}
      heldBottles={heldBottles}
      drinksNeedingSetup={drinksNeedingSetup}
    />
  );
}
