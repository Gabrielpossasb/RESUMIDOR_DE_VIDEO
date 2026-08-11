function pad(n) {
  return String(n).padStart(2, "0");
}

export function formatTimestamp(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}
