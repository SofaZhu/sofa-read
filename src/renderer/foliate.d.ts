declare module '@ray-d-song/foliate-js/view.js' {
  interface FoliateSection {
    id: string | number
    size?: number
    linear?: string
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
    setStyles?(styles: string): void
  }

  export class View extends HTMLElement {
    book: FoliateBook
    renderer?: FoliateRenderer
    isFixedLayout: boolean
    open(book: FoliateBook): Promise<void>
    init(options: { lastLocation?: string | number; showTextStart: boolean }): Promise<void>
    goTo(target: string | number): Promise<void>
    prev(): Promise<void>
    next(): Promise<void>
    close(): void
  }

  export function makeBook(file: File): Promise<FoliateBook>
}
