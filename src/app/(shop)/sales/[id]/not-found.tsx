import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>Sale not found</h1>
      <p className="mt-3 text-stone-600">
        This sale is not available in the shop records.
      </p>
      <Link className="quiet-link mt-5 self-start" href="/sales">
        Back to Sales
      </Link>
    </>
  );
}
