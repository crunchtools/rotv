export function isFeatureEnabled(flag) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('feature') === flag) {
    if (params.get('off') === 'true') {
      localStorage.removeItem(`feature_${flag}`);
      return false;
    }
    localStorage.setItem(`feature_${flag}`, 'true');
    return true;
  }
  return localStorage.getItem(`feature_${flag}`) === 'true';
}
