import { v2 as cloudinary } from 'cloudinary';

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
   * Generate signature for direct signed upload from browser to Cloudinary
   */
  static getUploadSignature(kind: string = 'other'): CloudinarySignResponse {
    this.configure();

    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'hatkhola-bazar/purchases';
    const type = 'authenticated';
    const allowedFormats = ['jpg', 'jpeg', 'png', 'webp'];

    const paramsToSign: Record<string, any> = {
      folder,
      timestamp,
      type,
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
   * Generate short-lived signed download / viewing URL for private authenticated asset
   */
  static getSignedDeliveryUrl(publicId: string, format: string = 'jpg'): string {
    this.configure();

    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

    if (!apiSecret || !cloudName) {
      return `/api/mock-asset/${publicId}.${format}`;
    }

    try {
      // Generate private authenticated URL with 1-hour expiration
      const expiresAt = Math.round(Date.now() / 1000) + 3600;
      return cloudinary.utils.private_download_url(publicId, format, {
        type: 'authenticated',
        expires_at: expiresAt,
      });
    } catch {
      return `https://res.cloudinary.com/${cloudName}/image/authenticated/${publicId}.${format}`;
    }
  }
}

