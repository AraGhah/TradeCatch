/** The headline with its last occurrence of `accentWord` in the brand orange. */
export function accentHeadline(headline: string, accentWord: string) {
  const idx = headline.lastIndexOf(accentWord);
  if (idx === -1) return headline;
  return (
    <>
      {headline.slice(0, idx)}
      <span className="text-orange">{accentWord}</span>
      {headline.slice(idx + accentWord.length)}
    </>
  );
}
