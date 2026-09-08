/** Browser-only resume extraction. The source file never leaves the device. */

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_RESUME_CHARS = 12_000

function normalizedText(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('We could not find readable text in that resume.')
  return text.slice(0, MAX_RESUME_CHARS)
}

/** Extract a bounded text representation for the optional interview context. */
export async function extractResumeText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Please choose a resume smaller than 5 MB.')
  }

  if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
    return normalizedText(await file.text())
  }

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // DeepSpace serves unknown .mjs assets as application/octet-stream. Browser
    // module workers reject that MIME type, so make a JavaScript Blob URL from
    // Vite's raw import instead of asking the browser to import the asset URL.
    const workerSource = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?raw')).default
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
      new Blob([workerSource], { type: 'text/javascript' }),
    )

    const document = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    }).promise
    const pages: string[] = []
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      )
    }
    return normalizedText(pages.join('\n'))
  }

  throw new Error('Please upload a PDF or plain-text (.txt) resume.')
}
