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

export const IFace = mk(<><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9 10v.5M15 10v.5" /><path d="M12 10v3.5h-1" /><path d="M9.5 16.2c1.4 1 3.6 1 5 0" /></>)
export const ILock = mk(<><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>)
export const IScale = mk(<><path d="M12 4v16M7 20h10" /><path d="M5 8h14" /><path d="m5 8-2.5 6a3 3 0 0 0 5 0zM19 8l-2.5 6a3 3 0 0 0 5 0z" /></>)
export const IFlow = mk(<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 6H15a3 3 0 0 1 3 3v6.5M6 8.5V15a3 3 0 0 0 3 3h6.5" /></>)
export const IChevLeft = mk(<path d="m15 5-7 7 7 7" />)
export const ITelegram = ({ size = 22, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M20.7 4.3 3.4 11c-1.2.5-1.2 1.2-.2 1.5l4.4 1.4 1.7 5.2c.2.6.4.8.9.8.4 0 .6-.2.9-.4l2.1-2.1 4.4 3.3c.8.4 1.4.2 1.6-.8l2.9-13.7c.3-1.2-.4-1.7-1.4-1.3ZM9 14.1l8.8-5.6c.4-.3.8-.1.5.2l-7.4 6.7-.3 3.2z" />
  </svg>
)
export const IGift = mk(
  <>
    <rect x="3.5" y="8" width="17" height="4" rx="1" />
    <path d="M5 12v7.5a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V12M12 8v12M12 8S10.5 4 8 4a2 2 0 0 0 0 4h4Zm0 0s1.5-4 4-4a2 2 0 0 1 0 4h-4Z" />
  </>,
)
export const ICrown = mk(<path d="m3.5 8 4.5 4 4-6 4 6 4.5-4-2 10h-13z" />)
export const IUsers = mk(
  <>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19c.6-3 2.9-4.8 5.5-4.8s4.9 1.8 5.5 4.8M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.6c1.6.6 2.7 2.1 3 4.4" />
  </>,
)
export const ICopy = mk(
  <>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </>,
)
export const IId = mk(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <circle cx="9" cy="11" r="2.2" />
    <path d="M5.8 16.2c.5-1.5 1.7-2.3 3.2-2.3s2.7.8 3.2 2.3M14.5 10h4M14.5 13.5h3" />
  </>,
)
