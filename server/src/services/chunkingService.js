const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_OVERLAP = 100;

const preferredBreak = (text, maxLength) => {
  const minimumLength = Math.floor(maxLength * 0.5);
  const paragraphBreak = text.lastIndexOf('\n\n', maxLength);
  if (paragraphBreak >= minimumLength) return paragraphBreak;

  let sentenceBreak = -1;
  const sentenceBoundary = /[.!?]["')\]]?\s+/g;
  for (const match of text.slice(0, maxLength).matchAll(sentenceBoundary)) {
    const boundary = match.index + match[0].length;
    if (boundary >= minimumLength) sentenceBreak = boundary;
  }
  if (sentenceBreak >= minimumLength) return sentenceBreak;

  const wordBreak = text.lastIndexOf(' ', maxLength);
  if (wordBreak >= minimumLength) return wordBreak;
  return maxLength;
};

export const chunkText = (input, { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP } = {}) => {
  if (typeof input !== 'string' || !input.trim()) return [];
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new TypeError('chunkSize must be a positive integer');
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new TypeError('overlap must be a non-negative integer smaller than chunkSize');
  }

  let remaining = input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const chunks = [];

  while (remaining.length > chunkSize) {
    const end = preferredBreak(remaining, chunkSize);
    const chunk = remaining.slice(0, end).trim();
    if (chunk) chunks.push(chunk);

    let nextStart = Math.max(0, end - overlap);
    while (nextStart < end && /\S/.test(remaining[nextStart])) nextStart += 1;
    if (nextStart <= 0 || nextStart >= remaining.length) nextStart = end;
    remaining = remaining.slice(nextStart).trimStart();
  }

  if (remaining.trim()) chunks.push(remaining.trim());
  return chunks;
};
