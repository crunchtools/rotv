export function getTrainStatus(trainPosition) {
  if (trainPosition?.status === 'active') return { label: 'Live', className: 'live' };
  if (trainPosition?.status === 'idle') return { label: 'Idle', className: 'idle' };
  if (trainPosition?.status === 'parked') return { label: 'Parked', className: 'docked' };
  return { label: 'Offline', className: 'offline' };
}
