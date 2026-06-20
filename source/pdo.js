/**
 * @file PDO helpers for the EDS model.
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { ObjectType, DataType, AccessType } = require('./types');

/**
 * Parse a 32-bit PDO mapping value into its components.
 * Format: [index:16][subIndex:8][bits:8]
 * @param {string|number} rawValue
 * @returns {{ index: number, subIndex: number, bits: number }|null}
 */
function parseMappingValue(rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return null;
    }
    const s = String(rawValue).trim();
    const v = /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10);
    if (isNaN(v) || v === 0) {
        return null;
    }
    return {
        index: (v >>> 16) & 0xFFFF,
        subIndex: (v >>> 8) & 0xFF,
        bits: v & 0xFF,
    };
}

/**
 * Build a 32-bit PDO mapping value string from components.
 * @param {number} index
 * @param {number} subIndex
 * @param {number} bits
 * @returns {string} e.g. '0x60000108'
 */
function buildMappingValue(index, subIndex, bits) {
    const v = (((index & 0xFFFF) << 16) | ((subIndex & 0xFF) << 8) | (bits & 0xFF)) >>> 0;
    return `0x${v.toString(16).toUpperCase().padStart(8, '0')}`;
}

/**
 * Return all VAR entries (and sub-entries) with pdoMapping=true.
 * @param {object} objects - EdsModel objects dictionary
 * @returns {Array<{ index: number, subIndex: number, name: string, dataType: number, bits: number }>}
 */
function getPdoMappableObjects(objects) {
    const result = [];

    for (const [idxStr, entry] of Object.entries(objects)) {
        const idx = Number(idxStr);

        if (entry.objectType === ObjectType.VAR && entry.pdoMapping) {
            const bits = (_dataTypeSize(entry.dataType) || 1) * 8;
            result.push({ index: idx, subIndex: 0, name: entry.parameterName, dataType: entry.dataType, bits });
        }

        if (entry.subObjects) {
            for (const [subStr, sub] of Object.entries(entry.subObjects)) {
                const subIdx = Number(subStr);
                if (subIdx === 0) {
                    continue;
                }

                if (sub.pdoMapping) {
                    const bits = (_dataTypeSize(sub.dataType) || 1) * 8;
                    result.push({
                        index: idx, subIndex: subIdx, name: sub.parameterName, dataType: sub.dataType, bits
                    });
                }
            }
        }
    }

    return result.sort((a, b) => a.index - b.index || a.subIndex - b.subIndex);
}

/**
 * Parse all TX PDO entries from an object dictionary.
 * @param {object} objects
 * @returns {Array}
 */
function getTxPdos(objects) {
    return _parsePdos(objects, 0x1800, 0x1A00);
}

/**
 * Parse all RX PDO entries from an object dictionary.
 * @param {object} objects
 * @returns {Array}
 */
function getRxPdos(objects) {
    return _parsePdos(objects, 0x1400, 0x1600);
}

/**
 * Write PDO communication parameters and mappings back to the object dictionary.
 * Returns a new objects dictionary (does not mutate the input).
 * @param {object} objects
 * @param {object} pdo
 * @param {boolean} isRx
 * @returns {object}
 */
