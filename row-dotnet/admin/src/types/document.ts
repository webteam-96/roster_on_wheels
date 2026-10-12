export interface DocumentListItem {
  id: number;
  clubId: number;
  yearId: number;
  title: string;
  accessType: string; // "view_only" or "downloadable"
  filePath: string;
  originalFileName: string | null;
  publishDateTime: string;
  expiryDateTime: string;
  status: string;
}

export interface DocumentDetail {
  id: number;
  clubId: number;
  yearId: number;
  title: string;
  accessType: string;
  filePath: string;
  originalFileName: string | null;
  publishDateTime: string;
  expiryDateTime: string;
  status: string;
}

export interface CreateDocumentRequest {
  title: string;
  accessType: string;
  filePath: string;
  originalFileName: string | null;
  publishDateTime: string;
  expiryDateTime: string;
}

export interface UpdateDocumentRequest {
  title: string;
  accessType: string;
  filePath: string;
  originalFileName: string | null;
  publishDateTime: string;
  expiryDateTime: string;
}
