declare module '@ray-d-song/foliate-js/view.js' {
  export interface FoliateTarget {
    index: number
    anchor?: number | ((doc: Document) => Range | Element | null | undefined)
  }

  interface FoliateSection {
    id: string | number
    size?: number
    linear?: string
    load(): string | Promise<string>
    unload?(): void
    createDocument?(): Document | Promise<Document>
  }

  interface FoliateChapter {
    label?: string
    href: string
    subitems?: FoliateChapter[]
  }

  interface FoliateBook {
    sections: FoliateSection[]
    toc?: FoliateChapter[]
    getCover?(): Blob | null | Promise<Blob | null>
    destroy?(): void
  }

  interface FoliateRenderer extends HTMLElement {
    getContents?(): { index?: number; doc: Document | null }[]
    setStyles?(styles: string): void
  }

  export class View extends HTMLElement {
    book: FoliateBook
    sofaCreateRenderer?: () => HTMLElement
    renderer?: FoliateRenderer
    isFixedLayout: boolean
    open(book: FoliateBook): Promise<void>
    init(options: { lastLocation?: string | number; showTextStart: boolean }): Promise<void>
    goTo(target: string | number): Promise<void>
    getCFI(index: number, range?: Range): string
    getTOCItemOf?(target: string): Promise<FoliateChapter | undefined>
    resolveNavigation(target: string | number | { fraction: number }): FoliateTarget | undefined
    goToFraction(fraction: number): Promise<void>
    prev(): Promise<void>
    next(): Promise<void>
    close(): void
  }

  export function makeBook(file: File): Promise<FoliateBook>
}
