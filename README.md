# DepotFlow

DepotFlow is a mobile-first operations app for drinks wholesalers and distributors.

It is designed around the real day-to-day workflow of a small drinks shop: customers,
stock, sales, payments, and returnable crates and bottles.

## Why DepotFlow

Many small distributors still manage stock, customer debt, empty crates, and bottle
returns manually.

DepotFlow aims to make those daily tasks faster without forcing the shop owner to
learn accounting or ERP terminology.

The interface prioritizes:

- fast customer lookup
- simple crate and bottle quantity entry
- clear separation of money owed, crates owed, bottles owed, and deposits
- stock controls that prevent overselling
- mobile-first operation

## Current Status

Early development.

Currently implemented:

- Next.js mobile-first foundation
- Supabase authentication
- single-owner access control
- Row Level Security
- customer management
- customer search
- quantity and stock-domain utilities

Sales, stock operations, empties, and payment workflows are being developed
incrementally.

## Tech Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Supabase
- PostgreSQL
- Vercel

## Engineering Approach

DepotFlow is intentionally built as a focused operational tool rather than a
general-purpose ERP.

Business-critical operations are enforced at both the application and database
layers, including owner authorization, protected writes, and stock constraints.

## Development

```bash
npm install
npm run dev

