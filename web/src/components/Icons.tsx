import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }
const base = (size = 22): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})
const mk = (d: React.ReactNode) => ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    {d}
  </svg>
)

export const IHome = mk(<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />)
export const ISwap = mk(<><path d="M5 8h13l-3.5-3.5" /><path d="M19 16H6l3.5 3.5" /></>)
export const IChart = mk(<><path d="M5 20v-6" /><path d="M10 20V10" /><path d="M15 20v-8" /><path d="M20 20V5" /></>)
export const IHistory = mk(<><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" /><path d="M4 4v4.5h4.5" /><path d="M12 8v4l3 2" /></>)
export const IUser = mk(<><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.3-3.6 4.2-5.3 7.5-5.3s6.2 1.7 7.5 5.3" /></>)
export const IBell = mk(<><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>)
export const IBack = mk(<path d="M15 5l-7 7 7 7" />)
export const IChev = mk(<path d="M9 6l6 6-6 6" />)
export const IDown = mk(<path d="M7 10l5 5 5-5" />)
export const IClose = mk(<><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>)
export const IPlus = mk(<><path d="M12 5v14" /><path d="M5 12h14" /></>)
export const IShield = mk(<path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z" />)
export const IShieldCheck = mk(<><path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z" /><path d="m9 12 2 2 4-4" /></>)
export const IDoc = mk(<><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" transform="translate(-1 0)" /><path d="M13 3.5V8h4" transform="translate(-1 0)" /><path d="M9 13h6M9 16.5h4" transform="translate(-1 0)" /></>)
export const IChat = mk(<path d="M5 18.5V6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v8a1.5 1.5 0 0 1-1.5 1.5H9z" />)
export const IEye = mk(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>)
export const IEyeOff = mk(<><path d="M4 4l16 16" /><path d="M9.9 6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.6-.3 3.7-.8" /></>)
export const ICheck = mk(<path d="m5 12.5 4.5 4.5L19 7.5" />)
export const ICamera = mk(<><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="12.5" r="3.3" /></>)
export const IInfo = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><path d="M12 8h.01" /></>)
export const IPhone = mk(<><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 18h2" /></>)
export const ILogout = mk(<><path d="M14 4h4.5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H14" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h9" /></>)
export const ITrash = mk(<><path d="M5 7h14" /><path d="M10 4h4" /><path d="M7 7l1 13h8l1-13" /></>)
export const IShare = mk(<><path d="M12 15V4" /><path d="M8 8l4-4 4 4" /><path d="M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7" /></>)
export const IClock = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>)
export const IQuestion = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7" /><path d="M12 17h.01" /></>)

export function VerifiedBadge({ size = 18 }: { size?: number }) {
  return (
    <svg className="verified" width={size} height={size} viewBox="0 0 24 24" aria-label="Подтверждён">
      <path
        fill="#8F2434"
        stroke="#EAE1D7"
        strokeWidth="1.2"
        d="M12 2.5l2.3 1.7 2.8-.2.9 2.7 2.3 1.6-.8 2.7.8 2.7-2.3 1.6-.9 2.7-2.8-.2L12 19.5l-2.3-1.7-2.8.2-.9-2.7-2.3-1.6.8-2.7-.8-2.7L6 6.7l.9-2.7 2.8.2z"
        transform="translate(0 1)"
      />
      <path d="m8.6 12.3 2.3 2.3 4.6-4.6" fill="none" stroke="#EAE1D7" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
