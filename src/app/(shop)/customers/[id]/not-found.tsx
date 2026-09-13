import Link from "next/link";
export default function NotFound() {
  return (
    <>
      <h1>Customer not found</h1>
      <Link className="quiet-link mt-5" href="/customers">
        Back to Customers
      </Link>
    </>
  );
}
