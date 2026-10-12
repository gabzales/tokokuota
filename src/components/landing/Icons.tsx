// Small inline icons (no icon library, no network): decorative, so aria-hidden.
type P = { className?: string };
const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const WalletIcon = ({ className }: P) => (<svg {...base} className={className}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1.5" /><path d="M3 7.5V17a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2.5" /><path d="M21 9.5h-4.5a2.5 2.5 0 0 0 0 5H21a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5Z" /></svg>);
export const StatusIcon = ({ className }: P) => (<svg {...base} className={className}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.4 2.4 4.6-5.2" /></svg>);
export const TagIcon = ({ className }: P) => (<svg {...base} className={className}><path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9-9-9Z" /><circle cx="8" cy="8" r="1.2" /></svg>);
export const ShieldIcon = ({ className }: P) => (<svg {...base} className={className}><path d="M12 3 5 6v5.5c0 4.2 2.9 7.9 7 9.5 4.1-1.6 7-5.3 7-9.5V6l-7-3Z" /><path d="m9 12 2.2 2.2L15.2 10" /></svg>);
export const UserPlusIcon = ({ className }: P) => (<svg {...base} className={className}><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" /></svg>);
export const BankIcon = ({ className }: P) => (<svg {...base} className={className}><path d="M3 9.5 12 4l9 5.5" /><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7" /><path d="M3 20h18" /></svg>);
export const PhoneIcon = ({ className }: P) => (<svg {...base} className={className}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>);
export const ChevronIcon = ({ className }: P) => (<svg {...base} className={className}><path d="m6 9 6 6 6-6" /></svg>);
