export default function NextuinMark({ className = '', ...rest }) {
  return (
    <svg
      className={'nextuin-mark ' + className}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M17 49V15h8l15.5 20.2V15H48v34h-8L24.5 28.7V49z" />
      <rect x="4" y="23" width="5" height="18" rx="2.5" />
      <rect x="10.5" y="19" width="5" height="26" rx="2.5" />
      <rect x="48.5" y="19" width="5" height="26" rx="2.5" />
      <rect x="55" y="23" width="5" height="18" rx="2.5" />
    </svg>
  )
}
