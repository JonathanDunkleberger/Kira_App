interface KiraLogoProps {
  size?: number;
  id?: string;
}

export function KiraLogo({ size = 24, id = "kiraXO" }: KiraLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#A8B8D0"/>
          <stop offset="100%" stopColor="#6B7DB3"/>
        </linearGradient>
      </defs>
      <rect x="12" y="10" width="17" height="85" rx="8"
        transform="rotate(-38 50 50)" fill={`url(#${id})`}/>
      <rect x="12" y="10" width="17" height="85" rx="8"
        transform="rotate(38 50 50)" fill={`url(#${id})`}/>
      <circle cx="62" cy="50" r="24"
        stroke={`url(#${id})`} strokeWidth="14" fill="none"/>
    </svg>
  );
}
