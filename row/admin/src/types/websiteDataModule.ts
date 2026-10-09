export interface WebsiteDataModule {
  id: number;
  moduleName: string;
  moduleKey: string;
  iconClass: string;
  sortOrder: number;
}

export interface CreateWebsiteDataModuleRequest {
  moduleName: string;
  moduleKey: string;
  iconClass: string;
}

export interface UpdateWebsiteDataModuleRequest {
  moduleName: string;
  moduleKey: string;
  iconClass: string;
}
