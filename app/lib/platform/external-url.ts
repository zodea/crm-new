export async function openExternalUrl(url: string): Promise<boolean> {
  return window.open(url, '_blank', 'noopener,noreferrer') != null
}
