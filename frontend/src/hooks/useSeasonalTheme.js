import { useState, useEffect } from 'react';

export default function useSeasonalTheme() {
  const [config, setConfig] = useState(null);
  const [activeTheme, setActiveTheme] = useState(null);
  const [isNightMode, setIsNightMode] = useState(false);
  const [videoUrls, setVideoUrls] = useState({});

  useEffect(() => {
    const fetchConfig = () => {
      fetch('/api/theme-config')
        .then(res => res.json())
        .then(themeConfig => {
          if (themeConfig.seasonal_themes) {
            const parsed = typeof themeConfig.seasonal_themes === 'string'
              ? JSON.parse(themeConfig.seasonal_themes)
              : themeConfig.seasonal_themes;
            setConfig(parsed);
          }

          if (themeConfig.video_urls) {
            setVideoUrls(themeConfig.video_urls);
          }
        })
        .catch(err => console.error('Failed to fetch theme config:', err));
    };

    fetchConfig();

    const handleConfigUpdate = () => fetchConfig();
    window.addEventListener('theme-config-updated', handleConfigUpdate);

    return () => {
      window.removeEventListener('theme-config-updated', handleConfigUpdate);
    };
  }, []);

  useEffect(() => {
    if (!config) return;

    const updateTheme = () => {
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
      console.log('[Theme Debug] Hour:', now.getHours(), 'Active theme:', theme.activeTheme, 'Night mode:', theme.isNightMode);
      setActiveTheme(theme.activeTheme);
      setIsNightMode(theme.isNightMode);
    };

    updateTheme();

    const handlePreviewChange = () => updateTheme();
    window.addEventListener('theme-preview-change', handlePreviewChange);

    const midnightCheck = setInterval(() => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        updateTheme();
      }
    }, 60000);

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

  return { activeTheme, isNightMode, videoUrls };
}

function calculateActiveTheme(config, now) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const monthDay = `${month}/${day}`;
  const hour = now.getHours();

  const nightModeEnabled = config.nightMode.enabled &&
    (hour >= config.nightMode.startHour || hour < config.nightMode.endHour);

  if (nightModeEnabled) {
    return {
      activeTheme: 'night',
      isNightMode: true
    };
  }

  const enabledThemes = config.themes
    .filter(t => t.enabled && isDateInRange(monthDay, t.startDate, t.endDate))
    .sort((a, b) => a.priority - b.priority);

  return {
    activeTheme: enabledThemes[0]?.id || null,
    isNightMode: false
  };
}

function isDateInRange(current, start, end) {
  if (start > end) {
    return current >= start || current <= end;
  }
  return current >= start && current <= end;
}
