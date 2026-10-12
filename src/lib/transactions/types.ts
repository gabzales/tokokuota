export type TransactionStatus = "PENDING" | "SUCCESS" | "FAILED";

export type ReserveOutcome =
  | "CREATED"
  | "EXISTING"
  | "USER_NOT_FOUND"
  | "USER_INACTIVE"
  | "MAINTENANCE"
  | "INVALID_DESTINATION"
  | "PRODUCT_UNAVAILABLE"
  | "PRICE_CHANGED"
  | "INSUFFICIENT_BALANCE";

export type FinalizeOutcome = "APPLIED" | "ALREADY_APPLIED" | "CONFLICT" | "NOT_FOUND";
export type TopupOutcome = "APPLIED" | "ALREADY_APPLIED" | "USER_NOT_FOUND";
