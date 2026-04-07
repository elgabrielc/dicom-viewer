// @ts-check
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const PYTHON_BIN = path.join(REPO_ROOT, 'venv', 'bin', 'python');
const UID_ROOT = '1.2.826.0.1.3680043.10.54321';

const PYTHON_SCRIPT = `
import json
import struct
import sys
from pathlib import Path

from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage

payload = json.loads(sys.argv[1])
folder = Path(payload["folder"])
folder.mkdir(parents=True, exist_ok=True)

study_uid = payload["studyUid"]
series_uid = payload["seriesUid"]

for index, entry in enumerate(payload["entries"], start=1):
    file_path = folder / entry["fileName"]
    sop_instance_uid = entry.get("sopInstanceUid") or f"{series_uid}.{index}"

    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
    file_meta.MediaStorageSOPInstanceUID = sop_instance_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = "1.2.826.0.1.3680043.10.54321.1"

    ds = FileDataset(str(file_path), {}, file_meta=file_meta, preamble=b"\\0" * 128)
    ds.is_little_endian = True
    ds.is_implicit_VR = False

    ds.SOPClassUID = SecondaryCaptureImageStorage
    ds.SOPInstanceUID = sop_instance_uid
    ds.StudyInstanceUID = study_uid
    ds.SeriesInstanceUID = series_uid
    ds.SeriesDescription = entry.get("description") or ""
    ds.SeriesNumber = int(entry.get("seriesNumber", 1))
    ds.InstanceNumber = int(entry.get("instanceNumber", index))
    ds.Modality = entry.get("modality", "DX")
    ds.PatientName = "Test^SeriesSplit"
    ds.PatientID = "SERIES-SPLIT"
    ds.StudyDescription = "Synthetic collision test"
    ds.StudyDate = "20260320"
    ds.StudyTime = "120000"
    ds.ContentDate = "20260320"
    ds.ContentTime = "120000"

    ds.Rows = 2
    ds.Columns = 2
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.PixelRepresentation = 0
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelData = struct.pack("<4H", index, index + 1, index + 2, index + 3)

    ds.save_as(str(file_path), write_like_original=False)
`;

function makeUid(suffix = '') {
    const randomPart = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    return `${UID_ROOT}.${randomPart}${suffix}`;
}

function createSyntheticDicomFolder(entries, options = {}) {
    if (!fs.existsSync(PYTHON_BIN)) {
        throw new Error(`Missing test python environment: ${PYTHON_BIN}`);
    }

    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dicom-series-split-'));
    const studyUid = options.studyUid || makeUid('.1');
    const seriesUid = options.seriesUid || `${studyUid}.1`;
    const normalizedEntries = entries.map((entry, index) => ({
        description: entry.description || '',
        fileName: entry.fileName || `series-${String(index + 1).padStart(2, '0')}.dcm`,
        instanceNumber: entry.instanceNumber || index + 1,
        modality: entry.modality || 'DX',
        seriesNumber: entry.seriesNumber || 1,
    }));

    const payload = JSON.stringify({
        folder,
        studyUid,
        seriesUid,
        entries: normalizedEntries,
    });

    execFileSync(PYTHON_BIN, ['-c', PYTHON_SCRIPT, payload], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
    });

    return {
        folder,
        studyUid,
        seriesUid,
        entries: normalizedEntries.map((entry) => ({
            ...entry,
            path: path.join(folder, entry.fileName),
        })),
    };
}

function removeSyntheticDicomFolder(folder) {
    if (!folder) return;
    fs.rmSync(folder, { recursive: true, force: true });
}

module.exports = {
    createSyntheticDicomFolder,
    removeSyntheticDicomFolder,
};
