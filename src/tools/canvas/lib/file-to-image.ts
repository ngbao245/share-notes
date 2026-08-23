// ============================================================
// Canvas — File/Blob → Image metadata helper
// ============================================================

const ACCEPTED_MIME = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
];

const MAX_DEFAULT_WIDTH = 400;

export function isImageMime(type: string): boolean {
  return ACCEPTED_MIME.includes(type);
}

export interface ImageMetadata {
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
  mimeType: string;
}

/**
 * Đọc intrinsic dimension từ blob. Scale down width > MAX_DEFAULT_WIDTH.
 * Cleanup temp URL sau khi đo.
 */
export async function readImageMetadata(blob: Blob): Promise<ImageMetadata> {
  const url = URL.createObjectURL(blob);
  try {
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error('Không đọc được kích thước ảnh'));
      img.src = url;
    });
    const aspect = dims.w / dims.h;
    let dw = dims.w;
    let dh = dims.h;
    if (dw > MAX_DEFAULT_WIDTH) {
      dw = MAX_DEFAULT_WIDTH;
      dh = dw / aspect;
    }
    return {
      naturalWidth: dims.w,
      naturalHeight: dims.h,
      displayWidth: Math.round(dw),
      displayHeight: Math.round(dh),
      mimeType: blob.type,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
