export function StatusBadge({ status }) {
  const statusConfig = {
    open: { label: 'Open', className: 'status-open', icon: '✓' },
    closed: { label: 'Closed', className: 'status-closed', icon: '×' },
    limited: { label: 'Limited', className: 'status-limited', icon: '⚠' },
    maintenance: { label: 'Maintenance', className: 'status-maintenance', icon: '🔧' },
    unknown: { label: 'Unknown', className: 'status-unknown', icon: '?' }
  };

  const config = statusConfig[status] || statusConfig.unknown;

  return (
    <span className={`status-badge ${config.className}`}>
      {config.icon} {config.label}
    </span>
  );
}
