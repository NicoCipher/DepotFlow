import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterDepotForm } from "@/components/register-depot-form";
import { createClient } from "@/lib/supabase/server";

/** A separate personal-account onboarding route, not an implicit extra
 * Walnik shop account. Gate-off means no form/action capability.
 */
export default async function RegisterNewDepotPage() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (!user || userError) redirect("/sign-in?next=%2Fbusinesses");

  const { data: eligible, error } = await supabase.rpc("can_register_business");

  return (
    <section className="mx-auto w-full max-w-xl space-y-5 pb-8">
      <Link href="/businesses" className="quiet-link">← Your depots</Link>
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          DepotFlow · New business
        </p>
        <h1 className="text-2xl font-extrabold text-stone-950">
          Register your depot
        </h1>
        <p className="text-sm leading-6 text-stone-600">
          Start with the business identity. You can choose drinks, confirm
          prices, count stock and record existing customer balances afterward.
          Every depot keeps its own records.
        </p>
      </header>
      {error || eligible !== true ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <h2 className="font-bold">Registration is not available</h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Registration may not be enabled, your email may need verification,
            or this account may have reached its depot limit. No business was
            created from this page.
          </p>
        </div>
      ) : (
        <RegisterDepotForm requestId={randomUUID()} />
      )}
    </section>
  );
}
