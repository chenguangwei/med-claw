function countChars(value: string): number {
  return Array.from(value).length;
}

function looksLikeSegmentedStream(content: string): boolean {
  if (!content.includes('\n')) return false;

  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const nonEmptyLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (nonEmptyLines.length < 8) return false;

  const shortLines = nonEmptyLines.filter(
    (line) => countChars(line) <= 8
  ).length;
  const cjkLines = nonEmptyLines.filter((line) => /\p{Script=Han}/u.test(line));
  const markdownFragmentLines = nonEmptyLines.filter((line) =>
    /^(#{1,6}|\*\*|[-+*.]|\d+|[，。！？、：；（）])$/.test(line)
  );

  return (
    shortLines / nonEmptyLines.length >= 0.75 &&
    cjkLines.length + markdownFragmentLines.length >= nonEmptyLines.length * 0.6
  );
}

export function normalizeAssistantMessageContent(content: string): string {
  if (!looksLikeSegmentedStream(content)) return content;

  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.length === 0 ? '\n' : line))
    .join('')
    .trim();
}
