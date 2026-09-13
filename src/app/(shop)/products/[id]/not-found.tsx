import Link from "next/link";
export default function NotFound() {
  return (
    <>
      <h1>Product not found</h1>
      <Link className="quiet-link mt-5" href="/products">
        Back to Products
      </Link>
    </>
  );
}
