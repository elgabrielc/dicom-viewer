const OPENJPEG_SCRIPT_URL = new URL('../openjpegwasm_decode.js', self.location.href).toString();
let openjpegModulePromise = null;

function resolveOpenJpegWorkerAssetUrl(fileName) {
    return new URL(fileName, OPENJPEG_SCRIPT_URL).toString();
}

function loadOpenJpegWorkerScript() {
    if (typeof OpenJPEGWASM === 'function') return;
    importScripts(OPENJPEG_SCRIPT_URL);
    if (typeof OpenJPEGWASM !== 'function') {
        throw new Error('OpenJPEGWASM not found in the decode worker.');
    }
}

async function initOpenJpegWorker() {
    if (openjpegModulePromise) return openjpegModulePromise;

    openjpegModulePromise = (async () => {
        loadOpenJpegWorkerScript();
        return OpenJPEGWASM({
            locateFile: (path) => resolveOpenJpegWorkerAssetUrl(path)
        });
    })();

    try {
        return await openjpegModulePromise;
    } catch (error) {
        openjpegModulePromise = null;
        throw error;
    }
}

function createPixelArray(bitsPerSample, isSigned, sampleCount) {
    if (bitsPerSample <= 8) {
        return isSigned ? new Int8Array(sampleCount) : new Uint8Array(sampleCount);
    }
    if (bitsPerSample <= 16) {
        return isSigned ? new Int16Array(sampleCount) : new Uint16Array(sampleCount);
    }
    if (bitsPerSample <= 32) {
        return isSigned ? new Int32Array(sampleCount) : new Uint32Array(sampleCount);
    }
    throw new Error(`Unsupported JPEG 2000 bit depth: ${bitsPerSample}`);
}

function copyDecodedPixels(decoded, frameInfo, bitsAllocated, pixelRepresentation) {
    const bitsPerSample = Number.isFinite(frameInfo?.bitsPerSample) && frameInfo.bitsPerSample > 0
        ? frameInfo.bitsPerSample
        : bitsAllocated;
    const isSigned = typeof frameInfo?.isSigned === 'boolean'
        ? frameInfo.isSigned
        : pixelRepresentation === 1;
    // Some parametric maps and NM SUV studies use 32-bit samples; keep them intact.
    const bytesPerSample = Math.max(1, Math.ceil(bitsPerSample / 8));

    if (![1, 2, 4].includes(bytesPerSample)) {
        throw new Error(`Unsupported JPEG 2000 sample width: ${bytesPerSample} bytes`);
    }

    const sampleCount = decoded.byteLength / bytesPerSample;
    if (!Number.isInteger(sampleCount)) {
        throw new Error('Decoded JPEG 2000 buffer length is not aligned to the sample width.');
    }

    if (bytesPerSample === 1) {
        return isSigned ? new Int8Array(decoded) : new Uint8Array(decoded);
    }

    const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    const pixelData = createPixelArray(bitsPerSample, isSigned, sampleCount);

    for (let i = 0; i < sampleCount; i++) {
        const offset = i * bytesPerSample;
        if (bytesPerSample === 2) {
            pixelData[i] = isSigned ? view.getInt16(offset, true) : view.getUint16(offset, true);
        } else {
            pixelData[i] = isSigned ? view.getInt32(offset, true) : view.getUint32(offset, true);
        }
    }

    return pixelData;
}

self.onmessage = async (event) => {
    const payload = event?.data || {};
    if (payload.type !== 'decode-j2k') return;

    let decoder = null;
    let stage = 'codec-init';

    try {
        const openjpeg = await initOpenJpegWorker();
        stage = 'decode';
        decoder = new openjpeg.J2KDecoder();

        const encodedBuffer = decoder.getEncodedBuffer(payload.frameData.length);
        encodedBuffer.set(payload.frameData);
        decoder.decode();

        const decoded = decoder.getDecodedBuffer();
        const frameInfo = decoder.getFrameInfo();

        if (payload.expectedRows && frameInfo?.height && frameInfo.height !== payload.expectedRows) {
            console.warn('JPEG 2000 worker decoded unexpected height:', frameInfo.height, payload.expectedRows);
        }
        if (payload.expectedCols && frameInfo?.width && frameInfo.width !== payload.expectedCols) {
            console.warn('JPEG 2000 worker decoded unexpected width:', frameInfo.width, payload.expectedCols);
        }

        stage = 'pixel-conversion';
        const pixelData = copyDecodedPixels(
            decoded,
            frameInfo,
            payload.bitsAllocated,
            payload.pixelRepresentation
        );

        self.postMessage(
            {
                type: 'decoded',
                requestId: payload.requestId,
                pixelData,
                frameInfo
            },
            [pixelData.buffer]
        );
    } catch (error) {
        self.postMessage({
            type: 'error',
            requestId: payload.requestId,
            stage,
            message: String(error?.message || error || 'Unknown JPEG 2000 worker error')
        });
    } finally {
        decoder?.delete();
    }
};
