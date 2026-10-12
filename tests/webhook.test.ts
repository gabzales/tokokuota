import { describe, expect, it, vi } from "vitest";
import {
  extractMessage, findOurReffId, mentionsDestination, parseWebhookMessage, STATUS_EXTRACTORS, webhookDedupeKey, type WebhookInput,
} from "@/lib/providers/khfypay/webhook";
import { processWebhook } from "@/lib/transactions/webhook-processor";
import { fakeRpc, fakeStore, tx } from "./helpers";

const REFF = "TKAAAAAAAAAAAAAAAAAA";
const get = (qs: string): WebhookInput => ({ method: "GET", query: new URLSearchParams(qs), contentType: null, bodyText: "" });
const post = (ct: string, body: string): WebhookInput => ({ method: "POST", query: new URLSearchParams(), contentType: ct, bodyText: body });
const SUCCESS = () => "SUCCESS" as const;

describe("extractMessage — GET is the primary format", () => {
  it("GET /webhook?message=… is read from the query", () => {
    expect(extractMessage(get("message=hello%20world"))).toBe("hello world");
  });
  it("POST form / JSON accepted only as compatibility", () => {
    expect(extractMessage(post("application/x-www-form-urlencoded", "message=yo"))).toBe("yo");
    expect(extractMessage(post("application/json", '{"message":"hey"}'))).toBe("hey");
  });
  it("a GET never reads a body; garbage returns null instead of guessing", () => {
    expect(extractMessage({ ...get(""), bodyText: "message=x" })).toBeNull();
    expect(extractMessage(post("application/json", "{bad"))).toBeNull();
    expect(extractMessage(post("application/json", '{"message":{"x":1}}'))).toBeNull();
  });
});

describe("parseWebhookMessage — correlation by OUR reff_id only", () => {
  it("finds exactly one of our reff_ids (case-insensitive)", () => {
    expect(findOurReffId(`bla ${REFF} bla`)).toBe(REFF);
    expect(findOurReffId(`x ${REFF.toLowerCase()} y`)).toBe(REFF);
  });
  it("zero or several different ids => no correlation", () => {
    expect(findOurReffId("nothing here")).toBeNull();
    expect(findOurReffId(`${REFF} and TKBBBBBBBBBBBBBBBBBB`)).toBeNull();
    expect(findOurReffId("xTKAAAAAAAAAAAAAAAAAA")).toBeNull();
  });
  it("the same id repeated is fine", () => {
    expect(findOurReffId(`${REFF} ... ${REFF}`)).toBe(REFF);
  });
  it("there are NO status extractors yet, so status is always UNKNOWN (no wording guesses)", () => {
    expect(STATUS_EXTRACTORS).toHaveLength(0);
    for (const m of [`${REFF} SUKSES`, `${REFF} GAGAL`, `${REFF} result=0`, `${REFF} result=1`, `${REFF} success`]) {
      expect(parseWebhookMessage(m)).toEqual({ reffId: REFF, status: "UNKNOWN", message: m });
    }
  });
  it("with an injected extractor it maps; conflicting extractors refuse to decide", () => {
    expect(parseWebhookMessage(REFF, [SUCCESS])?.status).toBe("SUCCESS");
    expect(parseWebhookMessage(REFF, [SUCCESS, () => "FAILED"])?.status).toBe("UNKNOWN");
    expect(parseWebhookMessage(REFF, [() => null])?.status).toBe("UNKNOWN");
  });
  it("mentionsDestination compares digits", () => {
    expect(mentionsDestination("ke 0812-3456-7890 ok", "081234567890")).toBe(true);
    expect(mentionsDestination("ke 0899", "081234567890")).toBe(false);
  });
});

describe("webhookDedupeKey", () => {
  it("stable, order-insensitive on query, sensitive to content", () => {
    const a = webhookDedupeKey(get("a=1&b=2"));
    expect(webhookDedupeKey(get("b=2&a=1"))).toBe(a);
    expect(webhookDedupeKey(get("a=1&b=3"))).not.toBe(a);
  });
});

