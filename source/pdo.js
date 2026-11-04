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
    const oldCommSubs = existingComm.subObjects || {};
    const commSubs = { ...oldCommSubs };

    // Keep the frame and RTR bits (29, 30) of the old COB-ID. Bit 31 is the
    // PDO valid bit, which the caller gives as pdo.disabled.
    // A COB-ID with $NODEID keeps the term, so the value follows the node-id.
    const oldCobIdRaw = String(oldCommSubs[1]?.defaultValue ?? '');
    const oldCobId = _parseNumber(oldCobIdRaw);
    const keptBits = isNaN(oldCobId) ? 0 : oldCobId & 0x60000000;
    const cobId = (keptBits | (pdo.disabled ? 0x80000000 : 0) | (pdo.cobId & 0x7FF)) >>> 0;
    const nodeIdTerm = /\$NODEID/i.test(oldCobIdRaw) ? '$NODEID+' : '';
    const cobIdHex = `${nodeIdTerm}0x${cobId.toString(16).toUpperCase().padStart(8, '0')}`;

    _setVar(commSubs, oldCommSubs, 1, 'COB-ID', DataType.UNSIGNED32, AccessType.READ_WRITE, cobIdHex);
    _setVar(commSubs, oldCommSubs, 2, 'Transmission type', DataType.UNSIGNED8, AccessType.READ_WRITE, pdo.transmissionType ?? 254);

    // CiA 301 lets a record stop after sub-index 2. An existing record gets
    // an optional sub-object only when its value is not the default (0).
    const optional = [
        [3, 'Inhibit time', DataType.UNSIGNED16, pdo.inhibitTime ?? 0],
        [5, 'Event timer', DataType.UNSIGNED16, pdo.eventTimer ?? 0],
        [6, 'Sync start value', DataType.UNSIGNED8, pdo.syncStart ?? 0],
    ];
    for (const [subIdx, name, dt, value] of optional) {
        if (!objects[commIdx] || oldCommSubs[subIdx] || value !== 0) {
            _setVar(commSubs, oldCommSubs, subIdx, name, dt, AccessType.READ_WRITE, value);
        }
    }

    // Sub-index 0 can declare more than the record holds, so it only grows.
    const oldHighestSub = _parseNumberOr(oldCommSubs[0]?.defaultValue, 0);
    const highestSub = Math.max(oldHighestSub, ...Object.keys(commSubs).map(Number).filter(s => s > 0));
    const highestSubHex = `0x${highestSub.toString(16).toUpperCase().padStart(2, '0')}`;
    _setVar(commSubs, oldCommSubs, 0, 'Highest sub-index supported', DataType.UNSIGNED8, AccessType.READ_ONLY, highestSubHex);

    updated[commIdx] = {
        ...existingComm,
        parameterName: existingComm.parameterName || `${isRx ? 'Receive' : 'Transmit'} PDO Communication Parameter ${pdo.id}`,
        objectType: ObjectType.RECORD,
        subObjects: commSubs,
    };

    const existingMap = objects[mappingIdx] || {};
    const oldMapSubs = existingMap.subObjects || {};
    const mapSubs = {};
    const ordinals = ['st', 'nd', 'rd'];
    _setVar(
        mapSubs, oldMapSubs, 0,
        `Number of mapped objects ${isRx ? 'RPDO' : 'TPDO'} ${pdo.id}`,
        DataType.UNSIGNED8, AccessType.READ_WRITE, pdo.mappings.length,
    );

    // A new PDO gets all 8 slots. An existing PDO keeps its slot count and
    // grows only when it needs more slots.
    const oldSlots = Object.keys(oldMapSubs).filter(s => Number(s) > 0).length;
    const slots = objects[mappingIdx] ? Math.max(oldSlots, pdo.mappings.length) : 8;
    for (let i = 0; i < slots; i++) {
        const mapping = pdo.mappings[i];
        const val = mapping ? buildMappingValue(mapping.index, mapping.subIndex, mapping.bits) : '0x00000000';
        const ord = ordinals[i] || 'th';
        _setVar(
            mapSubs, oldMapSubs, i + 1,
            `${i + 1}${ord} mapped object`,
            DataType.UNSIGNED32, AccessType.READ_WRITE, val,
        );
    }

    updated[mappingIdx] = {
        ...existingMap,
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

        // A $NODEID term counts as 0, so cobId is the base COB-ID.
        const cobIdNum = _parseNumber(commSubs[1]?.defaultValue);
        const cobId = isNaN(cobIdNum) ? 0 : cobIdNum & 0x7FF;
        const disabled = !isNaN(cobIdNum) && !!(cobIdNum & 0x80000000);

        const transmissionType = _parseNumberOr(commSubs[2]?.defaultValue, 254);
        const inhibitTime = _parseNumberOr(commSubs[3]?.defaultValue, 0);
        const eventTimer = _parseNumberOr(commSubs[5]?.defaultValue, 0);
        const syncStart = _parseNumberOr(commSubs[6]?.defaultValue, 0);

        const count = Math.min(_parseNumberOr(mappingSubs[0]?.defaultValue, 0), 8);
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
 * Parse a value as an EDS file writes it: decimal, 0x-prefixed hex, or a sum
 * of these with one $NODEID term (e.g. '$NODEID+0x180'). $NODEID counts as 0.
 * @param {string|number} raw
 * @returns {number} NaN if raw is not a valid value.
 */
function _parseNumber(raw) {
    const terms = String(raw ?? '').split('+').map(t => t.trim());
    let sum = 0;
    let nodeIds = 0;
    for (const t of terms) {
        if (/^\$NODEID$/i.test(t)) {
            nodeIds++;
        } else if (/^0x[0-9a-f]+$/i.test(t)) {
            sum += parseInt(t, 16);
        } else if (/^\d+$/.test(t)) {
            sum += parseInt(t, 10);
        } else {
            return NaN;
        }
    }
    return nodeIds > 1 ? NaN : sum;
}

/**
 * Parse a value with _parseNumber, or return fallback if it is not valid.
 * @param {string|number|undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function _parseNumberOr(raw, fallback) {
    const v = _parseNumber(raw);
    return isNaN(v) ? fallback : v;
}

/**
 * Write one PDO sub-object. An existing sub-object keeps its name, access
 * type, and other attributes, and keeps its value text if the value is the
 * same. The template (name, dt, ac) applies only to a new sub-object.
 * @param {object} subs - sub-objects to write into
 * @param {object} oldSubs - sub-objects before the write
 * @param {number} subIdx
 * @param {string} name
 * @param {number} dt
 * @param {string} ac
 * @param {string|number} value
 */
function _setVar(subs, oldSubs, subIdx, name, dt, ac, value) {
    const old = oldSubs[subIdx];
    if (!old) {
        subs[subIdx] = _makeVar(name, dt, ac, value);
    } else if (_parseNumber(old.defaultValue) === _parseNumber(value)) {
        subs[subIdx] = old;
    } else {
        subs[subIdx] = { ...old, defaultValue: String(value) };
    }
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
