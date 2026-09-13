"use client";
export default function ShopError({ reset }: { reset: () => void }) {
  return (
    <div role="alert">
      <h1>Could not load this page</h1>
      <p className="my-4">Please check your connection and try again.</p>
      <button className="primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
