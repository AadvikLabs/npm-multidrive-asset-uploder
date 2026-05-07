require('dotenv').config();
// Helper to get mime type from extension
function getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'pdf': 'application/pdf',
        'txt': 'text/plain',
        'html': 'text/html',
        'json': 'application/json',
        'mp4': 'video/mp4',
        'mp3': 'audio/mpeg'
    };
    return map[ext] || 'application/octet-stream';
}

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Helper to update specific secrets in .env
function updateEnvSecret(key, newValue) {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;

    let content = fs.readFileSync(envPath, 'utf8');
    const regex = new RegExp(`^${key}=.*$`, 'm');

    if (regex.test(content)) {
        content = content.replace(regex, `${key}=${newValue}`);
    } else {
        content += `\n${key}=${newValue}`;
    }

    fs.writeFileSync(envPath, content);
    console.log(`[system] Updated ${key} in .env`);
    // update process.env for current session
    process.env[key] = newValue;
}
const cors = require('cors');
const app = express();

let MultiDriveUploader;
try {
    MultiDriveUploader = require('multi-drive-uploader').MultiDriveUploader;
} catch (e) {
    console.warn('multi-drive-uploader package not found. Using Mock version for testing.');
    MultiDriveUploader = class MockUploader {
        constructor(config) {
            this.config = config;
        }
        async uploadFile(input, options = {}) {
            console.log(`[MOCK] Uploading file to ${this.config.provider}...`);
            await new Promise(resolve => setTimeout(resolve, 1500));
            return {
                success: true,
                provider: this.config.provider,
                fileId: 'mock-' + Math.random().toString(36).substr(2, 9),
                filename: options.filename || 'unknown-file',
                size: 1024 * 1024,
                mimeType: 'application/octet-stream',
                permalink: 'https://example.com/view/' + Math.random().toString(36).substr(2, 9),
                downloadUrl: 'https://example.com/download/' + Math.random().toString(36).substr(2, 9),
                metadata: { mock: true }
            };
        }
        static getSupportedProviders() {
            return ['google-drive', 'onedrive', 'zoho', 'box', 's3'];
        }
    };
}
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const axios = require('axios');
const { ZOHO_DATA_CENTERS } = require('multi-drive-uploader');

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const provider = req.body.provider || 's3';
    const folderId = req.body.folderId;

    try {
        const credentials = getCredentialsForProvider(provider);
        const uploader = new MultiDriveUploader({
            provider,
            credentials
        });

        let result;
        try {
            result = await uploader.uploadFile(req.file.buffer, {
                filename: req.file.originalname,
                folderId: folderId,
                contentType: getMimeType(req.file.originalname)
            });
        } catch (uploadError) {
            // Handle Conflicts (File exists)
            const statusCode = uploadError.statusCode || uploadError.status || uploadError.response?.status;
            const errorDetails = uploadError.details || {};

            if (provider === 'box' && statusCode === 409) {
                console.log('[box] Conflict detected, attempting to upload new version...');
                const existingFileId = errorDetails.context_info?.conflicts?.[0]?.id ||
                    errorDetails.context_info?.conflicts?.id ||
                    (errorDetails.message?.match(/ID "(\d+)"/)?.[1]);

                if (existingFileId) {
                    const accessToken = await uploader.provider._tokenManager.getAccessToken();
                    const FormDataNode = require('form-data');
                    const form = new FormDataNode();
                    form.append('file', req.file.buffer, { filename: req.file.originalname });

                    const versionRes = await axios.post(
                        `https://upload.box.com/api/2.0/files/${existingFileId}/content`,
                        form,
                        {
                            headers: {
                                ...form.getHeaders(),
                                'Authorization': `Bearer ${accessToken}`
                            }
                        }
                    );
                    result = uploader.provider._normalizeResponse(versionRes.data);
                } else {
                    throw uploadError;
                }
            } else if (provider === 'zoho' && statusCode === 409) {
                console.log('[zoho] Conflict detected: File already exists with this name.');
                throw new Error(`A file named "${req.file.originalname}" already exists in this Zoho folder. Please rename it or delete the existing one.`);
            } else {
                throw uploadError;
            }
        }

        // FIX: Library normalization bugs for Zoho (Ensures fileId and permalink are extracted)
        if (provider === 'zoho' && (!result.fileId || !result.permalink)) {
            const zohoMeta = result.metadata?.data?.[0] || {};
            const attrs = zohoMeta.attributes || {};
            result.fileId = result.fileId || attrs.resource_id || zohoMeta.id;
            result.permalink = result.permalink || attrs.Permalink || attrs.permalink;
            result.filename = result.filename || attrs.FileName || attrs.name;
            console.log(`[zoho] Manually patched missing metadata: ID=${result.fileId}, Link=${result.permalink}`);
        }

        // AUTOMATICALLY MAKE FILES PUBLIC AND SYNC TOKENS
        try {
            const protocol = req.protocol;
            const host = req.get('host');
            const baseUrl = process.env.APP_URL || `${protocol}://${host}`;

            if (provider === 'google-drive') {
                const tokenParams = new URLSearchParams({
                    client_id: process.env.GOOGLE_CLIENT_ID,
                    client_secret: process.env.GOOGLE_CLIENT_SECRET,
                    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
                    grant_type: 'refresh_token'
                });
                const tokenRes = await axios.post('https://oauth2.googleapis.com/token', tokenParams.toString());
                const token = tokenRes.data.access_token;

                await axios.post(`https://www.googleapis.com/drive/v3/files/${result.fileId}/permissions`, {
                    role: 'reader',
                    type: 'anyone'
                }, { headers: { Authorization: `Bearer ${token}` } });

                result.viewUrl = `https://drive.google.com/file/d/${result.fileId}/view`;
                result.downloadUrl = `https://drive.google.com/uc?export=download&id=${result.fileId}`;
                console.log(`[google-drive] File ${result.fileId} is now PUBLIC.`);
            } else if (provider === 'onedrive') {
                const tokenParams = new URLSearchParams({
                    client_id: process.env.MS_CLIENT_ID,
                    client_secret: process.env.MS_CLIENT_SECRET,
                    refresh_token: process.env.MS_REFRESH_TOKEN,
                    grant_type: 'refresh_token'
                });
                const tokenRes = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', tokenParams.toString());
                const token = tokenRes.data.access_token;

                const shareRes = await axios.post(`https://graph.microsoft.com/v1.0/me/drive/items/${result.fileId}/createLink`, {
                    type: 'view',
                    scope: 'anonymous'
                }, { headers: { Authorization: `Bearer ${token}` } });

                result.viewUrl = shareRes.data.link.webUrl;
                result.downloadUrl = result.downloadUrl || result.permalink;
                console.log(`[onedrive] Native public link generated.`);
            } else if (provider === 'box') {
                const tokenParams = new URLSearchParams({
                    client_id: process.env.BOX_CLIENT_ID,
                    client_secret: process.env.BOX_CLIENT_SECRET,
                    refresh_token: process.env.BOX_REFRESH_TOKEN,
                    grant_type: 'refresh_token'
                });
                const tokenRes = await axios.post('https://api.box.com/oauth2/token', tokenParams.toString());
                const token = tokenRes.data.access_token;

                // Box refresh tokens rotate! Save the new one immediately
                if (tokenRes.data.refresh_token) {
                    updateEnvSecret('BOX_REFRESH_TOKEN', tokenRes.data.refresh_token);
                }

                const shareRes = await axios.put(`https://api.box.com/2.0/files/${result.fileId}`, {
                    shared_link: { access: 'open' }
                }, { headers: { Authorization: `Bearer ${token}` } });

                // Return the public Shared Link (Bypasses login)
                result.viewUrl = shareRes.data.shared_link.url;
                result.downloadUrl = `${baseUrl}/api/file/box/${result.fileId}?mode=attachment`;
                console.log(`[box] Public URLs generated: View: ${result.viewUrl}, Download: ${result.downloadUrl}`);
            } else if (provider === 's3') {
                const region = process.env.AWS_REGION || 'us-east-1';
                const bucket = process.env.AWS_BUCKET;
                const key = result.metadata.key || result.fileId;
                const encodedKey = key.split('/').map(part => encodeURIComponent(part)).join('/');

                result.viewUrl = `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
                result.downloadUrl = `${baseUrl}/api/file/s3/${encodeURIComponent(key)}?mode=attachment`;

                console.log(`[s3] Public URLs generated: View: ${result.viewUrl}, Download: ${result.downloadUrl}`);
            } else if (provider === 'zoho') {
                // 1. Get a fresh access token for sharing
                const dc = process.env.ZOHO_DATA_CENTER || (process.env.ZOHO_ACCOUNTS_URL?.includes('.in') ? 'IN' : 'US');
                const apiDomain = dc.toUpperCase() === 'IN' ? 'www.zohoapis.in' : 'www.zohoapis.com';
                const accountsDomain = dc.toUpperCase() === 'IN' ? 'accounts.zoho.in' : 'accounts.zoho.com';

                const tokenParams = new URLSearchParams({
                    client_id: process.env.ZOHO_CLIENT_ID,
                    client_secret: process.env.ZOHO_CLIENT_SECRET,
                    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                    grant_type: 'refresh_token'
                });
                const tokenRes = await axios.post(`https://${accountsDomain}/oauth/v2/token`, tokenParams.toString());
                const accessToken = tokenRes.data.access_token;

                // 2. 2-second delay to ensure Zoho processing is complete (avoids F6003 Invalid Param)
                console.log(`[zoho] Waiting 2s for file processing...`);
                await new Promise(r => setTimeout(r, 2000));

                // 3. Create the External Share Link
                const meta = result.metadata?.data?.[0]?.attributes || {};
                const fileInfoStr = meta["File INFO"] || "{}";
                let fileInfo = {};
                try { fileInfo = JSON.parse(fileInfoStr); } catch (e) { }

                const libraryId = fileInfo.LIBRARY_ID || meta.library_id || meta.LIBRARY_ID;
                console.log(`[zoho] Workspace context detected: ${libraryId || 'default'}`);

                const sharePayload = {
                    data: {
                        type: "links",
                        attributes: {
                            resource_id: result.fileId,
                            link_type: 1,          // 1 = Public link
                            access_type: 1,        // 1 = View & Download
                            link_name: "Public Link",
                            allow_download: true
                        }
                    }
                };

                const shareHeaders = {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Accept': 'application/vnd.api+json',
                    'Content-Type': 'application/json'
                };
                if (libraryId) shareHeaders['x-zoho-workspace-id'] = libraryId;

                const shareRes = await axios.post(`https://${apiDomain}/workdrive/api/v1/links`, sharePayload, {
                    headers: shareHeaders
                });

                const linkData = shareRes.data.data.attributes;
                result.viewUrl = linkData.link || linkData.permalink || linkData.url;
                result.downloadUrl = linkData.download_url || result.viewUrl;

                console.log(`[zoho] SUCCESS: Created native Public Share Link: ${result.viewUrl}`);
            }
        } catch (pubErr) {
            console.warn(`[system] Permission update failed for ${provider}. Falling back to Permalink.`);

            // If sharing fails, return the Permalinks so the user doesn't see localhost
            if (provider === 'zoho') {
                const zohoMeta = result.metadata?.data?.[0] || {};
                const attrs = zohoMeta.attributes || {};
                const fallbackLink = result.permalink || attrs.Permalink || attrs.permalink;
                result.viewUrl = fallbackLink;
                result.downloadUrl = fallbackLink;
            }

            // Safe logging to avoid circular structure crash
            if (pubErr.response?.data) {
                const isStream = pubErr.config?.responseType === 'stream';
                console.warn(`[zoho] API Status: ${pubErr.response.status}`);
                if (!isStream) {
                    try {
                        const errBody = pubErr.response.data;
                        console.warn(`[zoho] API Error Body: ${JSON.stringify(errBody)}`);
                        if (errBody.errors?.[0]?.id === 'R008') {
                            console.warn("💡 TIP: 'R008 Unauthorized' means you must regenerate your token with the 'WorkDrive.files.sharing.CREATE' scope.");
                        }
                    } catch (e) {
                        console.warn(`[zoho] (Body not stringifiable)`);
                    }
                }
            } else {
                console.warn(`Details: ${pubErr.message}`);
            }
        }

        // 3. Final Logging (Remove giant metadata to avoid circular reference crashes)
        const printableResult = { ...result };
        delete printableResult.metadata;
        console.log(`[${provider}] Upload Result:`, JSON.stringify(printableResult, null, 2));

        // Return URLs: Prioritize the new public URLs we just generated
        if (!result.viewUrl) {
            const protocol = req.protocol;
            const host = req.get('host');
            const baseUrl = process.env.APP_URL || `${protocol}://${host}`;
            const idForProxy = result.provider === 's3' ? result.metadata.key : result.fileId;

            if (idForProxy) {
                result.viewUrl = `${baseUrl}/api/file/${provider}/${encodeURIComponent(idForProxy)}?mode=inline`;
                result.downloadUrl = `${baseUrl}/api/file/${provider}/${encodeURIComponent(idForProxy)}?mode=attachment`;
            } else {
                result.viewUrl = result.permalink;
                result.downloadUrl = result.downloadUrl || result.permalink;
            }
        }

        // Keep native links in metadata for debugging
        result.metadata.publicViewUrl = result.viewUrl;

        res.json(result);
    } catch (error) {
        const isScopeError = error.details?.errors?.some(e => e.id === 'F7007' || e.title?.includes('scope'));

        res.status(500).json({
            success: false,
            error: isScopeError ? 'Zoho scope error detected (F7007)' : (error.message || 'Internal Server Error'),
            message: isScopeError ? 'Your token is missing mandatory WorkDrive scopes.' : error.message,
            requiredScopes: isScopeError ? 'WorkDrive.files.ALL WorkDrive.workspace.ALL WorkDrive.team.ALL' : null,
            details: error.details || null
        });
    }
});

