// Financial formulas, implemented once (C17). The live form previews (invoice totals, installment splits, payment
// amounts) call these; nobody re-derives a formula inline. Persisted figures always come from the BE.
export * from "./installments";
export * from "./invoice-totals";
export * from "./payments";
