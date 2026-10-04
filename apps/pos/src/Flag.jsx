// Small inline flags for the language choices. Flag emoji (🇰🇭 🇺🇸) aren't
// drawn on Windows -- it shows the letters "KH" / "US" -- so these are SVG.
// Simplified for ~20px: Cambodia's blue-red-blue bands with Angkor Wat, and
// the US stripes and canton (stars as a dot grid).

function Cambodia() {
  return (
    <svg viewBox="0 0 30 20" className="w-full h-full" aria-hidden="true">
      <rect width="30" height="20" fill="#032EA1" />
      <rect y="5" width="30" height="10" fill="#E00025" />
      {/* Angkor Wat: base, three towers (the middle one tallest) */}
      <g fill="#fff">
        <rect x="8.5" y="12.4" width="13" height="1.4" />
        <rect x="9.5" y="11" width="11" height="1.4" />
        <polygon points="11,11 12,7.6 13,11" />
        <polygon points="13.8,11 15,6.4 16.2,11" />
        <polygon points="17,11 18,7.6 19,11" />
      </g>
    </svg>
  );
}

function UnitedStates() {
  const stripes = Array.from({ length: 13 }, (_, i) => i);
  const stars = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 6; col++) stars.push([1.4 + col * 2, 1.3 + row * 2.1]);
  }
  return (
    <svg viewBox="0 0 30 20" className="w-full h-full" aria-hidden="true">
      {stripes.map((i) => (
        <rect key={i} y={(i * 20) / 13} width="30" height={20 / 13 + 0.05} fill={i % 2 === 0 ? '#B22234' : '#fff'} />
      ))}
      <rect width="12" height={(20 * 7) / 13} fill="#3C3B6E" />
      {stars.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.45" fill="#fff" />
      ))}
    </svg>
  );
}

const FLAGS = { km: Cambodia, en: UnitedStates };

/** locale: 'km' or 'en'. */
export default function Flag({ locale, className = '' }) {
  const Svg = FLAGS[locale];
  if (!Svg) return null;
  return (
    <span className={`inline-block w-5 h-[14px] rounded-[3px] overflow-hidden ring-1 ring-black/10 flex-shrink-0 ${className}`}>
      <Svg />
    </span>
  );
}
