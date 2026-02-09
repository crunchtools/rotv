import { useState, useEffect } from 'react';

export default function useSeasonalTheme() {
  const [config, setConfig] = useState(null);
  const [activeTheme, setActiveTheme] = useState(null);
  const [isNightMode, setIsNightMode] = useState(false);

  // Fetch config on mount and when updated
  useEffect(() => {
    const fetchConfig = () => {
      fetch('/api/admin/settings', { credentials: 'include' })
        .then(res => res.json())
        .then(settings => {
          if (settings.seasonal_themes?.value) {
            const parsed = JSON.parse(settings.seasonal_themes.value);
            setConfig(parsed);
          }
        })
        .catch(err => console.error('Failed to fetch theme config:', err));
    };

    fetchConfig();

    // Listen for config updates from Settings page
    const handleConfigUpdate = () => fetchConfig();
    window.addEventListener('theme-config-updated', handleConfigUpdate);

    return () => {
      window.removeEventListener('theme-config-updated', handleConfigUpdate);
    };
  }, []);

  // Calculate active theme
  useEffect(() => {
    if (!config) return;

    const updateTheme = () => {
      // Check for preview mode
      const previewTheme = sessionStorage.getItem('theme-preview');
      if (previewTheme) {
        if (previewTheme === 'night') {
          setActiveTheme('night');
          setIsNightMode(true);
        } else {
          setActiveTheme(previewTheme);
          setIsNightMode(false);
        }
        return;
      }

      const now = new Date();
      const theme = calculateActiveTheme(config, now);
      setActiveTheme(theme.activeTheme);
      setIsNightMode(theme.isNightMode);
    };

    // Initial calculation
    updateTheme();

    // Listen for preview changes
    const handlePreviewChange = () => updateTheme();
    window.addEventListener('theme-preview-change', handlePreviewChange);

    // Re-check at midnight
    const midnightCheck = setInterval(() => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        updateTheme();
      }
    }, 60000); // Check every minute around midnight

    // Re-check at night mode boundaries
    const nightModeCheck = setInterval(() => {
      const hour = new Date().getHours();
      if (hour === config.nightMode.startHour || hour === config.nightMode.endHour) {
        updateTheme();
      }
    }, 60000);

    return () => {
      clearInterval(midnightCheck);
      clearInterval(nightModeCheck);
      window.removeEventListener('theme-preview-change', handlePreviewChange);
    };
  }, [config]);

  return { activeTheme, isNightMode };
}

function calculateActiveTheme(config, now) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const monthDay = `${month}/${day}`;
  const hour = now.getHours();

  // Check night mode
  const nightModeEnabled = config.nightMode.enabled &&
    (hour >= config.nightMode.startHour || hour < config.nightMode.endHour);

  // If night mode is active, prioritize it
  if (nightModeEnabled) {
    return {
      activeTheme: 'night',
      isNightMode: true
    };
  }

  // Find active theme by priority
  const enabledThemes = config.themes
    .filter(t => t.enabled && isDateInRange(monthDay, t.startDate, t.endDate))
    .sort((a, b) => a.priority - b.priority);

  return {
    activeTheme: enabledThemes[0]?.id || null,
    isNightMode: false
  };
}

function isDateInRange(current, start, end) {
  // Handle year-wrap case (e.g., 12/27 to 01/02)
  if (start > end) {
    return current >= start || current <= end;
  }
  return current >= start && current <= end;
}
