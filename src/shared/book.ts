export const FORMATS = ['epub', 'pdf', 'txt', 'fbz', 'fb2', 'fb2.zip', 'azw', 'azw3', 'mobi', 'cbz'] as const
export type Format = typeof FORMATS[number]

export function identifyFormat(name: string): Format | undefined {
  return FORMATS.find(format => name.toLowerCase().endsWith('.' + format))
}

export interface Book {
  id: string
  name: string
  format: Format
  bytes: number
  added: number
}
