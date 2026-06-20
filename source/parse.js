/**
 * @file EDS parse: INI string → EdsModel plain object.
 *
 * Browser-compatible (no fs/path); uses the ini package.
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { parse: parseIni } = require('ini');
const { ObjectType, AccessType } = require('./types');

// ─── INI helpers ──────────────────────────────────────────────────────────────

/**
 * Parse an INI string into a case-normalised section map.
 * Keys within sections are lowercased for predictable lookups.
 * @param text
 * @private
 */
function _parseEdsIni(text) {
    const raw = parseIni(text);
    const out = {};
    for (const [section, body] of Object.entries(raw)) {
        if (typeof body !== 'object') {
            continue;
        }
        const norm = {};
        for (const [k, v] of Object.entries(body)) {
            norm[k.toLowerCase()] = v;
        }
        out[section.toLowerCase()] = norm;
    }
    return out;
}

// ─── Value coercion helpers ───────────────────────────────────────────────────

/**
 * Parse a decimal or 0x-prefixed hex string to number, or return undefined. @private
 * @param s
 */
function _parseNum(s) {
    if (s === undefined || s === null || s === '') {
        return undefined;
    }
    const str = String(s).trim();
    if (/^0x/i.test(str)) {
        return parseInt(str, 16);
    }
    return parseInt(str, 10);
}

/**
 * Parse a "0"/"1"/true/false value to boolean. @private
 * @param s
 */
function _parseBool(s) {
    if (s === undefined || s === null) {
        return undefined;
    }
    if (typeof s === 'boolean') {
        return s;
    }
    return String(s).trim() === '1';
}

// ─── Section parsers ──────────────────────────────────────────────────────────

/**
 * @param section
 * @private
 */
function _parseEntry(section) {
    return {
        parameterName: section['parametername'] ?? '',
        objectType:    _parseNum(section['objecttype']) ?? ObjectType.VAR,
        dataType:      _parseNum(section['datatype']),
        subNumber:     _parseNum(section['subnumber']),
        accessType:    section['accesstype'] ?? AccessType.READ_WRITE,
        defaultValue:  section['defaultvalue'],
        lowLimit:      section['lowlimit'],
        highLimit:     section['highlimit'],
        pdoMapping:    _parseBool(section['pdomapping']),
        objFlags:      _parseNum(section['objflags']),
        compactSubObj: _parseBool(section['compactsubobj']),
    };
}

/**
 * @param section
 * @private
 */
function _collectIndexList(section) {
    if (!section) {
        return [];
    }
    const indices = [];
    for (const [k, v] of Object.entries(section)) {
        if (k === 'supportedobjects' || k === 'nrofentries') {
            continue;
        }
        const idx = _parseNum(v);
        if (!isNaN(idx)) {
            indices.push(idx);
        }
    }
    return indices;
}

/**
 * @param sections
 * @private
 */
function _parseFileInfo(sections) {
    const s = sections['fileinfo'] ?? {};
    return {
        fileName:         s['filename']         ?? '',
        fileVersion:      s['fileversion']       ?? '',
        fileRevision:     s['filerevision']      ?? '',
        edsVersion:       s['edsversion']        ?? '',
        description:      s['description']       ?? '',
        creationTime:     s['creationtime']      ?? '',
        creationDate:     s['creationdate']      ?? '',
        createdBy:        s['createdby']         ?? '',
        modificationTime: s['modificationtime']  ?? '',
        modificationDate: s['modificationdate']  ?? '',
        modifiedBy:       s['modifiedby']        ?? '',
    };
}

/**
 * @param sections
 * @private
 */
