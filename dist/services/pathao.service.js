"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathaoService = exports.PATHAO_STATUS_MAP = void 0;
exports.resolvePathaoStatus = resolvePathaoStatus;
const zod_1 = require("zod");
const env_1 = require("../config/env");
exports.PATHAO_STATUS_MAP = {
    pending: {
        labelEn: 'Pending Courier Pickup',
        labelBn: 'পিকআপের অপেক্ষায়',
        isFinal: false,
        progressStep: 'Sent to courier',
        color: 'amber',
    },
    accepted: {
        labelEn: 'Accepted by Courier',
        labelBn: 'কুরিয়ার গ্রহণ করেছে',
        isFinal: false,
        progressStep: 'Sent to courier',
        color: 'blue',
    },
    in_transit: {
        labelEn: 'In Transit',
        labelBn: 'ট্রানজিটে রয়েছে',
        isFinal: false,
        progressStep: 'Sent to courier',
        color: 'blue',
    },
    picked_up: {
        labelEn: 'Picked Up by Courier',
        labelBn: 'পিকআপ সম্পন্ন',
        isFinal: false,
        progressStep: 'Sent to courier',
        color: 'indigo',
    },
    assigned_for_delivery: {
        labelEn: 'Assigned for Delivery',
        labelBn: 'ডেলিভারির জন্য বরাদ্দ',
        isFinal: false,
        progressStep: 'Out for delivery',
        color: 'indigo',
    },
    out_for_delivery: {
        labelEn: 'Out for Delivery',
        labelBn: 'ডেলিভারির জন্য বের হয়েছে',
        isFinal: false,
        progressStep: 'Out for delivery',
        color: 'indigo',
    },
    delivered: {
        labelEn: 'Delivered',
        labelBn: 'সফলভাবে ডেলিভারি হয়েছে',
        isFinal: true,
        progressStep: 'Delivered',
        color: 'emerald',
    },
    partial_delivered: {
        labelEn: 'Partially Delivered',
        labelBn: 'আংশিক ডেলিভারি সম্পন্ন',
        isFinal: true,
        progressStep: 'Delivered',
        color: 'emerald',
    },
    returned: {
        labelEn: 'Returned to Merchant',
        labelBn: 'রিটার্ন হয়েছে',
        isFinal: true,
        progressStep: 'Returned',
        color: 'rose',
    },
    cancelled: {
        labelEn: 'Consignment Cancelled',
        labelBn: 'বাতিল করা হয়েছে',
        isFinal: true,
        progressStep: 'Returned',
        color: 'rose',
    },
    on_hold: {
        labelEn: 'On Hold',
        labelBn: 'সাময়িকভাবে স্থগিত',
        isFinal: false,
        progressStep: 'Sent to courier',
        color: 'amber',
    },
    failed: {
        labelEn: 'Delivery Attempt Failed',
        labelBn: 'ডেলিভারি ব্যর্থ',
        isFinal: false,
        progressStep: 'Sent to courier',
        color: 'rose',
    },
};
function resolvePathaoStatus(slugOrStatus) {
    const normalizedSlug = (slugOrStatus || 'unknown')
        .toLowerCase()
        .trim()
        .replace(/[\s-]+/g, '_');
    if (exports.PATHAO_STATUS_MAP[normalizedSlug]) {
        return {
            slug: normalizedSlug,
            ...exports.PATHAO_STATUS_MAP[normalizedSlug],
        };
    }
    // Safe humanizing fallback for unmapped slugs
    const humanized = normalizedSlug
        .split('_')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
    return {
        slug: normalizedSlug,
        labelEn: humanized || 'Unknown',
        labelBn: humanized || 'অজানা অবস্থা',
        isFinal: false,
        progressStep: 'Sent to courier',
        color: 'slate',
    };
}
// ==================== ZOD DEFENSIVE PARSING SCHEMAS ====================
const RawCityItemSchema = zod_1.z.object({
    city_id: zod_1.z.number(),
    city_name: zod_1.z.string(),
});
const RawZoneItemSchema = zod_1.z.object({
    zone_id: zod_1.z.number(),
    zone_name: zod_1.z.string(),
});
const RawAreaItemSchema = zod_1.z.object({
    area_id: zod_1.z.number(),
    area_name: zod_1.z.string(),
    home_delivery_available: zod_1.z.boolean().optional().default(true),
    pickup_available: zod_1.z.boolean().optional().default(true),
});
const RawOrderInfoSchema = zod_1.z.object({
    consignment_id: zod_1.z.string(),
    merchant_order_id: zod_1.z.string().optional().nullable(),
    order_status: zod_1.z.string().optional().default('Unknown'),
    order_status_slug: zod_1.z.string().optional().default('unknown'),
    updated_at: zod_1.z.string().optional(),
    invoice_id: zod_1.z.string().optional().nullable(),
    delivery_fee: zod_1.z.number().optional(),
    amount_to_collect: zod_1.z.number().optional(),
    collected_amount: zod_1.z.number().optional(),
});
const LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ORDER_INFO_CACHE_TTL_MS = 45 * 1000; // 45 seconds
const REQUEST_TIMEOUT_MS = 15000; // 15 seconds
class PathaoService {
    static tokenData = null;
    static tokenLockPromise = null;
    // In-memory 24h location caches
    static locationCache = new Map();
    static locationLocks = new Map();
    // In-memory 45s order info caches
    static orderInfoCache = new Map();
    static orderInfoLocks = new Map();
    /**
     * Resets all in-memory caches and locks (useful for test isolation)
     */
    static clearCache() {
        this.tokenData = null;
        this.tokenLockPromise = null;
        this.locationCache.clear();
        this.locationLocks.clear();
        this.orderInfoCache.clear();
        this.orderInfoLocks.clear();
    }
    /**
     * Masks secrets from any error message or string
     */
    static sanitizeError(err) {
        if (!err)
            return 'Unknown Pathao error';
        let message = typeof err === 'string' ? err : err.message || JSON.stringify(err);
        const sensitiveValues = [
            env_1.env.PATHAO_CLIENT_SECRET,
            env_1.env.PATHAO_PASSWORD,
            this.tokenData?.accessToken,
            this.tokenData?.refreshToken,
        ].filter(Boolean);
        for (const val of sensitiveValues) {
            if (val && val.length > 3) {
                message = message.split(val).join('***MASKED***');
            }
        }
        return message;
    }
    /**
     * Issues or refreshes an access token with single in-flight lock
     */
    static async getAccessToken() {
        const now = Date.now();
        // 1. Check existing token validity (buffer by 60s)
        if (this.tokenData && this.tokenData.expiresAt > now + 60 * 1000) {
            return this.tokenData.accessToken;
        }
        // 2. Concurrency lock: If a token request is already in-flight, await it
        if (this.tokenLockPromise) {
            return this.tokenLockPromise;
        }
        // 3. Initiate single token request
        this.tokenLockPromise = (async () => {
            try {
                const baseUrl = env_1.env.PATHAO_BASE_URL.replace(/\/+$/, '');
                const issueUrl = `${baseUrl}/aladdin/api/v1/issue-token`;
                // If refresh token is available, attempt refresh first
                if (this.tokenData?.refreshToken) {
                    try {
                        const refreshRes = await this.executeHttp(issueUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json; charset=UTF-8',
                                Accept: 'application/json',
                            },
                            body: JSON.stringify({
                                client_id: env_1.env.PATHAO_CLIENT_ID,
                                client_secret: env_1.env.PATHAO_CLIENT_SECRET,
                                refresh_token: this.tokenData.refreshToken,
                                grant_type: 'refresh_token',
                            }),
                        }, false);
                        if (refreshRes.ok) {
                            const data = (await refreshRes.json());
                            if (data.access_token) {
                                this.tokenData = {
                                    accessToken: data.access_token,
                                    refreshToken: data.refresh_token || this.tokenData.refreshToken,
                                    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
                                };
                                return this.tokenData.accessToken;
                            }
                        }
                    }
                    catch {
                        // Refresh failed, proceed to full password grant
                    }
                }
                // Full password grant
                if (!env_1.env.PATHAO_CLIENT_ID || !env_1.env.PATHAO_CLIENT_SECRET || !env_1.env.PATHAO_USERNAME || !env_1.env.PATHAO_PASSWORD) {
                    throw new Error('Pathao credentials are not configured in environment variables');
                }
                const res = await this.executeHttp(issueUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=UTF-8',
                        Accept: 'application/json',
                    },
                    body: JSON.stringify({
                        client_id: env_1.env.PATHAO_CLIENT_ID,
                        client_secret: env_1.env.PATHAO_CLIENT_SECRET,
                        username: env_1.env.PATHAO_USERNAME,
                        password: env_1.env.PATHAO_PASSWORD,
                        grant_type: 'password',
                    }),
                }, false);
                if (!res.ok) {
                    const errBody = await res.text();
                    throw new Error(`Pathao authentication failed (Status ${res.status}): ${this.sanitizeError(errBody)}`);
                }
                const data = (await res.json());
                if (!data.access_token) {
                    throw new Error('Pathao did not return an access token');
                }
                this.tokenData = {
                    accessToken: data.access_token,
                    refreshToken: data.refresh_token,
                    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
                };
                return this.tokenData.accessToken;
            }
            finally {
                this.tokenLockPromise = null;
            }
        })();
        return this.tokenLockPromise;
    }
    /**
     * Low-level fetch with timeout
     */
    static async executeHttp(url, options, attachAuth = true) {
        const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json; charset=UTF-8',
            ...(options.headers || {}),
        };
        if (attachAuth) {
            const token = await this.getAccessToken();
            headers['Authorization'] = `Bearer ${token}`;
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal,
            });
            return response;
        }
        catch (err) {
            if (err.name === 'AbortError') {
                throw new Error(`Pathao request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
            }
            throw new Error(`Pathao network error: ${this.sanitizeError(err)}`);
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    /**
     * Helper to perform idempotent GET with 1 retry
     */
    static async getWithRetry(url) {
        let lastError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const res = await this.executeHttp(url, { method: 'GET' });
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`Pathao API returned status ${res.status}: ${this.sanitizeError(text)}`);
                }
                return await res.json();
            }
            catch (err) {
                lastError = err;
                if (attempt === 2)
                    break;
            }
        }
        throw lastError;
    }
    /**
     * Extracts array from Pathao nested response envelope:
     * Handles response.data.data.data, response.data.data, and response.data
     */
    static extractEnvelopeArray(json) {
        if (!json || typeof json !== 'object')
            return [];
        if (Array.isArray(json.data?.data?.data))
            return json.data.data.data;
        if (Array.isArray(json.data?.data))
            return json.data.data;
        if (Array.isArray(json.data))
            return json.data;
        if (Array.isArray(json))
            return json;
        return [];
    }
    /**
     * Generic location fetcher with:
     * 1. 24h in-memory cache
     * 2. Single in-flight request coalescing per cacheKey
     * 3. Defensive Zod envelope validation
     * 4. Serving stale cache if Pathao temporarily fails
     */
    static async fetchLocationWithCache(cacheKey, fetchFn) {
        const now = Date.now();
        const cached = this.locationCache.get(cacheKey);
        // If cache is fresh (< 24h), return immediately
        if (cached && now - cached.timestamp < LOCATION_CACHE_TTL_MS) {
            return cached.data;
        }
        // If a request for this key is already in flight, await it
        if (this.locationLocks.has(cacheKey)) {
            return this.locationLocks.get(cacheKey);
        }
        const requestPromise = (async () => {
            try {
                const freshData = await fetchFn();
                this.locationCache.set(cacheKey, { data: freshData, timestamp: Date.now() });
                return freshData;
            }
            catch (err) {
                // SERVE STALE CACHE if available on failure
                if (cached && cached.data) {
                    return cached.data;
                }
                throw new Error(`Pathao location lookup failed: ${this.sanitizeError(err.message)}`);
            }
            finally {
                this.locationLocks.delete(cacheKey);
            }
        })();
        this.locationLocks.set(cacheKey, requestPromise);
        return requestPromise;
    }
    /**
     * Get stores list
     */
    static async getStores() {
        const baseUrl = env_1.env.PATHAO_BASE_URL.replace(/\/+$/, '');
        const json = await this.getWithRetry(`${baseUrl}/aladdin/api/v1/stores`);
        const rawData = this.extractEnvelopeArray(json);
        return Array.isArray(rawData) ? rawData : [];
    }
    /**
     * Get cities list:
     * - Endpoint: /aladdin/api/v1/city-list
     * - Defensively parsed with Zod
     * - Normalized to { id, name }
     * - Trimmed names and sorted alphabetically
     * - 24-hour cache with stale fallback
     */
    static async getCities() {
        return this.fetchLocationWithCache('cities', async () => {
            const baseUrl = env_1.env.PATHAO_BASE_URL.replace(/\/+$/, '');
            const json = await this.getWithRetry(`${baseUrl}/aladdin/api/v1/city-list`);
            const rawList = this.extractEnvelopeArray(json);
            if (!Array.isArray(rawList)) {
                throw new Error('Invalid city response structure from Pathao');
            }
            const parsedItems = zod_1.z.array(RawCityItemSchema).safeParse(rawList);
            if (!parsedItems.success) {
                throw new Error('City list failed defensive validation');
            }
            return parsedItems.data
                .map((c) => ({
                id: c.city_id,
                name: c.city_name.trim(),
            }))
                .sort((a, b) => a.name.localeCompare(b.name));
        });
    }
    /**
     * Get zones inside a city:
     * - Endpoint: /aladdin/api/v1/cities/{city_id}/zone-list
     * - Defensively parsed with Zod
     * - Normalized to { id, name }
     * - Trimmed names and sorted alphabetically
     * - 24-hour cache with stale fallback
     */
    static async getZones(cityId) {
        return this.fetchLocationWithCache(`zones:${cityId}`, async () => {
            const baseUrl = env_1.env.PATHAO_BASE_URL.replace(/\/+$/, '');
            const json = await this.getWithRetry(`${baseUrl}/aladdin/api/v1/cities/${cityId}/zone-list`);
            const rawList = this.extractEnvelopeArray(json);
            if (!Array.isArray(rawList)) {
                throw new Error(`Invalid zone response structure for city ${cityId}`);
            }
            const parsedItems = zod_1.z.array(RawZoneItemSchema).safeParse(rawList);
            if (!parsedItems.success) {
                throw new Error(`Zone list for city ${cityId} failed defensive validation`);
            }
            return parsedItems.data
                .map((zItem) => ({
                id: zItem.zone_id,
                name: zItem.zone_name.trim(),
            }))
                .sort((a, b) => a.name.localeCompare(b.name));
        });
    }
    /**
     * Get areas inside a zone:
     * - Endpoint: /aladdin/api/v1/zones/{zone_id}/area-list
     * - Defensively parsed with Zod
     * - Normalized to { id, name, homeDeliveryAvailable, pickupAvailable }
     * - Trimmed names and sorted alphabetically
     * - 24-hour cache with stale fallback
     */
    static async getAreas(zoneId) {
        return this.fetchLocationWithCache(`areas:${zoneId}`, async () => {
            const baseUrl = env_1.env.PATHAO_BASE_URL.replace(/\/+$/, '');
            const json = await this.getWithRetry(`${baseUrl}/aladdin/api/v1/zones/${zoneId}/area-list`);
            const rawList = this.extractEnvelopeArray(json);
            if (!Array.isArray(rawList)) {
                throw new Error(`Invalid area response structure for zone ${zoneId}`);
            }
            const parsedItems = zod_1.z.array(RawAreaItemSchema).safeParse(rawList);
            if (!parsedItems.success) {
                throw new Error(`Area list for zone ${zoneId} failed defensive validation`);
            }
            return parsedItems.data
                .map((aItem) => ({
                id: aItem.area_id,
                name: aItem.area_name.trim(),
                homeDeliveryAvailable: Boolean(aItem.home_delivery_available),
                pickupAvailable: Boolean(aItem.pickup_available),
            }))
                .sort((a, b) => a.name.localeCompare(b.name));
        });
    }
    /**
     * Price calculation preview
     */
    static async calculatePrice(payload) {
        const baseUrl = env_1.env.PATHAO_BASE_URL.replace(/\/+$/, '');
        const res = await this.executeHttp(`${baseUrl}/aladdin/api/v1/merchant/price-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Price calculation failed: ${this.sanitizeError(text)}`);
        }
        const json = (await res.json());
        const price = json?.data?.price || json?.price || 0;
        return {
            price: Math.round(Number(price)),
            planId: json?.data?.plan_id,
        };
    }
    /**
     * Create an order in Pathao.
     * NEVER auto-retried to prevent duplicate dispatches.
     */
    static async createOrder(payload) {
        const baseUrl = env_1.env.PATHAO_BASE_URL.replace(/\/+$/, '');
        const formattedPayload = {
            store_id: Number(payload.store_id),
            recipient_name: payload.recipient_name.trim(),
            recipient_phone: payload.recipient_phone.trim(),
            recipient_address: payload.recipient_address.trim(),
            delivery_type: Number(payload.delivery_type || 48),
            item_type: Number(payload.item_type || 2),
            item_quantity: Number(payload.item_quantity || 1),
            item_weight: typeof payload.item_weight === 'number' ? payload.item_weight.toFixed(1) : String(payload.item_weight),
            amount_to_collect: Math.max(0, Math.round(Number(payload.amount_to_collect || 0))),
        };
        if (payload.merchant_order_id)
            formattedPayload.merchant_order_id = payload.merchant_order_id;
        if (payload.recipient_secondary_phone)
            formattedPayload.recipient_secondary_phone = payload.recipient_secondary_phone;
        if (payload.special_instruction)
            formattedPayload.special_instruction = payload.special_instruction;
        if (payload.item_description)
            formattedPayload.item_description = payload.item_description;
        if (payload.recipient_city !== undefined && payload.recipient_city !== null && !isNaN(Number(payload.recipient_city))) {
            formattedPayload.recipient_city = Number(payload.recipient_city);
        }
        if (payload.recipient_zone !== undefined && payload.recipient_zone !== null && !isNaN(Number(payload.recipient_zone))) {
            formattedPayload.recipient_zone = Number(payload.recipient_zone);
        }
        if (payload.recipient_area !== undefined && payload.recipient_area !== null && !isNaN(Number(payload.recipient_area))) {
            formattedPayload.recipient_area = Number(payload.recipient_area);
        }
        const res = await this.executeHttp(`${baseUrl}/aladdin/api/v1/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify(formattedPayload),
        });
        if (!res.ok) {
            const errText = await res.text();
            let parsedErr = null;
            try {
                parsedErr = JSON.parse(errText);
            }
            catch { }
            let detailedMsg = '';
            if (parsedErr?.errors && typeof parsedErr.errors === 'object') {
                const errorEntries = Object.entries(parsedErr.errors)
                    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                    .join('; ');
                detailedMsg = ` (${errorEntries})`;
            }
            else if (parsedErr?.message) {
                detailedMsg = ` (${parsedErr.message})`;
            }
            throw new Error(`Pathao rejected order (Status ${res.status}): ${this.sanitizeError(detailedMsg || errText)}`);
        }
        const json = (await res.json());
        const data = json?.data || {};
        if (!data.consignment_id) {
            throw new Error('Pathao response missing consignment_id');
        }
        return {
            consignment_id: String(data.consignment_id),
            merchant_order_id: data.merchant_order_id,
            order_status: data.order_status || 'Pending',
            delivery_fee: Math.round(Number(data.delivery_fee || 0)),
        };
    }
    /**
     * Get short info / tracking for an existing consignment:
     * - Endpoint: /aladdin/api/v1/orders/{consignment_id}/info
     * - Defensively parsed with Zod
     * - Cached for 45 seconds per consignment
     * - Single in-flight request lock per consignment
     * - forceRefresh option bypasses cache (e.g. for manual refresh)
     */
    static async getOrderInfo(consignmentId, forceRefresh = false) {
        const cleanId = consignmentId.trim();
        const now = Date.now();
        const cached = this.orderInfoCache.get(cleanId);
        // Return cached if fresh and not forced
        if (!forceRefresh && cached && now - cached.timestamp < ORDER_INFO_CACHE_TTL_MS) {
            return cached.data;
        }
        // Single in-flight request lock per consignment
        if (this.orderInfoLocks.has(cleanId)) {
            return this.orderInfoLocks.get(cleanId);
        }
        const fetchPromise = (async () => {
            try {
                const baseUrl = env_1.env.PATHAO_BASE_URL.replace(/\/+$/, '');
                const json = await this.getWithRetry(`${baseUrl}/aladdin/api/v1/orders/${encodeURIComponent(cleanId)}/info`);
                const rawData = json?.data || json || {};
                const parsed = RawOrderInfoSchema.safeParse(rawData);
                if (!parsed.success) {
                    throw new Error('Order info response failed defensive validation');
                }
                const info = parsed.data;
                const normalizedData = {
                    consignment_id: String(info.consignment_id || cleanId),
                    merchant_order_id: info.merchant_order_id,
                    order_status: info.order_status,
                    order_status_slug: (info.order_status_slug || info.order_status || 'unknown')
                        .toLowerCase()
                        .trim()
                        .replace(/[\s-]+/g, '_'),
                    updated_at: info.updated_at,
                    invoice_id: info.invoice_id,
                    delivery_fee: info.delivery_fee !== undefined ? Math.round(Number(info.delivery_fee)) : undefined,
                    amount_to_collect: info.amount_to_collect !== undefined ? Math.round(Number(info.amount_to_collect)) : undefined,
                    collected_amount: info.collected_amount !== undefined ? Math.round(Number(info.collected_amount)) : undefined,
                };
                this.orderInfoCache.set(cleanId, { data: normalizedData, timestamp: Date.now() });
                return normalizedData;
            }
            finally {
                this.orderInfoLocks.delete(cleanId);
            }
        })();
        this.orderInfoLocks.set(cleanId, fetchPromise);
        return fetchPromise;
    }
    /**
     * Test Pathao connection and configuration status
     */
    static async checkConnection() {
        try {
            const stores = await this.getStores();
            let defaultStore = undefined;
            if (env_1.env.PATHAO_STORE_ID) {
                defaultStore = stores.find((s) => String(s.store_id) === String(env_1.env.PATHAO_STORE_ID));
            }
            if (!defaultStore && stores.length > 0) {
                defaultStore = stores[0];
            }
            return {
                connected: true,
                storesCount: stores.length,
                defaultStore,
                message: 'Pathao API connection verified successfully.',
            };
        }
        catch (err) {
            return {
                connected: false,
                storesCount: 0,
                message: this.sanitizeError(err.message),
            };
        }
    }
}
exports.PathaoService = PathaoService;