function writePdoToObjects(objects, pdo, isRx) {
    const commBase = isRx ? 0x1400 : 0x1800;
    const mappingBase = isRx ? 0x1600 : 0x1A00;
    const n = pdo.id - 1;
    const commIdx = commBase + n;
    const mappingIdx = mappingBase + n;

    const updated = { ...objects };

    const existingComm = objects[commIdx] || {};
    const commSubs = { ...(existingComm.subObjects || {}) };
    const cobIdHex = `0x${(pdo.cobId & 0x7FF).toString(16).toUpperCase().padStart(8, '0')}`;
    commSubs[0] = _makeVar('Highest sub-index supported', DataType.UNSIGNED8, AccessType.READ_ONLY, '0x06');
    commSubs[1] = _makeVar('COB-ID', DataType.UNSIGNED32, AccessType.READ_WRITE, cobIdHex);
    commSubs[2] = _makeVar('Transmission type', DataType.UNSIGNED8, AccessType.READ_WRITE, pdo.transmissionType ?? 254);
    commSubs[3] = _makeVar('Inhibit time', DataType.UNSIGNED16, AccessType.READ_WRITE, pdo.inhibitTime ?? 0);
    commSubs[5] = _makeVar('Event timer', DataType.UNSIGNED16, AccessType.READ_WRITE, pdo.eventTimer ?? 0);
    commSubs[6] = _makeVar('Sync start value', DataType.UNSIGNED8, AccessType.READ_WRITE, pdo.syncStart ?? 0);

    updated[commIdx] = {
        parameterName: existingComm.parameterName || `${isRx ? 'Receive' : 'Transmit'} PDO Communication Parameter ${pdo.id}`,
        objectType: ObjectType.RECORD,
        subObjects: commSubs,
    };

    const existingMap = objects[mappingIdx] || {};
    const mapSubs = {};
    const ordinals = ['st', 'nd', 'rd'];
    mapSubs[0] = _makeVar(
        `Number of mapped objects ${isRx ? 'RPDO' : 'TPDO'} ${pdo.id}`,
        DataType.UNSIGNED8, AccessType.READ_WRITE, pdo.mappings.length,
    );
    for (let i = 0; i < 8; i++) {
        const mapping = pdo.mappings[i];
        const val = mapping ? buildMappingValue(mapping.index, mapping.subIndex, mapping.bits) : '0x00000000';
        const ord = ordinals[i] || 'th';
        mapSubs[i + 1] = _makeVar(
            `${i + 1}${ord} mapped object`,
            DataType.UNSIGNED32, AccessType.READ_WRITE, val,
        );
    }

    updated[mappingIdx] = {
        parameterName: existingMap.parameterName || `${isRx ? 'Receive' : 'Transmit'} PDO Mapping Parameter ${pdo.id}`,
        objectType: ObjectType.RECORD,
        subObjects: mapSubs,
    };

    return updated;
}

/**
 * Add a new PDO, allocating the next free communication/mapping slot.
 * Returns a new objects dictionary.
 * @param {object} objects
 * @param {boolean} isRx
 * @returns {object}
 */
function addNewPdo(objects, isRx) {
    const commBase = isRx ? 0x1400 : 0x1800;
    const defaultCobBase = isRx ? 0x200 : 0x180;
    let n = 0;
    while (objects[commBase + n]) {
        n++;
    }
    const newPdo = {
        id: n + 1,
        commIndex: commBase + n,
        mappingIndex: (isRx ? 0x1600 : 0x1A00) + n,
        cobId: defaultCobBase + n + 1,
        disabled: false,
        transmissionType: 254,
        inhibitTime: 0,
        eventTimer: 0,
        syncStart: 0,
        mappings: [],
    };
    return writePdoToObjects(objects, newPdo, isRx);
}

/**
 * Remove a PDO's communication and mapping objects from the dictionary.
 * Returns a new objects dictionary.
 * @param {object} objects
 * @param {number} pdoId
 * @param {boolean} isRx
 * @returns {object}
 */
function deletePdo(objects, pdoId, isRx) {
    const commBase = isRx ? 0x1400 : 0x1800;
    const mappingBase = isRx ? 0x1600 : 0x1A00;
    const n = pdoId - 1;
    const updated = { ...objects };
    delete updated[commBase + n];
    delete updated[mappingBase + n];
    return updated;
}

/**
 * Return the total number of bits used by a set of PDO mappings.
 * @param {Array} mappings
 * @returns {number}
 */
function getMappingBitUsage(mappings) {
    return (mappings || []).reduce((sum, m) => sum + (m.bits || 0), 0);
}

/**
 *
 * @param rawValue
 */
function _parseMappingValue(rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return null;
    }
    const s = String(rawValue).trim();
    const v = /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10);
    if (isNaN(v) || v === 0) {
        return null;
    }
    return {
        index: (v >>> 16) & 0xFFFF,
        subIndex: (v >>> 8) & 0xFF,
        bits: v & 0xFF,
    };
}