/**
 * Proxy endpoint to view/download files
 * This is necessary because Zoho requires an Authorization header which <a> tags cannot provide.
 */
app.get('/api/file/:provider/:fileId', async (req, res) => {
    const { provider, fileId } = req.params;
    const mode = req.query.mode === 'attachment' ? 'attachment' : 'inline';

    try {
        if (provider === 'zoho') {
            const dc = (process.env.ZOHO_DATA_CENTER || (process.env.ZOHO_ACCOUNTS_URL?.includes('.in') ? 'IN' : 'US')).toUpperCase();
            const urls = ZOHO_DATA_CENTERS[dc] || ZOHO_DATA_CENTERS.US;

            // Get a fresh token
            const tokenParams = new URLSearchParams({
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                grant_type: 'refresh_token'
            });

            const tokenRes = await axios.post(`${urls.accountsUrl}/oauth/v2/token`, tokenParams.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const accessToken = tokenRes.data.access_token;

            if (!accessToken) throw new Error('Failed to refresh Zoho token');

            // Save new refresh token if Zoho provides one (Rotation)
            if (tokenRes.data.refresh_token) {
                updateEnvSecret('ZOHO_REFRESH_TOKEN', tokenRes.data.refresh_token);
            }

            let filename = 'file';
            // Debug: Check metadata first to verify token/scope
            try {
                const metadataUrl = `${urls.apiBaseUrl}/workdrive/api/v1/files/${fileId}`;
                console.log(`[zoho] Fetching metadata from: ${metadataUrl}`);
                const metaRes = await axios.get(metadataUrl, {
                    headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
                });
                const fileData = metaRes.data.data?.[0] || metaRes.data.data || {};
                const attrs = fileData.attributes || {};
                filename = attrs.FileName || attrs.name || fileData.name || 'document';
                const libraryId = attrs.library_id || attrs.LIBRARY_ID; // Extract workspace context
                console.log(`[zoho] Filename: ${filename}, Workspace: ${libraryId || 'none'}`);
            } catch (metaErr) {
                console.warn('[zoho] Metadata fetch failed (common for Team Folders), proceeding with default naming.');
            }

            // Ultimate Strategy for India DC: Standard Download API + Browser Spoofing
            async function tryStream() {
                // Re-fetch Library ID if it was resolved in metadata
                let libraryIdInProxy = null;
                try {
                    const metadataUrl = `${urls.apiBaseUrl}/workdrive/api/v1/files/${fileId}`;
                    const mRes = await axios.get(metadataUrl, { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } });
                    const fData = mRes.data.data?.[0] || mRes.data.data || {};
                    libraryIdInProxy = fData.attributes?.library_id || fData.attributes?.LIBRARY_ID;
                } catch (e) { }

                const browserHeaders = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Authorization': `Zoho-oauthtoken ${accessToken}`
                };

                if (libraryIdInProxy) {
                    browserHeaders['x-zoho-workspace-id'] = libraryIdInProxy;
                }

                try {
                    // Pattern 1: Standard File Download API (Most reliable for India)
                    console.log(`[zoho] Pattern 1: Standard Download API...`);
                    return await axios.get(`${urls.apiBaseUrl}/workdrive/api/v1/files/${fileId}/download`, {
                        headers: browserHeaders,
                        responseType: 'stream'
                    });
                } catch (e1) {
                    console.warn(`[zoho] Pattern 1 failed (${e1.response?.status})`);

                    try {
                        // Pattern 2: Standard File Download API with Bearer fallback
                        console.log(`[zoho] Pattern 2: Standard Download (Bearer)...`);
                        const bearerHeaders = { ...browserHeaders, 'Authorization': `Bearer ${accessToken}` };
                        return await axios.get(`${urls.apiBaseUrl}/workdrive/api/v1/files/${fileId}/download`, {
                            headers: bearerHeaders,
                            responseType: 'stream'
                        });
                    } catch (e2) {
                        console.warn(`[zoho] Pattern 2 failed (${e2.response?.status})`);

                        // Pattern 3: Dedicated Download Cluster (External)
                        const downloadDomain = urls.apiBaseUrl.replace('www.zohoapis', 'download.zoho');
                        console.log(`[zoho] Pattern 3: Dedicated Cluster (${downloadDomain})...`);
                        return await axios.get(`${downloadDomain}/v1/workdrive/download/${fileId}`, {
                            headers: browserHeaders,
                            params: { env: 'workdrive' },
                            responseType: 'stream'
                        });
                    }
                }
            }

            try {
                const fileRes = await tryStream();

                // Force type detection by extension
                const contentType = getMimeType(filename);
                res.setHeader('Content-Type', contentType);
                res.setHeader('Content-Disposition', mode === 'attachment' ? `attachment; filename="${filename}"` : 'inline');

                fileRes.data.pipe(res);

                fileRes.data.on('error', (err) => {
                    console.error('[zoho] Stream error:', err.message);
                    if (!res.headersSent) res.status(500).send('Stream error');
                });
            } catch (err) {
                console.error('[zoho] All download attempts failed.');
                const status = err.response?.status || 500;

                // CRITICAL: Avoid circular structure crash by checking responseType
                const isStream = err.config?.responseType === 'stream';
                const errorData = isStream ? { message: "Error data is a stream (cannot stringify body)" } : (err.response?.data || { message: err.message });

                console.error('Status:', status);
                if (!isStream) console.error('Zoho Error Body:', JSON.stringify(errorData));

                if (!res.headersSent) {
                    res.status(status).json({
                        success: false,
                        error: 'Zoho proxy failed',
                        message: errorData.message || 'Access Denied',
                        code: errorData.errors?.[0]?.title || 'UNKNOWN'
                    });
                }
            }
        } else if (provider === 'google-drive') {
            // Refresh Google Drive token
            const tokenParams = new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
                grant_type: 'refresh_token'
            });

            const tokenRes = await axios.post('https://oauth2.googleapis.com/token', tokenParams.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const accessToken = tokenRes.data.access_token;
            if (!accessToken) throw new Error('Failed to refresh Google Drive token');

            let filename = 'file';
            try {
                const metaRes = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                filename = metaRes.data.name || 'file';
                console.log(`[google-drive] Filename resolved: ${filename}`);
            } catch (metaErr) {
                console.error('[google-drive] Metadata fetch failed:', metaErr.response?.data || metaErr.message);
            }

            // Fetch the file stream from Google Drive
            const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
            console.log(`[google-drive] Proxying content from: ${downloadUrl}`);

            const fileRes = await axios.get(downloadUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                responseType: 'stream'
            });

            // Set headers
            let contentType = fileRes.headers['content-type'];
            if (!contentType || contentType === 'application/octet-stream') {
                contentType = getMimeType(filename);
            }
            const contentLength = fileRes.headers['content-length'];
            const contentDisposition = mode === 'attachment' ? `attachment; filename="${filename}"` : 'inline';

            res.setHeader('Content-Type', contentType);
            if (contentLength) res.setHeader('Content-Length', contentLength);
            res.setHeader('Content-Disposition', contentDisposition);

            fileRes.data.pipe(res);

            fileRes.data.on('error', (err) => {
                console.error('[google-drive] Stream error:', err.message);
                if (!res.headersSent) res.status(500).send('Stream error');
            });
        } else if (provider === 'onedrive') {
            // Refresh OneDrive token
            const tokenParams = new URLSearchParams({
                client_id: process.env.MS_CLIENT_ID,
                client_secret: process.env.MS_CLIENT_SECRET,
                refresh_token: process.env.MS_REFRESH_TOKEN,
                grant_type: 'refresh_token'
            });

            const tokenRes = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', tokenParams.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const accessToken = tokenRes.data.access_token;

            // Get file details to get the download URL
            const fileInfoRes = await axios.get(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            const downloadUrl = fileInfoRes.data['@microsoft.graph.downloadUrl'];
            const fileRes = await axios.get(downloadUrl, { responseType: 'stream' });

            res.setHeader('Content-Type', fileInfoRes.data.file?.mimeType || 'application/octet-stream');
            res.setHeader('Content-Disposition', mode === 'attachment' ? `attachment; filename="${fileInfoRes.data.name}"` : 'inline');

            fileRes.data.pipe(res);
        } else if (provider === 's3') {
            const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
            const s3Client = new S3Client({
                region: process.env.AWS_REGION || 'us-east-1',
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY,
                    secretAccessKey: process.env.AWS_SECRET_KEY
                }
            });

            const command = new GetObjectCommand({
                Bucket: process.env.AWS_BUCKET,
                Key: fileId
            });

            const s3Response = await s3Client.send(command);

            let contentType = s3Response.ContentType;
            const filename = fileId.split('/').pop() || 'file';
            if (!contentType || contentType === 'application/octet-stream') {
                contentType = getMimeType(filename);
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', mode === 'attachment' ? `attachment; filename="${filename}"` : 'inline');

            s3Response.Body.pipe(res);
        } else if (provider === 'box') {
            // Refresh Box token
            const tokenParams = new URLSearchParams({
                client_id: process.env.BOX_CLIENT_ID,
                client_secret: process.env.BOX_CLIENT_SECRET,
                refresh_token: process.env.BOX_REFRESH_TOKEN,
                grant_type: 'refresh_token'
            });

            const tokenRes = await axios.post('https://api.box.com/oauth2/token', tokenParams.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const accessToken = tokenRes.data.access_token;

            // Box refresh tokens are one-time use. Save the new one!
            if (tokenRes.data.refresh_token) {
                updateEnvSecret('BOX_REFRESH_TOKEN', tokenRes.data.refresh_token);
            }

            // Get metadata for filename
            const metaRes = await axios.get(`https://api.box.com/2.0/files/${fileId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const filename = metaRes.data.name || 'file';

            // Get the actual file content
            const fileRes = await axios.get(`https://api.box.com/2.0/files/${fileId}/content`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                responseType: 'stream'
            });

            // Box often returns generic types, so we force detection by extension for better "View" support
            const contentType = getMimeType(filename);

            res.setHeader('Content-Type', contentType);
            const contentDisposition = mode === 'attachment' ? `attachment; filename="${filename}"` : 'inline';
            res.setHeader('Content-Disposition', contentDisposition);

            fileRes.data.pipe(res);
        } else {
            res.status(400).send('Provider proxy not implemented or redundant catch-all reached');
        }
    } catch (error) {
        console.error('--- Proxy Error Details ---');
        console.error('Message:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        }
        console.error('---------------------------');

        let errorMessage = error.message;
        const errorData = error.response?.data ? JSON.parse(JSON.stringify(error.response.data)) : null;

        if (error.response && error.response.status === 401) {
            errorMessage = "Zoho Authentication Failed (401). Your Refresh Token is likely invalid or expired. Please run 'scripts/Zoho Token Generator.py' to get a new one.";
        } else if (error.response && error.response.status === 403) {
            errorMessage = "Zoho Permission Denied (403). Ensure your Refresh Token was created with ALL required scopes: WorkDrive.files.ALL, WorkDrive.folders.ALL, WorkDrive.workspace.ALL, WorkDrive.team.ALL, ZohoFiles.files.READ, WorkDrive.files.sharing.CREATE";
        }

        res.status(500).json({
            error: 'Zoho Proxy Error',
            message: errorMessage,
            status: error.response ? error.response.status : 500,
            details: errorData
        });
    }
});

