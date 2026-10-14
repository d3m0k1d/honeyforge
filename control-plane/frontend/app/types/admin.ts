export interface Permission {
  id: string;
  label: string;
  group: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
}

export interface AdminService {
  id: string;
  label: string;
  description: string;
  icon: string;
  ready: boolean;
}
