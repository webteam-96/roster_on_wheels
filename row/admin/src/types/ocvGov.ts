export interface OcvCategory {
  id: number;
  categoryName: string;
  categoryCode: string;
  iconClass: string | null;
  sortOrder: number;
}

export interface OcvDocumentType {
  id: number;
  categoryId: number;
  typeName: string;
  allowMultiple: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface OcvDocumentListItem {
  id: number;
  typeId: number;
  typeName: string;
  customTypeName: string | null;
  fileName: string;
  originalFileName: string;
  filePath: string;
  fileSize: number;
  amount: number | null;
  paidOn: string | null;
  createdDate: string;
}

export interface OcvReportItem {
  categoryName: string;
  categoryCode: string;
  categoryId: number;
  typeId: number;
  typeName: string;
  isUploaded: boolean;
  documentId: number | null;
  filePath: string | null;
  originalFileName: string | null;
}
