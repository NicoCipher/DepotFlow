import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";

export default async function Home() {
  await requireOwner();
  return (
    <>
      <h1>Home</h1>
      <section aria-label="Shop actions" className="mt-7">
        <button
          disabled
          className="mb-5 flex min-h-24 w-full items-center justify-between rounded-lg bg-emerald-900 px-5 text-left text-white"
        >
          <span className="text-xl font-semibold">Record Sale</span>
          <span className="text-sm">Coming soon</span>
        </button>
        <Link
          href="/customers"
          className="flex min-h-20 items-center justify-between border-b border-stone-300 text-xl font-semibold"
        >
          Customers <span aria-hidden="true">→</span>
        </Link>
        {["Stock", "Products"].map((label) => (
          <button
            key={label}
            disabled
            className="flex min-h-20 w-full items-center justify-between border-b border-stone-300 text-left"
          >
            <span className="text-lg">{label}</span>
            <span className="text-sm text-stone-500">Coming soon</span>
          </button>
        ))}
      </section>
    </>
  );
}
