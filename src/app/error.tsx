"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert">
      <h1>Could not connect</h1>
      <p className="my-4">Please try again.</p>
      <button className="primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
