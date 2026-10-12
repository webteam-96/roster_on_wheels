export interface TrfFund {
  id: number;
  fundName: string;
  sortOrder: number;
  isActive: boolean;
}

export interface TrfContribution {
  id: number;
  clubId: number;
  yearId: number;
  trfDate: string;
  donorName: string;
  amountUSD: number;
  fundId: number;
  fundType: string;
  otherFundName: string | null;
}
