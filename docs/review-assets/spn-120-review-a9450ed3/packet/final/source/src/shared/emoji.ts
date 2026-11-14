/** One complete emoji, including joined people, flags, skin tones and keycaps. */
export function validEmoji(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 32) return false;
  if (/^[#*0-9]\ufe0f?\u20e3$/u.test(value)) return true;
  return (
    /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value) &&
    [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)].length === 1 &&
    // Emoji modifiers and joiners intentionally share a grapheme with the base.
    // eslint-disable-next-line no-misleading-character-class
    /^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0f\u20e3\u{e0020}-\u{e007f}]+$/u.test(
      value,
    )
  );
}
