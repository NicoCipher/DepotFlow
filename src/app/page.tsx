export default function Home() {
  return (
    <>
      <p className="text-sm font-medium text-emerald-800">YOUR SHOP, AT A GLANCE</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Home</h1>
      <p className="mt-3 text-base leading-7 text-stone-600">Sales, customers and stock. All in one place.</p>
      <section aria-label="Shop actions" className="mt-9 space-y-3">
        <button disabled className="flex min-h-32 w-full items-center justify-between rounded-3xl bg-emerald-900 p-6 text-left text-white">
          <span><span className="block text-2xl font-semibold">Record Sale</span><span className="mt-2 block text-sm text-emerald-100">Coming soon</span></span>
          <span aria-hidden="true" className="text-4xl font-light">+</span>
        </button>
        <div className="space-y-3 pt-3">
          {["Customers", "Stock", "Products"].map((label) => (
            <button key={label} disabled className="flex min-h-20 w-full items-center justify-between rounded-2xl border border-stone-200 bg-white px-5 text-left">
              <span className="text-lg font-medium">{label}</span>
              <span className="text-sm text-stone-500">Coming soon</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
