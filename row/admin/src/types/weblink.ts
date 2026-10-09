export interface Weblink {
  id: number;
  clubId: number;
  parentId: number | null;
  level: number;
  title: string;
  writeup: string | null;
  logoPath: string | null;
  bannerPath: string | null;
  linkType: string;
  linkUrl: string | null;
  pdfPath: string | null;
  youtubeUrl: string | null;
  buttonText: string | null;
  sortOrder: number;
  isActive: boolean;
  childCount: number;
}

export interface WeblinkTree {
  id: number;
  parentId: number | null;
  level: number;
  title: string;
  writeup: string | null;
  logoPath: string | null;
  bannerPath: string | null;
  linkType: string;
  linkUrl: string | null;
  pdfPath: string | null;
  youtubeUrl: string | null;
  buttonText: string | null;
  sortOrder: number;
  isActive: boolean;
  children: WeblinkTree[];
}
