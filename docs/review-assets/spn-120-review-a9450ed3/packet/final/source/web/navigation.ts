export interface NavigationGuard {
  allow(): boolean;
  dirty(value: boolean): void;
}
