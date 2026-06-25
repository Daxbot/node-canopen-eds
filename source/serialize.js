/**
 * @file EDS serialize: EdsModel plain object → INI string.
 *
 * Browser-compatible (no fs/path).
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { ObjectType } = require('./types');

const EOL = '\r\n';

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * @param n
 * @private
 */
function _hex4(n) {
    return `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * @param n
 * @private
 */
function _hex2(n) {
    return `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * @param v
 * @private
 */
function _boolNum(v) {
    return v ? '1' : '0';
}

/**
 * @param {...any} parts
 * @private
 */
function _lines(...parts) {
    return parts.filter(l => l !== null && l !== undefined).join(EOL);
}

/**
 *
 * @param d
 */
function _formatDate(d) {
    const dt = d ? new Date(d) : new Date();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${mm}-${dd}-${dt.getFullYear()}`;
}

/**
 *
 * @param d
 */
function _formatTime(d) {
    const dt = d ? new Date(d) : new Date();
    let h = dt.getHours();
    const m = String(dt.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) {
        h -= 12;
    }
    if (h === 0) {
        h = 12;
    }
    return `${h}:${m}${ampm}`;
}

// ─── Section writers ──────────────────────────────────────────────────────────

/**
 * @param fileInfo
 * @private
 */
function _writeFileInfo(fileInfo) {
    const now = new Date();
    return _lines(
        '[FileInfo]',
        `FileName=${fileInfo.fileName         || ''}`,
        `FileVersion=${fileInfo.fileVersion   || '1'}`,
        `FileRevision=${fileInfo.fileRevision || '1'}`,
        `EDSVersion=${fileInfo.edsVersion     || '4.0'}`,
        `Description=${fileInfo.description   || ''}`,
        `CreationTime=${fileInfo.creationTime || _formatTime(now)}`,
        `CreationDate=${fileInfo.creationDate || _formatDate(now)}`,
        `CreatedBy=${fileInfo.createdBy        || ''}`,
        `ModificationTime=${_formatTime(now)}`,
        `ModificationDate=${_formatDate(now)}`,
        `ModifiedBy=${fileInfo.modifiedBy      || ''}`,
    );
}

/**
 * @param deviceInfo
 * @private
 */
function _writeDeviceInfo(deviceInfo) {
    return _lines(
        '[DeviceInfo]',
        `VendorName=${deviceInfo.vendorName                           || ''}`,
        `VendorNumber=${deviceInfo.vendorNumber                       || '0x00000000'}`,
        `ProductName=${deviceInfo.productName                         || ''}`,
        `ProductNumber=${deviceInfo.productNumber                     || '0x00000000'}`,
        `RevisionNumber=${deviceInfo.revisionNumber                   || '0x00000000'}`,
        `OrderCode=${deviceInfo.orderCode                             || ''}`,
        `BaudRate_10=${_boolNum(deviceInfo.baudRate10)}`,
        `BaudRate_20=${_boolNum(deviceInfo.baudRate20)}`,
        `BaudRate_50=${_boolNum(deviceInfo.baudRate50)}`,
        `BaudRate_125=${_boolNum(deviceInfo.baudRate125)}`,
        `BaudRate_250=${_boolNum(deviceInfo.baudRate250)}`,
        `BaudRate_500=${_boolNum(deviceInfo.baudRate500)}`,
        `BaudRate_800=${_boolNum(deviceInfo.baudRate800)}`,
        `BaudRate_1000=${_boolNum(deviceInfo.baudRate1000)}`,
        `SimpleBootUpMaster=${_boolNum(deviceInfo.simpleBootUpMaster)}`,
        `SimpleBootUpSlave=${_boolNum(deviceInfo.simpleBootUpSlave)}`,
        `Granularity=${deviceInfo.granularity                         ?? 0}`,
        `DynamicChannelsSupported=${deviceInfo.dynamicChannelsSupported ?? 0}`,
        `GroupMessaging=${_boolNum(deviceInfo.groupMessaging)}`,
        `NrOfRXPDO=${deviceInfo.nrOfRXPDO                            ?? 0}`,
        `NrOfTXPDO=${deviceInfo.nrOfTXPDO                            ?? 0}`,
        `LSS_Supported=${_boolNum(deviceInfo.lssSupported)}`,
    );
}

/**
 * @param dummyUsage
 * @private
 */
function _writeDummyUsage(dummyUsage) {
    const rows = ['[DummyUsage]'];
    for (const [k, v] of Object.entries(dummyUsage || {})) {
        rows.push(`${k}=${_boolNum(v)}`);
    }
    return rows.join(EOL);
}

/**
 * @param comments
 * @private
 */
function _writeComments(comments) {
    const arr = comments || [];
    const rows = ['[Comments]', `Lines=${arr.length}`];
    arr.forEach((l, i) => rows.push(`Line${i + 1}=${l}`));
    return rows.join(EOL);
}

/**
 * @param label
 * @param indices
 * @private
 */
function _writeObjectList(label, indices) {
    const rows = [`[${label}]`, `SupportedObjects=${indices.length}`];
    indices.forEach((idx, i) => rows.push(`${i + 1}=${_hex4(idx)}`));
    return rows.join(EOL);
}

/**
 * @param hexKey
 * @param entry
 * @private
 */
function _writeEntrySection(hexKey, entry, storageGroup) {
    const rows = [`[${hexKey}]`];
    rows.push(`ParameterName=${entry.parameterName}`);
    rows.push(`ObjectType=${_hex2(entry.objectType)}`);

    // CANopenNode storage group, encoded as a non-standard comment (CiA-306 tools
    // ignore it). Subs inherit the parent object's group.
    rows.push(`;StorageLocation=${storageGroup || entry.storageLocation || 'RAM'}`);

    if (entry.subNumber !== undefined) {
        rows.push(`SubNumber=${_hex2(entry.subNumber)}`);
    }

    if (entry.dataType !== undefined) {
        rows.push(`DataType=${_hex2(entry.dataType)}`);
    }

    if (entry.accessType !== undefined) {
        rows.push(`AccessType=${entry.accessType}`);
    }

    if (entry.defaultValue !== undefined && entry.defaultValue !== '') {
        rows.push(`DefaultValue=${entry.defaultValue}`);
    }

    if (entry.lowLimit !== undefined && entry.lowLimit !== '') {
        rows.push(`LowLimit=${entry.lowLimit}`);
    }

    if (entry.highLimit !== undefined && entry.highLimit !== '') {
        rows.push(`HighLimit=${entry.highLimit}`);
    }

    if (entry.pdoMapping !== undefined) {
        rows.push(`PDOMapping=${_boolNum(entry.pdoMapping)}`);
    }

    if (entry.objFlags !== undefined) {
        rows.push(`ObjFlags=${entry.objFlags}`);
    }

    if (entry.compactSubObj !== undefined) {
        rows.push(`CompactSubObj=${_boolNum(entry.compactSubObj)}`);
    }

    return rows.join(EOL);
}

/**
 * @param idx
 * @param entry
 * @private
 */
function _writeObjectSection(idx, entry) {
    const hexKey     = idx.toString(16).toUpperCase().padStart(4, '0');
    const isContainer =
        entry.objectType === ObjectType.ARRAY   ||
        entry.objectType === ObjectType.RECORD  ||
        entry.objectType === ObjectType.DEFSTRUCT;

    const parts = [];

    if (isContainer) {
        const subObjects  = entry.subObjects || {};
        const subIndices  = Object.keys(subObjects).map(Number).sort((a, b) => a - b);
        const containerEntry = { ...entry, subNumber: subIndices.length };
        const group = entry.storageLocation;
        parts.push(_writeEntrySection(hexKey, containerEntry, group));

        for (const sub of subIndices) {
            const subHex = sub.toString(16).toUpperCase().padStart(2, '0');
            parts.push(_writeEntrySection(`${hexKey}sub${subHex}`, subObjects[sub], group));
        }
    } else {
        parts.push(_writeEntrySection(hexKey, entry, entry.storageLocation));
    }

    return parts.join(EOL + EOL);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Serialize an EdsModel plain object to EDS INI text.
 * @param {object} model - EdsModel as returned by {@link parseEds} or built by the editor.
 * @returns {string} EDS file content (CRLF line endings, per CiA 306).
 */
function serializeEds(model) {
    const { fileInfo, deviceInfo, dummyUsage, comments, objects } = model;

    const sortedIndices = Object.keys(objects)
        .map(Number)
        .sort((a, b) => a - b);

    const mandatory    = sortedIndices.filter(i => i >= 0x1000 && i <= 0x1029);
    const optional     = sortedIndices.filter(
        i => (i >= 0x102A && i <= 0x1FFF) || (i >= 0x6000 && i <= 0x9FFF)
    );
    const manufacturer = sortedIndices.filter(i => i >= 0x2000 && i <= 0x5FFF);

    const sections = [
        _writeFileInfo(fileInfo),
        _writeDeviceInfo(deviceInfo),
        _writeDummyUsage(dummyUsage),
        _writeComments(comments),
        _writeObjectList('MandatoryObjects', mandatory),
    ];

    for (const idx of mandatory)    {
        sections.push(_writeObjectSection(idx, objects[idx]));
    }
    sections.push(_writeObjectList('OptionalObjects', optional));
    for (const idx of optional)     {
        sections.push(_writeObjectSection(idx, objects[idx]));
    }
    sections.push(_writeObjectList('ManufacturerObjects', manufacturer));
    for (const idx of manufacturer) {
        sections.push(_writeObjectSection(idx, objects[idx]));
    }

    return sections.join(EOL + EOL) + EOL;
}

module.exports = { serializeEds };
