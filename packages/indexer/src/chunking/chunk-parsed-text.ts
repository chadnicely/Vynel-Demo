// Recursive-character chunker with paragraph preference. Pure; no I/O.
// Per blueprint §5 + decisions D2.
//
// Splits text on '\n\n' first, then '\n', then '. ', then space, then
// arbitrary characters as fallback. Target chunk size 2000 chars
// (~500 tokens at 4 chars/token); overlap 200 chars (~50 tokens).
//
// Same recursive-character recipe LangChain's
// `RecursiveCharacterTextSplitter` uses.

const DEFAULT_TARGET_CHUNK_SIZE_CHARS = 2000
const DEFAULT_CHUNK_OVERLAP_CHARS = 200
const SEPARATORS = ['\n\n', '\n', '. ', ' ', '']

export type ChunkParsedTextInput = {
  parsedText: string
  targetChunkSizeChars?: number
  chunkOverlapChars?: number
}

export type Chunk = {
  chunkIndex: number
  startCharOffset: number
  endCharOffset: number
  chunkText: string
  chunkTokenEstimate: number
}

export function chunkParsedText(input: ChunkParsedTextInput): Chunk[] {
  const target = input.targetChunkSizeChars ?? DEFAULT_TARGET_CHUNK_SIZE_CHARS
  const overlap = input.chunkOverlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS

  if (input.parsedText.length === 0) return []
  if (input.parsedText.length <= target) {
    return [
      {
        chunkIndex: 0,
        startCharOffset: 0,
        endCharOffset: input.parsedText.length,
        chunkText: input.parsedText,
        chunkTokenEstimate: estimateTokens(input.parsedText),
      },
    ]
  }

  const rawChunks = recursiveSplit(input.parsedText, target, SEPARATORS)
  return mergeWithOverlap(rawChunks, input.parsedText, overlap)
}

function recursiveSplit(text: string, target: number, separators: string[]): string[] {
  if (text.length <= target) return [text]
  if (separators.length === 0) {
    // Final fallback: hard-split by target chars.
    const parts: string[] = []
    for (let i = 0; i < text.length; i += target) parts.push(text.slice(i, i + target))
    return parts
  }
  const [sep, ...rest] = separators
  const splits = sep === '' ? Array.from(text) : text.split(sep!)
  const merged: string[] = []
  let current = ''
  for (const part of splits) {
    const joiner = current.length > 0 && sep ? sep : ''
    const candidate = current + joiner + part
    if (candidate.length <= target) {
      current = candidate
    } else {
      if (current.length > 0) merged.push(current)
      if (part.length > target) {
        const subSplits = recursiveSplit(part, target, rest)
        if (subSplits.length > 1) {
          merged.push(...subSplits.slice(0, -1))
        }
        current = subSplits.at(-1) ?? ''
      } else {
        current = part
      }
    }
  }
  if (current.length > 0) merged.push(current)
  return merged
}

function mergeWithOverlap(rawChunks: string[], fullText: string, overlap: number): Chunk[] {
  const result: Chunk[] = []
  let cursor = 0
  for (let i = 0; i < rawChunks.length; i++) {
    const chunkText = rawChunks[i]!
    const startOffset = fullText.indexOf(chunkText, cursor)
    const endOffset = startOffset + chunkText.length
    let withOverlap = chunkText
    if (i > 0 && overlap > 0) {
      // Pull the overlap from the RAW previous chunk — NOT
      // result[i-1].chunkText, which already carries chunk i-2's
      // overlap prepended and would inflate the budget compoundingly.
      const prevRaw = rawChunks[i - 1]!
      const overlapStart = Math.max(0, prevRaw.length - overlap)
      withOverlap = `${prevRaw.slice(overlapStart)}\n${chunkText}`
    }
    result.push({
      chunkIndex: i,
      startCharOffset: startOffset,
      endCharOffset: endOffset,
      chunkText: withOverlap,
      chunkTokenEstimate: estimateTokens(withOverlap),
    })
    cursor = endOffset
  }
  return result
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
