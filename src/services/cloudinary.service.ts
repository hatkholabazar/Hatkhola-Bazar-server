import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

export interface CloudinarySignResponse {
  signature: string;
  timestamp: number;
  cloudName: string;
  apiKey: string;
  folder: string;
  type: string;
  allowedFormats: string[];
}

export class CloudinaryService {
  private static isConfigured(): boolean {
    return Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
  }

  private static configure() {
    if (this.isConfigured()) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
      });
    }
  }

  /**
   * Resolves appropriate Cloudinary folder based on asset purpose
   */
  private static resolveFolder(kind: string): string {
    switch (kind.toLowerCase()) {
      case 'product':
      case 'products':
        return 'hatkhola-bazar/products';
      case 'refund':
      case 'refunds':
        return 'hatkhola-bazar/refunds';
      case 'batch':
      case 'purchase':
      case 'courier_slip':
      case 'invoice':
      default:
        return 'hatkhola-bazar/purchases';
    }
  }

  /**
   * Generate signature for direct signed upload from browser to Cloudinary
   * Uses public 'upload' type so image URLs are permanent and directly embeddable like ImageBB
   */
  static getUploadSignature(kind: string = 'other'): CloudinarySignResponse {
    this.configure();

    const timestamp = Math.round(Date.now() / 1000);
    const folder = this.resolveFolder(kind);
    const type = 'upload';
    const allowedFormats = ['jpg', 'jpeg', 'png', 'webp', 'avif'];

    const paramsToSign: Record<string, any> = {
      folder,
      timestamp,
    };

    let signature = '';
    const apiSecret = process.env.CLOUDINARY_API_SECRET || 'mock_secret_for_test';

    try {
      signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);
    } catch {
      // Mock fallback in offline / test environments
      signature = `mock_sig_${timestamp}`;
    }

    return {
      signature,
      timestamp,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'mock_cloud',
      apiKey: process.env.CLOUDINARY_API_KEY || 'mock_api_key',
      folder,
      type,
      allowedFormats,
    };
  }

  /**
   * Server-side upload from base64, buffer, or remote URL directly to Cloudinary
   */
  static async uploadDirect(
    fileData: string,
    kind: string = 'other',
    customPublicId?: string
  ): Promise<{
    url: string;
    secureUrl: string;
    publicId: string;
    format: string;
    bytes: number;
    width?: number;
    height?: number;
  }> {
    this.configure();

    const folder = this.resolveFolder(kind);
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'zswkxeiy';

    if (!this.isConfigured()) {
      // Mock fallback for test environment
      const mockId = customPublicId || `mock_${Date.now()}`;
      return {
        url: `http://res.cloudinary.com/${cloudName}/image/upload/${folder}/${mockId}.jpg`,
        secureUrl: `https://res.cloudinary.com/${cloudName}/image/upload/${folder}/${mockId}.jpg`,
        publicId: `${folder}/${mockId}`,
        format: 'jpg',
        bytes: 10240,
        width: 800,
        height: 800,
      };
    }

    const options: Record<string, any> = {
      folder,
      resource_type: 'image',
      overwrite: true,
      invalidate: true,
    };

    if (customPublicId) {
      options.public_id = customPublicId;
    }

    const result: UploadApiResponse = await cloudinary.uploader.upload(fileData, options);

    return {
      url: result.url,
      secureUrl: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
    };
  }

  /**
   * Generate optimized public delivery URL with auto format and auto quality
   */
  static getOptimizedUrl(publicId: string, format: string = 'jpg'): string {
    this.configure();
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'zswkxeiy';
    return `https://res.cloudinary.com/${cloudName}/image/upload/f_auto,q_auto/${publicId}.${format}`;
  }

  /**
   * Alias / backwards-compatible method to get permanent delivery URL
   */
  static getSignedDeliveryUrl(publicId: string, format: string = 'jpg'): string {
    return this.getOptimizedUrl(publicId, format);
  }
}
