export function is(value: any): boolean {
  return value !== null && value !== undefined;
}

export function truncate(s: string, maxLength: number): string {
  if (s.length <= maxLength) {
    return s;
  }
  return s.substring(0, maxLength) + "...";
}