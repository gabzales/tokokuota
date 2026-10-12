export class ProviderNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`KhfyPay wire format incomplete (TODO in wire.ts): ${missing.join(", ")}`);
    this.name = "ProviderNotConfiguredError";
  }
}
