import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/**
 * Vision-input size cap. The Surplus API rejects JSON bodies over ~10MB, and base64
 * inflates by ~33%, so images are downscaled to at most this many pixels on their
 * longest edge before being attached (matches the OpenAI vision guidance).
 */
const MAX_DIMENSION = 1568;
const JPEG_COMPRESS = 0.85;

/** Per-message image cap — keeps the request body well under the ~10MB JSON limit. */
export const MAX_IMAGES_PER_MESSAGE = 4;

export interface PickedImage {
  /** JPEG data, base64, without the data: prefix. */
  base64: string;
  width: number;
  height: number;
}

/**
 * Opens the system photo picker with multi-selection and returns downscaled JPEGs.
 * Returns null when the user cancels. Throws a user-readable error when library
 * permission is denied.
 */
export async function pickImages(): Promise<PickedImage[] | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Izin akses galeri ditolak — aktifkan izin foto untuk aplikasi ini di pengaturan HP.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    base64: true,
    allowsMultipleSelection: true,
    selectionLimit: MAX_IMAGES_PER_MESSAGE,
  });
  if (result.canceled) return null;
  const out: PickedImage[] = [];
  for (const asset of result.assets) {
    if (!asset) continue;
    out.push(await processAsset(asset));
  }
  return out;
}

/** Normalizes one picked asset to a base64 JPEG of at most 1568px on its longest edge. */
async function processAsset(asset: {
  uri: string;
  base64?: string | null;
  width?: number | null;
  height?: number | null;
}): Promise<PickedImage> {
  const longest = Math.max(asset.width ?? 0, asset.height ?? 0);
  if (asset.base64 && longest > 0 && longest <= MAX_DIMENSION) {
    return { base64: asset.base64, width: asset.width ?? 0, height: asset.height ?? 0 };
  }

  // Too big (or no base64 from the picker): resize + re-encode as JPEG.
  const target =
    longest > MAX_DIMENSION
      ? fitWithin(asset.width ?? MAX_DIMENSION, asset.height ?? MAX_DIMENSION, MAX_DIMENSION)
      : { width: asset.width ?? 0, height: asset.height ?? 0 };
  const actions: ImageManipulator.Action[] =
    target.width && target.height ? [{ resize: { width: target.width, height: target.height } }] : [];
  const manipulated = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    format: ImageManipulator.SaveFormat.JPEG,
    compress: JPEG_COMPRESS,
    base64: true,
  });
  if (!manipulated.base64) {
    throw new Error('Gagal memproses gambar yang dipilih.');
  }
  return { base64: manipulated.base64, width: manipulated.width, height: manipulated.height };
}

/** Saves base64 JPEG data into the app documents dir, returns its file:// URI. */
export async function saveImageBase64(base64: string, extension = 'jpg'): Promise<string> {
  const dir = new Directory(Paths.document, 'images');
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const file = new File(dir, name);
  file.write(base64, { encoding: 'base64' });
  return file.uri;
}

/** Reads a saved image file back as base64 (no prefix). */
export async function readImageBase64(path: string): Promise<string> {
  const file = new File(path);
  return file.base64();
}

function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = max / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