function _parseDeviceInfo(sections) {
    const s = sections['deviceinfo'] ?? {};
    return {
        vendorName:               s['vendorname']               ?? '',
        vendorNumber:             s['vendornumber']             ?? '',
        productName:              s['productname']              ?? '',
        productNumber:            s['productnumber']            ?? '',
        revisionNumber:           s['revisionnumber']           ?? '',
        orderCode:                s['ordercode']                ?? '',
        baudRate10:               _parseBool(s['baudrate_10']),
        baudRate20:               _parseBool(s['baudrate_20']),
        baudRate50:               _parseBool(s['baudrate_50']),
        baudRate125:              _parseBool(s['baudrate_125']),
        baudRate250:              _parseBool(s['baudrate_250']),
        baudRate500:              _parseBool(s['baudrate_500']),
        baudRate800:              _parseBool(s['baudrate_800']),
        baudRate1000:             _parseBool(s['baudrate_1000']),
        simpleBootUpMaster:       _parseBool(s['simplebootupmaster']),
        simpleBootUpSlave:        _parseBool(s['simplebootupslave']),
        granularity:              _parseNum(s['granularity'])              ?? 0,
        dynamicChannelsSupported: _parseNum(s['dynamicchannelssupported']) ?? 0,
        groupMessaging:           _parseBool(s['groupmessaging']),
        nrOfRXPDO:                _parseNum(s['nrofrxpdo'])               ?? 0,
        nrOfTXPDO:                _parseNum(s['nroftxpdo'])               ?? 0,
        lssSupported:             _parseBool(s['lsssupported']),
    };
}

/**
 * @param sections
 * @private
 */
function _parseDummyUsage(sections) {
    const s = sections['dummyusage'] ?? {};
    const out = {};
    for (const [k, v] of Object.entries(s)) {
        out[k] = _parseBool(v);
    }
    return out;
}

/**
 * @param sections
 * @private
 */
function _parseComments(sections) {
    const s = sections['comments'] ?? {};
    const lines = _parseNum(s['lines']) ?? 0;
    const comments = [];
    for (let i = 1; i <= lines; i++) {
        comments.push(s[`line${i}`] ?? '');
    }
    return comments;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse an EDS INI string into a plain EdsModel object.
 *
 * The returned model uses the same field names and string types that are
 * stored in the EDS file (dates as "MM-DD-YYYY" strings, vendor numbers as
 * "0x..." strings, baud rates as booleans per rate).
 * @param {string} text - raw EDS file content.
 * @returns {object} EdsModel plain object.
 */
function parseEds(text) {
    const sections = _parseEdsIni(text);

    const fileInfo   = _parseFileInfo(sections);
    const deviceInfo = _parseDeviceInfo(sections);
    const dummyUsage = _parseDummyUsage(sections);
    const comments   = _parseComments(sections);

    const allIndices = new Set([
        ..._collectIndexList(sections['mandatoryobjects']),
        ..._collectIndexList(sections['optionalobjects']),
        ..._collectIndexList(sections['manufacturerobjects']),
    ]);

    const objects = {};

    for (const index of allIndices) {
        const hexKey  = index.toString(16).toUpperCase().padStart(4, '0');
        const section = sections[hexKey.toLowerCase()];
        if (!section) {
            continue;
        }

        const entry = _parseEntry(section);

        if (
            entry.objectType === ObjectType.ARRAY   ||
            entry.objectType === ObjectType.RECORD  ||
            entry.objectType === ObjectType.DEFSTRUCT
        ) {
            const subObjects = {};
            const prefix     = hexKey.toLowerCase() + 'sub';

            for (const [sectionKey, subSection] of Object.entries(sections)) {
                if (!sectionKey.startsWith(prefix)) {
                    continue;
                }
                const subPart = sectionKey.slice(prefix.length);
                if (!/^[0-9a-f]+$/i.test(subPart)) {
                    continue;
                }
                const subIdx = parseInt(subPart, 16);
                if (!isNaN(subIdx)) {
                    subObjects[subIdx] = _parseEntry(subSection);
                }
            }

            entry.subObjects = subObjects;
        }

        objects[index] = entry;
    }

    return { fileInfo, deviceInfo, dummyUsage, comments, objects };
}

module.exports = { parseEds };
