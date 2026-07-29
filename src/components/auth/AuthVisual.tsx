export default function AuthVisual() {
  return (
    <div className="relative mt-8 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
      <svg
        viewBox="0 0 400 220"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-auto w-full text-indigo-500/70"
        aria-hidden="true"
      >
        <pattern id="atlas-dotgrid" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.2" className="fill-zinc-800" />
        </pattern>
        <rect width="400" height="220" fill="url(#atlas-dotgrid)" opacity="0.5" />

        <g className="fill-zinc-800">
          <rect x="40" y="120" width="30" height="80" rx="2" />
          <rect x="80" y="90" width="34" height="110" rx="2" />
          <rect x="124" y="140" width="26" height="60" rx="2" />
          <rect x="160" y="70" width="36" height="130" rx="2" />
          <rect x="210" y="110" width="28" height="90" rx="2" />
          <rect x="250" y="130" width="32" height="70" rx="2" />
          <rect x="292" y="95" width="30" height="105" rx="2" />
          <rect x="330" y="150" width="26" height="50" rx="2" />
        </g>

        <g stroke="currentColor" strokeWidth="1.2">
          <line x1="90" y1="60" x2="150" y2="40" />
          <line x1="150" y1="40" x2="220" y2="55" />
          <line x1="220" y1="55" x2="280" y2="35" />
          <line x1="150" y1="40" x2="200" y2="90" />
          <line x1="220" y1="55" x2="260" y2="90" />
        </g>
        <g className="fill-indigo-400">
          <circle cx="90" cy="60" r="4" />
          <circle cx="150" cy="40" r="5" />
          <circle cx="220" cy="55" r="4" />
          <circle cx="280" cy="35" r="4" />
          <circle cx="200" cy="90" r="3.5" />
          <circle cx="260" cy="90" r="3.5" />
        </g>
      </svg>
    </div>
  );
}
