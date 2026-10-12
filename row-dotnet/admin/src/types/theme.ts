export interface Theme {
  id: number;
  themeName: string;
  themeImagePath?: string;
  description?: string | null;
}

export interface CreateThemeRequest {
  themeName: string;
  themeImagePath?: string;
  description?: string | null;
}

export interface UpdateThemeRequest {
  themeName: string;
  themeImagePath?: string;
  description?: string | null;
}

export interface ClubTheme {
  id: number;
  clubId: number;
  yearId: number;
  yearLabel: string;
  themeId: number;
  themeName: string;
  themeImagePath?: string;
}