function getCredentialsForProvider(provider) {
    switch (provider) {
        case 'google-drive':
            return {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
                folderId: process.env.GOOGLE_FOLDER_ID
            };
        case 'onedrive':
            return {
                clientId: process.env.MS_CLIENT_ID,
                clientSecret: process.env.MS_CLIENT_SECRET,
                refreshToken: process.env.MS_REFRESH_TOKEN
            };
        case 's3':
            return {
                accessKeyId: process.env.AWS_ACCESS_KEY,
                secretAccessKey: process.env.AWS_SECRET_KEY,
                bucket: process.env.AWS_BUCKET,
                region: process.env.AWS_REGION
            };
        case 'box':
            return {
                clientId: process.env.BOX_CLIENT_ID,
                clientSecret: process.env.BOX_CLIENT_SECRET,
                refreshToken: process.env.BOX_REFRESH_TOKEN
            };
        case 'zoho':
            return {
                clientId: process.env.ZOHO_CLIENT_ID,
                clientSecret: process.env.ZOHO_CLIENT_SECRET,
                refreshToken: process.env.ZOHO_REFRESH_TOKEN,
                folderId: process.env.ZOHO_FOLDER_ID,
                dataCenter: process.env.ZOHO_DATA_CENTER
            };
        default:
            return {};
    }
}

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
