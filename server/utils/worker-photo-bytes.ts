import type { WorkerPhotoUpload } from '../../app/lib/worker-roster/contract'
import { Buffer } from 'node:buffer'
import { rosterProblem } from '../../app/lib/worker-roster/contract'

/** Original bytes policy shared by both storage formats; it does not read or own a database. */
export function validatedWorkerPhotoBytes(photo: WorkerPhotoUpload): Buffer {
  const bytes = Buffer.from(photo.payloadBase64, 'base64')
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!bytes.length || bytes.length > 20 * 1024 * 1024 || bytes.length !== photo.fileSize || bytes.toString('base64') !== photo.payloadBase64 || !((png && photo.mimeType === 'image/png' && /\.png$/i.test(photo.fileName)) || (jpeg && photo.mimeType === 'image/jpeg' && /\.jpe?g$/i.test(photo.fileName))))
    return rosterProblem('validation-failed', '照片正文、大小和 PNG/JPEG 类型不一致')
  return bytes
}
