import type { RgbaImageData } from '../src/texgraph/image-utils'

export declare function resolveWorkspacePath(...segments: string[]): string
export declare function decodePngBytes(bytes: Uint8Array): RgbaImageData
export declare function encodePngBytes(img: RgbaImageData): Uint8Array
export declare function decodePngFile(filePath: string): RgbaImageData
export declare function encodePngFile(filePath: string, img: RgbaImageData): void
