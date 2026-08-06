import { clsx, type ClassValue } from 'clsx';

/** className concatenation utility powered by clsx */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
