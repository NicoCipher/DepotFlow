export const saleNetworkMessage =
  "Couldn’t connect. Your sale is still here. Try again.";

export const saleSaveCheckingMessage =
  "Save is taking longer than expected. Checking whether it already saved…";

export const saleSaveRetryMessage =
  "Couldn’t confirm the save. Your sale is still here. Tap Save Sale again. It is safe to retry.";

export class SaleSaveTimeoutError extends Error {
  constructor() {
    super("sale_save_timeout");
    this.name = "SaleSaveTimeoutError";
  }
}

export function withSaleSaveTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 12000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SaleSaveTimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
