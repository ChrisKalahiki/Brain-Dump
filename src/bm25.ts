// BM25 over documents already split into words (ADR 0013): scored on each call, nothing stored.

const K1 = 1.2;
const B = 0.75;

/** One score per document, in order; each distinct query term counts once. */
export function bm25(documents: string[][], query: string[]): number[] {
  const counts = documents.map(termCounts);
  const averageLength = documents.reduce((total, words) => total + words.length, 0) / documents.length;
  const terms = [...new Set(query)];
  const idf = new Map(
    terms.map((term) => {
      const holding = counts.filter((count) => count.has(term)).length;
      return [term, Math.log(1 + (documents.length - holding + 0.5) / (holding + 0.5))];
    }),
  );
  return documents.map((words, index) => {
    const lengthNorm = 1 - B + (B * words.length) / averageLength;
    return terms.reduce((score, term) => {
      const frequency = counts[index]?.get(term) ?? 0;
      return score + ((idf.get(term) ?? 0) * frequency * (K1 + 1)) / (frequency + K1 * lengthNorm);
    }, 0);
  });
}

function termCounts(words: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}
