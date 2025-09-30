
export function sniffMime(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer);
  // JPEG FF D8
  if(bytes[0]===0xFF && bytes[1]===0xD8) return 'image/jpeg';
  // PNG 89 50 4E 47
  if(bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4E && bytes[3]===0x47) return 'image/png';
  // PDF %PDF
  if(bytes[0]===0x25 && bytes[1]===0x50 && bytes[2]===0x44 && bytes[3]===0x46) return 'application/pdf';
  // WEBP 'RIFF'....'WEBP' check bytes 0-3 and 8-11
  if(bytes[0]===0x52 && bytes[1]===0x49 && bytes[2]===0x46 && bytes[3]===0x46 && bytes[8]===0x57 && bytes[9]===0x45 && bytes[10]===0x42 && bytes[11]===0x50) return 'image/webp';
  return null;
}
