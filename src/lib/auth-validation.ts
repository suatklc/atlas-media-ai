const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isRequired(value: string): boolean {
  return value.trim().length > 0;
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export function hasMinLength(value: string, min: number): boolean {
  return value.trim().length >= min;
}

export function valuesMatch(a: string, b: string): boolean {
  return a === b;
}
