import "server-only";
import { providerEnv } from "@/lib/env/server";
import { KhfyPayAdapter } from "./khfypay/adapter";
import type { ProviderAdapter } from "./types";

/** Provider registry: add a second provider here without touching checkout code. */
export function getProvider(id: "khfypay" = "khfypay"): ProviderAdapter {
  const env = providerEnv();
  switch (id) {
    case "khfypay":
      return new KhfyPayAdapter({
        baseUrl: env.KHFYPAY_BASE_URL,
        apiKey: env.KHFYPAY_API_KEY,
        timeoutMs: env.KHFYPAY_TIMEOUT_MS,
      });
  }
}