/**
 *
 * @param objects
 * @param commBase
 * @param mappingBase
 */
function _parsePdos(objects, commBase, mappingBase) {
    const pdos = [];

    for (let n = 0; n < 512; n++) {
        const commIdx = commBase + n;
        if (!objects[commIdx]) {
            continue;
        }

        const mappingIdx = mappingBase + n;
        const comm = objects[commIdx];
        const mapping = objects[mappingIdx];
        const commSubs = comm.subObjects || {};
        const mappingSubs = mapping?.subObjects || {};

        const cobIdRaw = String(commSubs[1]?.defaultValue ?? '0');
        const cobIdNum = /^0x/i.test(cobIdRaw) ? parseInt(cobIdRaw, 16) : parseInt(cobIdRaw, 10);
        const cobId = isNaN(cobIdNum) ? 0 : cobIdNum & 0x7FF;
        const disabled = !isNaN(cobIdNum) && !!(cobIdNum & 0x80000000);

        const txTypeRaw = commSubs[2]?.defaultValue;
        const transmissionType = txTypeRaw !== undefined ? parseInt(String(txTypeRaw), 10) : 254;

        const inhibitRaw = commSubs[3]?.defaultValue;
        const inhibitTime = inhibitRaw !== undefined ? parseInt(String(inhibitRaw), 10) : 0;

        const eventRaw = commSubs[5]?.defaultValue;
        const eventTimer = eventRaw !== undefined ? parseInt(String(eventRaw), 10) : 0;

        const syncRaw = commSubs[6]?.defaultValue;
        const syncStart = syncRaw !== undefined ? parseInt(String(syncRaw), 10) : 0;

        const countRaw = mappingSubs[0]?.defaultValue ?? '0';
        const count = Math.min(parseInt(String(countRaw), 10) || 0, 8);
        const mappings = [];
        for (let s = 1; s <= count; s++) {
            const sub = mappingSubs[s];
            if (!sub) {
                continue;
            }
            const parsed = _parseMappingValue(sub.defaultValue);
            if (parsed && parsed.index !== 0) {
                mappings.push(parsed);
            }
        }

        pdos.push({
            id: n + 1,
            commIndex: commIdx,
            mappingIndex: mappingIdx,
            cobId,
            disabled,
            transmissionType,
            inhibitTime,
            eventTimer,
            syncStart,
            mappings,
        });
    }

    return pdos;
}

/**
 *
 * @param name
 * @param dt
 * @param ac
 * @param defVal
 */
function _makeVar(name, dt, ac, defVal) {
    return {
        parameterName: name,
        objectType: ObjectType.VAR,
        dataType: dt,
        accessType: ac,
        defaultValue: String(defVal),
        pdoMapping: false,
    };
}

/**
 *
 * @param type
 */
function _dataTypeSize(type) {
    const sizes = {
        [DataType.BOOLEAN]: 1,
        [DataType.INTEGER8]: 1, [DataType.UNSIGNED8]: 1,
        [DataType.INTEGER16]: 2, [DataType.UNSIGNED16]: 2,
        [DataType.INTEGER24]: 3, [DataType.UNSIGNED24]: 3,
        [DataType.INTEGER32]: 4, [DataType.UNSIGNED32]: 4, [DataType.REAL32]: 4,
        [DataType.INTEGER40]: 5, [DataType.UNSIGNED40]: 5,
        [DataType.INTEGER48]: 6, [DataType.UNSIGNED48]: 6, [DataType.TIME_OF_DAY]: 6, [DataType.TIME_DIFFERENCE]: 6,
        [DataType.INTEGER56]: 7, [DataType.UNSIGNED56]: 7,
        [DataType.INTEGER64]: 8, [DataType.UNSIGNED64]: 8, [DataType.REAL64]: 8,
    };
    return sizes[type] ?? null;
}

module.exports = {
    parseMappingValue,
    buildMappingValue,
    getPdoMappableObjects,
    getTxPdos,
    getRxPdos,
    writePdoToObjects,
    addNewPdo,
    deletePdo,
    getMappingBitUsage,
};
