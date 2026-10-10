import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

export interface ResizedImageResult {
  filename: string;
  path: string;
  url: string;
  approved: boolean;
  user_id: number;
  isMain: boolean;
}
export async function resizeAndSaveImageHelper(
  file: Express.Multer.File,
  userId: number,
  isMain: boolean,
  baseFolder = `public/images/users/${userId}`,
): Promise<ResizedImageResult> {
  if (!userId) {
    throw new Error('User ID is required.');
  }

  if (!file?.buffer?.length) {
    throw new Error('Image file is empty.');
  }

  const maxBytes = 5 * 1024 * 1024;

  if (file.size > maxBytes) {
    throw new Error('Image exceeds the 5 MB limit.');
  }

  const metadata = await sharp(file.buffer).metadata();

  if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
    throw new Error('Unsupported image format.');
  }

  if (!metadata.width || !metadata.height) {
    throw new Error('Invalid image dimensions.');
  }

  if (
    metadata.width > 8000 ||
    metadata.height > 8000 ||
    metadata.width * metadata.height > 25_000_000
  ) {
    throw new Error('Image dimensions exceed the allowed limit.');
  }
  const { buffer } = file;
  const fileName = `${uuidv4().slice(0, 5)}.webp`;
  const uploadPath = path.resolve(process.cwd(), baseFolder);
  const sizes = ['800', '400', '100'];
  for (const size of sizes) {
    const dir = path.join(uploadPath, size);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const paths = {
    800: path.join(uploadPath, '800', fileName),
    400: path.join(uploadPath, '400', fileName),
    100: path.join(uploadPath, '100', fileName),
  };

  await sharp(buffer).resize(800).webp({ quality: 70 }).toFile(paths[800]);
  await sharp(buffer).resize(400).webp({ quality: 70 }).toFile(paths[400]);
  await sharp(buffer).resize(100).webp({ quality: 60 }).toFile(paths[100]);
  return {
    filename: fileName,
    path: paths[800],
    approved: false,
    user_id: userId,
    url: `/images/users/${userId}/800/${fileName}`,
    isMain,
  };
}
