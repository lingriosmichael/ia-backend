export interface UserPersistenceRecord {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserCreateInput {
  email: string;
  fullName: string;
  passwordHash: string;
}
