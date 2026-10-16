/** Shared test fixtures (synthetic, modeled on the Ledesma sample). */
import type { BureauTradeline, CreditAccount, CreditFile } from "./creditFile";

export const tl = (o: Partial<BureauTradeline>): BureauTradeline => ({
  accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null,
  dateReported: null, dateOpened: null, balance: null, closedDate: null, accountRating: null,
  description: null, disputeStatus: null, creditorType: null, accountStatus: null,
  paymentStatus: null, remarks: null, paymentAmount: null, lastPayment: null, termLength: null,
  pastDue: null, accountType: null, paymentFrequency: null, creditLimit: null,
  late30: null, late60: null, late90: null, ...o,
});
export const acct = (o: Partial<CreditAccount> & { creditor: string }): CreditAccount => ({
  mask: null, section: "unknown", headerStatus: null, bureaus: {}, confident: true, ...o,
});

/** Modeled on the Ledesma sample: TU+EX only (Equifax frozen). */
export const FILE: CreditFile = {
  provider: "smartcredit",
  reportDate: "10/01/2026",
  scores: { TU: 511, EX: 555, EQ: null },
  accounts: [
    acct({
      creditor: "LEAFY FINANCIAL", section: "collection",
      headerStatus: "Original creditor: CREDITNINJA",
      bureaus: {
        TU: tl({ dateOpened: "08/30/2023", balance: 435, paymentStatus: "Collection", accountStatus: "Open" }),
        EX: tl({ dateOpened: "08/01/2023", balance: 435, paymentStatus: "Collection", accountStatus: "Open" }),
      },
    }),
    acct({
      creditor: "OPPLOANS/FINWISE", section: "installment",
      bureaus: {
        TU: tl({ dateOpened: "06/2021", balance: 979, paymentStatus: "Charge-off", dateLastActivity: "07/31/2025", late30: 0, late60: 0, late90: 0 }),
        EX: tl({ dateOpened: "06/2021", balance: 979, paymentStatus: "Charge-off", dateLastActivity: "10/01/2021", late30: 1, late60: 1, late90: 0 }),
      },
    }),
    acct({
      creditor: "JEFFERSON CAPITAL", section: "collection",
      bureaus: {
        TU: tl({ dateOpened: "08/2023", balance: 618, paymentStatus: "Collection", remarks: "Disputed, meets FCRA requirements", disputeStatus: "Account not disputed" }),
        EX: tl({ dateOpened: "08/2023", balance: 618, paymentStatus: "Collection", remarks: "Customer disputed", disputeStatus: "Account not disputed" }),
      },
    }),
    acct({
      creditor: "EAGLE COMMUNITY CU", section: "other",
      bureaus: {
        TU: tl({ dateOpened: "09/2013", balance: 1219, paymentStatus: "Charge-off" }),
        EX: tl({ dateOpened: "09/2013", balance: 1219, paymentStatus: "Charge-off" }),
      },
    }),
    acct({
      creditor: "CITICARDS CBNA", section: "revolving",
      bureaus: {
        TU: tl({ dateOpened: "11/2005", balance: 0, creditLimit: 11600, accountStatus: "Open", paymentStatus: "Current", remarks: "Authorized user" }),
        EX: tl({ dateOpened: "11/2005", balance: 0, creditLimit: 11600, accountStatus: "Open", paymentStatus: "Current", remarks: "Authorized user" }),
      },
    }),
    acct({
      creditor: "CAPITAL ONE", section: "revolving",
      bureaus: {
        TU: tl({ dateOpened: "12/2025", balance: 391, creditLimit: 300, accountStatus: "Open", paymentStatus: "Current" }),
        EX: tl({ dateOpened: "12/2025", balance: 391, creditLimit: 300, accountStatus: "Open", paymentStatus: "Current" }),
      },
    }),
  ],
  inquiries: [
    { date: "10/15/2024", creditor: "AUTO LENDER", bureau: "EX", matchedAccount: false },
    { date: "12/07/2025", creditor: "CAPITAL ONE", bureau: "TU", matchedAccount: null },
    { date: "03/01/2026", creditor: "UNKNOWN LENDER", bureau: "EX", matchedAccount: false },
  ],
  publicRecordsReported: false,
  imagePages: 0,
  totalPages: 5,
  confidence: 1,
  warnings: [],
};

