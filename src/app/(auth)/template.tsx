export default function Template({ children }: { children: React.ReactNode }) {
  // re-mounts on every navigation: a short fade/slide gives the page change a smooth feel
  return <div className="animate-page-in">{children}</div>;
}
