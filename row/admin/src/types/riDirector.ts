export interface RiCreditBalance {
  emailTotal: number;
  emailUsed: number;
  emailBalance: number;
  whatsappTotal: number;
  whatsappUsed: number;
  whatsappBalance: number;
}

export interface RiDirectorContext {
  zoneCount: number;
  districtCount: number;
  clubCount: number;
  memberCount: number;
  credits: RiCreditBalance;
}

export interface RiCreditListItem {
  id: number;
  creditType: string;
  creditCount: number;
  usedCount: number;
  previousCount: number;
  fromDate: string;
  toDate: string;
  transactionId: string | null;
  paymentDate: string | null;
  proofDocumentPath: string | null;
  isActive: boolean;
  createdDate: string | null;
}

export interface RiCreditUsageHistoryItem {
  id: number;
  creditType: string;
  deductedCount: number;
  source: string;
  sourceId: number | null;
  sourceDetail: string | null;
  balanceBefore: number;
  balanceAfter: number;
  createdDate: string | null;
}
