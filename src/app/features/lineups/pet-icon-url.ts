const CDN_BASE = 'https://raw.githubusercontent.com/afk-mine/cdn/main/framed_unit_icon';

export function petIconUrl(petId: number): string {
  return `${CDN_BASE}/${petId}.webp`;
}
