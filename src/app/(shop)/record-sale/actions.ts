"use server";

import { ownerSession, requireOwner } from "@/lib/auth/owner";
import {
  saleNetworkMessage,
  saleSessionExpiredMessage,
} from "@/domain/sale-errors";
import {
  inactiveSaleCustomerMessage,
  type SaleCatalog,
  type SaleCustomer,
  type SaleProduct,
  type SaleDraft,
} from "@/domain/sale-builder";
import {
  actualSaleEmpties,
  matchSaleEmpties,
} from "@/domain/sale-empties";

type OwnerClient = Awaited<ReturnType<typeof requireOwner>>;

async function loadCatalog(supabase: OwnerClient): Promise<SaleCatalog> {
  async function products() {
    const rows: SaleProduct[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id,name,size,image_url,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,bottles_returnable,bottle_type,crate_type_id,crate_type:crate_types(name,is_legacy,pocket_count,empty_family),stock(total_bottles)",
        )
        .order("name")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not load drinks and stock.");
      rows.push(
        ...data.map(({ stock, ...product }) => ({
          ...product,
          available: stock?.total_bottles ?? null,
        })),
      );
      if (data.length < 1000) return rows;
    }
  }

  async function customers() {
    const rows: SaleCustomer[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,phone,empties_deposit_required")
        .is("archived_at", null)
        .order("name")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not load customers.");
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }

  const [
    productRows,
    customerRows,
    crateTypes,
    swapRules,
    bottleDeposit,
    crateDeposits,
  ] = await Promise.all([
    products(),
    customers(),
    supabase
      .from("crate_types")
      .select("id,name,is_legacy,pocket_count")
      .eq("is_legacy", false)
      .order("name")
      .order("id"),
    supabase
      .from("crate_swap_rules")
      .select("owed_crate_type_id,returned_crate_type_id")
      .order("owed_crate_type_id")
      .order("returned_crate_type_id"),
    supabase
      .from("bottle_deposit_price")
      .select("amount")
      .eq("id", 1)
      .maybeSingle(),
    supabase
      .from("crate_deposit_prices")
      .select("pocket_count,complete_crate_amount,crate_only_amount")
      .order("pocket_count"),
  ]);
  if (
    crateTypes.error ||
    swapRules.error ||
    bottleDeposit.error ||
    crateDeposits.error
  )
    throw new Error("Could not load empties rules.");

  return {
    products: productRows,
    customers: customerRows,
    crateTypes: crateTypes.data,
    swapRules: swapRules.data,
    bottleDepositPrice: bottleDeposit.data?.amount ?? null,
    crateDepositPrices: crateDeposits.data,
  };
}

export async function loadSaleCatalog(): Promise<SaleCatalog> {
  return loadCatalog(await requireOwner());
}

export async function refreshSaleCatalog() {
  const session = await ownerSession();
  if (session.status === "signed_out" || !session.allowed || !session.user)
    return {
      error: saleSessionExpiredMessage,
      code: "session_expired" as const,
    };
  if (session.status === "temporary_error")
    return {
      error: saleNetworkMessage,
      code: "temporary_problem" as const,
    };

  try {
    return { catalog: await loadCatalog(session.supabase) };
  } catch {
    return {
      error: saleNetworkMessage,
      code: "temporary_problem" as const,
    };
  }
}

export async function saveSale(requestId: string, draft: SaleDraft) {
  const session = await ownerSession();
  if (session.status === "signed_out" || !session.allowed || !session.user)
    return {
      error: saleSessionExpiredMessage,
      code: "session_expired" as const,
    };
  if (session.status === "temporary_error")
    return {
      error: saleNetworkMessage,
      code: "temporary_problem" as const,
    };
  const supabase = session.supabase;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestId,
    ) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.businessDate) ||
    !/^\d+$/.test(draft.paid) ||
    !Number.isSafeInteger(Number(draft.paid))
  )
    return { error: "Check the sale date and amount paid." };

  try {
    const fresh = await loadCatalog(supabase);
    const customer = fresh.customers.find(
      (item) => item.id === draft.customerId,
    );
    if (!customer)
      return {
        error: inactiveSaleCustomerMessage,
        code: "customer_unavailable" as const,
      };

    const empties = matchSaleEmpties(draft, fresh);
    if (customer.empties_deposit_required && empties.hasShortage)
      throw new Error(
        "This customer requires a deposit for missing empties. Deposit handling for shortages is not enabled yet.",
      );

    const actual = actualSaleEmpties(draft, fresh);
    const resolutions = new Map(
      empties.lines.map((line) => [line.productId, line]),
    );

    const lines = draft.lines.map((line) => {
      if (!line.reviewExpected)
        throw new Error("Review current prices and stock before saving.");
      const resolved = resolutions.get(line.productId);
      if (!resolved) throw new Error("Check the returned empties.");
      return {
        productId: line.productId,
        quantity: line.quantity,
        cratesTaken: resolved.cratesOut,
        returnedCrates: resolved.cratesSettled,
        returnedBottles: resolved.bottlesSettled,
        expected: line.reviewExpected,
      };
    });

    const { data, error } = await supabase.rpc("save_sale_v2", {
      p_request_id: requestId,
      p_customer_id: draft.customerId,
      p_business_date: draft.businessDate,
      p_paid: Number(draft.paid),
      p_lines: lines,
      p_returned_crates: actual.crates,
      p_returned_bottles: actual.bottles,
    });

    if (error) {
      if (
        error.code === "22023" &&
        /customer is archived|customer not found/i.test(error.message)
      )
        return {
          error: inactiveSaleCustomerMessage,
          code: "customer_unavailable" as const,
        };
      return {
        error:
          error.code === "22023"
            ? error.message
            : "Could not save sale. Review and try again.",
      };
    }

    return {
      result: data as {
        id: string;
        total: number;
        paid: number;
        owing: number;
        customer: string;
      },
    };
  } catch (cause) {
    return {
      error:
        cause instanceof Error
          ? cause.message
          : "Could not save sale. Review and try again.",
    };
  }
}
