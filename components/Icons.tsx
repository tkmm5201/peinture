export const Logo = ({ className }: { className?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 180 180"
      fill="currentColor"
      stroke="currentColor"
      className={className}
    >
      <g fill="none" fillRule="evenodd" transform="translate(40 10)">
        <path
          strokeLinecap="square"
          strokeLinejoin="round"
          strokeWidth="8"
          d="M94 118a8 8 0 0 1-8 8H8a8 8 0 0 1-8-8V40a8 8 0 0 1 8-8"
        />
        <path
          strokeLinecap="round"
          strokeWidth="8"
          d="m93.5 77.5.95 37.988M7 32.5h43.5"
        />
        <path
          fill="currentColor"
          stroke="none"
          fillRule="nonzero"
          d="m14 103 17.25-22.667 17.25 17L65.75 69 83 103z"
        />
        <circle
          cx="32.5"
          cy="60.5"
          r="7.5"
          fill="currentColor"
          stroke="none"
          fillRule="nonzero"
        />
        <path
          fill="currentColor"
          stroke="none"
          fillRule="nonzero"
          d="M93.555 0c0 19.054-15.413 34.5-34.427 34.5 19.014 0 34.427 15.446 34.427 34.5 0-19.054 15.414-34.5 34.428-34.5-19.014 0-34.428-15.446-34.428-34.5"
        />
      </g>
    </svg>
  );
};

export const Icon4x = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M5 7v8h5" />
    <path d="M9 7v10" />
    <path d="M14 7l5 8" />
    <path d="M14 15l5 -8" />
  </svg>
);
