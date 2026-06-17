/**
 * Format a UTC datetime string to local time display.
 * All backend timestamps are UTC. Adding "Z" suffix ensures
 * JavaScript treats them as UTC and converts to local time correctly.
 */

export const formatTime = (isoString) => {
  if (!isoString) return '--';
  const s = isoString.endsWith('Z') ? isoString : isoString + 'Z';
  return new Date(s).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

export const formatDate = (isoString) => {
  if (!isoString) return '--';
  const s = isoString.endsWith('Z') ? isoString : isoString + 'Z';
  return new Date(s).toLocaleDateString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

export const formatDateTime = (isoString) => {
  if (!isoString) return '--';
  const s = isoString.endsWith('Z') ? isoString : isoString + 'Z';
  const d = new Date(s);
  return d.toLocaleDateString([], {
    day: '2-digit',
    month: 'short'
  }) + ' ' + d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

export const formatDuration = (minutes) => {
  if (!minutes || minutes === 0) return '0h 0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export const minutesToHours = (minutes) => {
  if (!minutes || minutes === 0) return '0.0 hrs';
  return (minutes / 60).toFixed(1) + ' hrs';
};
