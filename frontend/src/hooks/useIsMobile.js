import { useState, useEffect } from 'react';

// Same breakpoint as the mobile block in App.css
const MOBILE_QUERY = '(max-width: 768px)';

/**
 * @returns {boolean} Whether the viewport is phone-sized right now
 */
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