describe("processWebhook — validation chain before any state change", () => {
  const msg = get(`message=${REFF}`);
  const parseTo = (status: "SUCCESS" | "FAILED" | "UNKNOWN") => () => ({ reffId: REFF, status, message: "m" });
  const run = (o: { rpc?: ReturnType<typeof fakeRpc>; store?: ReturnType<typeof fakeStore>; parse?: () => ReturnType<ReturnType<typeof parseTo>> | null; verify?: never; requireDestinationInMessage?: boolean; input?: WebhookInput } = {}) => {
    const rpc = o.rpc ?? fakeRpc();
    const store = o.store ?? fakeStore(tx({ providerAttempts: 1 }));
    return { rpc, store, promise: processWebhook({ provider: "khfypay", rpc, store, parse: o.parse ?? parseTo("SUCCESS"), verify: o.verify, requireDestinationInMessage: o.requireDestinationInMessage }, o.input ?? msg) };
  };
  const untouched = (rpc: ReturnType<typeof fakeRpc>) => {
    expect(rpc.finalizeSuccess).not.toHaveBeenCalled();
    expect(rpc.finalizeFailed).not.toHaveBeenCalled();
  };

  it("with the real (extractor-less) parser a callback is logged but finalizes NOTHING", async () => {
    const rpc = fakeRpc();
    const out = await processWebhook({ provider: "khfypay", rpc, store: fakeStore(tx({ providerAttempts: 1 })) }, get(`message=${REFF}+SUKSES`));
    expect(out).toBe("NO_STATUS");
    expect(rpc.logWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({ reffId: REFF }));
    untouched(rpc);
    expect(rpc.setWebhookOutcome).toHaveBeenCalledWith({ eventId: 7, outcome: "NO_STATUS" });
  });

  it("no message / no reff_id of ours => UNPARSED, logged only", async () => {
    const rpc = fakeRpc();
    expect(await processWebhook({ provider: "khfypay", rpc, store: fakeStore() }, get("message=hello"))).toBe("UNPARSED");
    expect(await processWebhook({ provider: "khfypay", rpc, store: fakeStore() }, get(""))).toBe("UNPARSED");
    untouched(rpc);
  });

  it("unknown local transaction => NOT_FOUND", async () => {
    const { rpc, promise } = run({ store: fakeStore(null) });
    expect(await promise).toBe("NOT_FOUND");
    untouched(rpc);
  });

  it("a callback for a transaction we never sent to the provider is rejected (blocks forged callbacks)", async () => {
    const { rpc, promise } = run({ store: fakeStore(tx({ providerAttempts: 0 })) });
    expect(await promise).toBe("REJECTED_NOT_SUBMITTED");
    untouched(rpc);
  });

  it("optional destination corroboration", async () => {
    const miss = run({ requireDestinationInMessage: true, input: get(`message=${REFF}+to+0899`) });
    expect(await miss.promise).toBe("REJECTED_MISMATCH");
    untouched(miss.rpc);
    const hit = run({ requireDestinationInMessage: true, input: get(`message=${REFF}+to+081234567890`) });
    expect(await hit.promise).toBe("APPLIED");
  });

  it("SUCCESS => finalizeSuccess only; FAILED => finalizeFailed only (the only refund path)", async () => {
    const s = run({ parse: parseTo("SUCCESS") });
    expect(await s.promise).toBe("APPLIED");
    expect(s.rpc.finalizeSuccess).toHaveBeenCalledWith(expect.objectContaining({ reffId: REFF }));
    expect(s.rpc.finalizeFailed).not.toHaveBeenCalled();
    const f = run({ parse: parseTo("FAILED") });
    expect(await f.promise).toBe("APPLIED");
    expect(f.rpc.finalizeFailed).toHaveBeenCalledOnce();
    expect(f.rpc.finalizeSuccess).not.toHaveBeenCalled();
  });

  it("duplicate / conflicting callbacks surface the database state-machine answer", async () => {
    for (const outcome of ["ALREADY_APPLIED", "CONFLICT"] as const) {
      const rpc = fakeRpc({ finalizeFailed: vi.fn(async () => ({ outcome, txId: "t", status: "FAILED" })) });
      const store = fakeStore(tx({ status: "FAILED", providerAttempts: 1 }));
      expect(await processWebhook({ provider: "khfypay", rpc, store, parse: parseTo("FAILED") }, msg)).toBe(outcome);
    }
  });

  it("independent verification gates finalization when provided", async () => {
    const rpc = fakeRpc();
    const store = fakeStore(tx({ providerAttempts: 1 }));
    const base = { provider: "khfypay", rpc, store, parse: parseTo("FAILED") };
    expect(await processWebhook({ ...base, verify: async () => "INCONCLUSIVE" }, msg)).toBe("NOT_VERIFIED");
    expect(await processWebhook({ ...base, verify: async () => "CONTRADICTED" }, msg)).toBe("NOT_VERIFIED");
    expect(store.flagReview).toHaveBeenCalledOnce();
    untouched(rpc);
    expect(await processWebhook({ ...base, verify: async () => "CONFIRMED" }, msg)).toBe("APPLIED");
    expect(rpc.finalizeFailed).toHaveBeenCalledOnce();
  });
});
