'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// Mobile-only top bar with a hamburger toggle. Hidden on desktop via CSS.
// Toggles the .sidebar-open class on <body> so the sidebar slides in.
// Auto-closes whenever the route changes.
export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    document.body.classList.toggle('sidebar-open', open);
    return () => document.body.classList.remove('sidebar-open');
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="mobile-topbar">
        <button className="hamburger" aria-label="Toggle navigation" onClick={() => setOpen(!open)}>
          <span /><span /><span />
        </button>
        <span className="mobile-brand"><span className="dot" /> YT Automation</span>
      </div>
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}
    </>
  );
}
