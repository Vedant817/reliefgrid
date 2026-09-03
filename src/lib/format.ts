export function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDeadline(ts: number) {
  const diff = ts - Date.now();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (diff < 0) return "Overdue";
  if (hours <= 0) return `${mins}m left`;
  return `${hours}h ${mins}m left`;
}

export function deadlineUrgency(ts: number): "ok" | "warn" | "critical" {
  const diff = ts - Date.now();
  if (diff < 0) return "critical";
  if (diff < 2 * 60 * 60 * 1000) return "critical";
  if (diff < 6 * 60 * 60 * 1000) return "warn";
  return "ok";
}
