import { BadRequestError } from "../shared/errors.ts";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const SIGNATURES: ReadonlyArray<{
  ext: string;
  mime: string;
  matches: (bytes: Buffer) => boolean;
}> = [
  {
    ext: "png",
    mime: "image/png",
    matches: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: "jpg",
    mime: "image/jpeg",
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: "webp",
    mime: "image/webp",
    matches: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export type DetectedImage = { ext: string; mime: string };

export function detectImage(bytes: Buffer): DetectedImage {
  if (bytes.length === 0) {
    throw new BadRequestError("The uploaded file is empty");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new BadRequestError("Images must be 2 MB or smaller");
  }

  const match = SIGNATURES.find((signature) => signature.matches(bytes));
  if (!match) {
    throw new BadRequestError("Only PNG, JPEG and WebP images are accepted");
  }
  return { ext: match.ext, mime: match.mime };
}
