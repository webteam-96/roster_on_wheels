export interface CashfreeKyc {
  id: number;
  vendorId: string;
  email: string;
  phone: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  name: string;
  pan: string;
  status: string;
  isActive: boolean;
  createdDate: string | null;
}

export interface CashfreeVendorDetail {
  id: number;
  vendorId: string;
  email: string;
  phone: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  name: string;
  pan: string;
  status: string;
  cashfreeJson: string | null;
}
