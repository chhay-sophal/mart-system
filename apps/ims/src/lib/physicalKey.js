// A barcode scanner is a keyboard wedge: it "types" the barcode's characters
// into whatever field has focus. When the OS input language is set to
// something non-Latin (e.g. Khmer), the browser maps those physical keys to
// that language's characters instead of the ASCII the barcode actually is.
// KeyboardEvent.code identifies the physical key regardless of layout, so
// mapping from that (rather than trusting KeyboardEvent.key) is layout-
// independent -- this covers letters, digits and punctuation generally, not
// just digits (an all-digit fix doesn't help a barcode containing letters).
const KEYCODE_CHARS = (() => {
  const map = {};
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i); // A-Z
    map[`Key${letter}`] = [letter.toLowerCase(), letter];
  }
  const DIGIT_SHIFTED = [')', '!', '@', '#', '$', '%', '^', '&', '*', '('];
  for (let i = 0; i <= 9; i++) {
    map[`Digit${i}`] = [String(i), DIGIT_SHIFTED[i]];
    // Some scanners are configured to emit numpad keycodes instead of the
    // top digit row -- always a plain digit, no shifted/symbol variant.
    map[`Numpad${i}`] = [String(i), String(i)];
  }
  Object.assign(map, {
    Minus: ['-', '_'], Equal: ['=', '+'],
    BracketLeft: ['[', '{'], BracketRight: [']', '}'],
    Semicolon: [';', ':'], Quote: ["'", '"'], Backslash: ['\\', '|'],
    Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'],
    Backquote: ['`', '~'], Space: [' ', ' '],
  });
  return map;
})();

/** The ASCII character `e.code` would produce on a plain US keyboard, or null for a key this map doesn't cover (arrows, Enter, Backspace, modifiers, ...). */
export function physicalKeyChar(e) {
  const pair = KEYCODE_CHARS[e.code];
  return pair ? pair[e.shiftKey ? 1 : 0] : null;
}
