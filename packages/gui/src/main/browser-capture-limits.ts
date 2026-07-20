export const BROWSER_CAPTURE_MAX_DIMENSION = 2048
export const BROWSER_CAPTURE_MAX_ENCODED_BYTES = 8 * 1024 * 1024
export const PNG_DATA_URL_PREFIX = "data:image/png;base64,"

export type CaptureDimensions = { width: number; height: number }

export function fitBrowserCaptureDimensions(
  size: CaptureDimensions,
  maxDimension = BROWSER_CAPTURE_MAX_DIMENSION,
) {
  const width = Math.max(1, Math.floor(size.width))
  const height = Math.max(1, Math.floor(size.height))
  const scale = Math.min(1, maxDimension / width, maxDimension / height)
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

export function browserCaptureEncodedBytes(pngBytes: number) {
  return PNG_DATA_URL_PREFIX.length + 4 * Math.ceil(Math.max(0, pngBytes) / 3)
}

export function shrinkBrowserCaptureDimensions(
  size: CaptureDimensions,
  encodedBytes: number,
  maxEncodedBytes = BROWSER_CAPTURE_MAX_ENCODED_BYTES,
) {
  const ratio = Math.min(0.9, Math.sqrt(maxEncodedBytes / Math.max(1, encodedBytes)) * 0.95)
  return {
    width: Math.max(1, Math.floor(size.width * ratio)),
    height: Math.max(1, Math.floor(size.height * ratio)),
  }
}
