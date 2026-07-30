export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export interface MySqlUserAccountState {
  isActive: boolean;
  isBanned: boolean;
  deletedAt: Date | null;
}

export function getUserStatus(state: MySqlUserAccountState): UserStatus {
  if (state.isBanned) {
    return UserStatus.SUSPENDED;
  }

  if (!state.isActive || state.deletedAt !== null) {
    return UserStatus.INACTIVE;
  }

  return UserStatus.ACTIVE;
}
