import { formatNaira } from "./products.ts";
import type { SaleProduct } from "./sale-builder.ts";

export type SalePriceMode = "retail" | "wholesale";

/**
 * Product cards advertise the price for the selected way of buying.
 * This is display-only: pricing and stock validation remain authoritative in
 * priceQuantity and the save RPC.
 */
export function saleCardPrice(product: SaleProduct, mode: SalePriceMode): {
  primary: string;
  secondary: string;
  available: boolean;
} {
  if (mode === "retail") {
    return product.bottle_price === null
      ? {
          primary: "Retail bottle price not set",
          secondary: "Choose Wholesale or set a retail bottle price.",
          available: false,
        }
      : {
          primary: `${formatNaira(product.bottle_price)} / bottle`,
          secondary: "Retail: every bottle is charged at this price.",
          available: true,
        };
  }

  return product.full_crate_price === null
    ? {
        primary: "Wholesale crate price not set",
        secondary: product.bottle_price === null
          ? "No crate or bottle price set."
          : `Extra loose bottles: ${formatNaira(product.bottle_price)} each.`,
        available: false,
      }
    : {
        primary: `${formatNaira(product.full_crate_price)} / crate`,
        secondary: product.bottle_price === null
          ? "Wholesale: crates and configured crate portions."
          : `Extra loose bottles: ${formatNaira(product.bottle_price)} each.`,
        available: true,
      };
}
