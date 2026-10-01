import { requireOwner } from "@/lib/auth/owner";
import { saveBusiness } from "./actions";
export default async function BusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const db = await requireOwner();
  const { data, error } = await db
    .from("shop_profile")
    .select("name,address,phone,logo_url")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error("Could not load business details.");
  const query = await searchParams;
  return (
    <div className="space-y-5">
      <header>
        <h1>Business details</h1>
        <p className="mt-2 text-stone-600">
          Your shop name and contact details appear on new receipts.
        </p>
      </header>
      {query.saved && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4">
          Business details saved.
        </p>
      )}
      {query.error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4">
          {query.error === "logo"
            ? "Use a valid HTTPS link for your logo, or leave it blank."
            : "Check your business details and try again."}
        </p>
      )}
      <form action={saveBusiness} className="space-y-5">
        <label className="block font-semibold">
          Shop name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={data?.name ?? ""}
            autoComplete="organization"
            className="mt-2 w-full"
          />
        </label>
        <label className="block font-semibold">
          Address
          <textarea
            name="address"
            maxLength={500}
            defaultValue={data?.address ?? ""}
            autoComplete="street-address"
            className="mt-2 w-full rounded-lg border border-stone-300 p-3"
          />
        </label>
        <label className="block font-semibold">
          Phone number
          <input
            name="phone"
            type="tel"
            maxLength={40}
            defaultValue={data?.phone ?? ""}
            autoComplete="tel"
            className="mt-2 w-full"
          />
        </label>
        <details>
          <summary className="min-h-12 cursor-pointer py-3 font-semibold">
            Add a logo (optional)
          </summary>
          <label className="block">
            Logo image link
            <input
              name="logo_url"
              type="url"
              maxLength={1000}
              defaultValue={data?.logo_url ?? ""}
              placeholder="https://…"
              className="mt-2 w-full"
            />
          </label>
          <p className="mt-2 text-sm text-stone-600">
            Use an HTTPS link to your shop logo.
          </p>
        </details>
        <button className="primary w-full">Save business details</button>
      </form>
    </div>
  );
}
