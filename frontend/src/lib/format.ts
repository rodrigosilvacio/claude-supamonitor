const GB = 1024 ** 3;

export const bytesToGb = (b: number | null) => (b == null ? "" : String(Math.round((b / GB) * 100) / 100));
export const gbToBytes = (gb: string) => (gb.trim() === "" ? null : Math.round(Number(gb) * GB));

export function relativeTime(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return `há ${Math.floor(diff / 86400)} d`;
}
