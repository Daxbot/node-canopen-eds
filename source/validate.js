/**
 * @file EDS model validation: consistency checks that catch hand-edit errors.
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const {
    ObjectType,
    AccessType,
    DataType,
    dataTypeSize,
    isSignedType,
    isUnsignedType,
    isFloatType,
    isContainerType,
} = require('./types');
const { getTxPdos, getRxPdos } = require('./pdo');

/**
 * One validation finding.
 * @typedef {object} Finding
 * @property {'error'|'warning'} severity
 * @property {number|null} index - object index, or null for the whole file.
 * @property {number|null} subIndex - sub-index, or null for the whole object.
 * @property {string} message
 */

const MANDATORY = [
    [0x1000, 'Device type'],
    [0x1001, 'Error register'],
    [0x1018, 'Identity'],
];

const ACCESS_TYPES = Object.values(AccessType);
const OBJECT_TYPES = Object.values(ObjectType);
const DATA_TYPES = Object.values(DataType);

/** Data types 0x0001-0x0007 that an RPDO can map as dummy entries. */
const DUMMY_MAX = 0x0007;

/** Maximum number of mapped objects in one PDO. */
const PDO_MAX_MAPPINGS = 64;

/**
 * Check an EDS model for consistency errors.
 *
 * The checks cover object and sub-index ranges, sub-index 0 of containers,
 * data types, access types, default values and limits, PDO mappings, and
 * PDO COB-IDs.
 * @param {object} model - EdsModel plain object, as parseEds returns it.
 * @returns {Array<Finding>} findings sorted by index and sub-index.
 */
function validateEds(model) {
    const findings = [];
    const objects = model?.objects || {};

    const add = (severity, index, subIndex, message) => {
        findings.push({ severity, index, subIndex, message });
    };

    for (const [index, name] of MANDATORY) {
        if (!objects[index]) {
            add('error', index, null, `Mandatory object ${name} is missing`);
        }
    }

    for (const [idxStr, entry] of Object.entries(objects)) {
        const index = Number(idxStr);
        if (!Number.isInteger(index) || index < 0x0001 || index > 0xFFFF) {
            add('error', null, null, `Object index ${idxStr} is outside 0x0001-0xFFFF`);
            continue;
        }
        _checkEntry(objects, index, entry, add);
    }

    _checkPdos(objects, false, add);
    _checkPdos(objects, true, add);

    return findings.sort((a, b) => (a.index ?? -1) - (b.index ?? -1)
        || (a.subIndex ?? -1) - (b.subIndex ?? -1));
}

/**
 * Check one object and its sub-objects.
 * @param {object} objects - objects dictionary.
 * @param {number} index
 * @param {object} entry
 * @param {Function} add - finding callback.
 * @private
 */
function _checkEntry(objects, index, entry, add) {
    if (!OBJECT_TYPES.includes(entry.objectType)) {
        add('error', index, null, `Unknown object type ${entry.objectType}`);
        return;
    }

    if (!entry.parameterName) {
        add('warning', index, null, 'ParameterName is empty');
    }

    if (!isContainerType(entry.objectType)) {
        if (entry.objectType === ObjectType.VAR) {
            _checkVar(index, null, entry, add);
        }
        return;
    }

    if (entry.compactSubObj) {
        return;
    }

    const subs = entry.subObjects || {};
    const subIndices = Object.keys(subs).map(Number);
    for (const sub of subIndices) {
        if (!Number.isInteger(sub) || sub < 0 || sub > 0xFF) {
            add('error', index, null, `Sub-index ${sub} is outside 0-255`);
        }
    }

    const sub0 = subs[0];
    if (!sub0) {
        add('error', index, 0, 'Sub-index 0 is missing');
    } else {
        if (sub0.dataType !== DataType.UNSIGNED8) {
            add('error', index, 0, 'Sub-index 0 must be UNSIGNED8');
        }

        // In these objects, sub-index 0 is a count that can be less than
        // the highest sub-index: PDO mapping (number of mapped objects) and
        // the pre-defined error field (number of errors).
        const isCount = index === 0x1003
            || (index >= 0x1600 && index <= 0x17FF)
            || (index >= 0x1A00 && index <= 0x1BFF);

        const highest = Math.max(0, ...subIndices.filter(s => s > 0 && s !== 0xFF));
        const declared = _parseInteger(sub0.defaultValue);
        if (!isCount && declared !== null && declared < BigInt(highest)) {
            add('error', index, 0,
                `Sub-index 0 is ${declared}, but the highest sub-index is ${highest}`);
        }
    }

    let arrayType = null;
    for (const sub of subIndices.sort((a, b) => a - b)) {
        const subEntry = subs[sub];
        if (subEntry.objectType !== undefined && subEntry.objectType !== ObjectType.VAR) {
            add('error', index, sub, 'Sub-object must be a VAR');
            continue;
        }

        _checkVar(index, sub, subEntry, add);

        if (entry.objectType === ObjectType.ARRAY && sub > 0) {
            if (arrayType === null) {
                arrayType = subEntry.dataType;
            } else if (subEntry.dataType !== arrayType) {
                add('error', index, sub, 'All ARRAY sub-objects after sub-index 0 must have one data type');
            }
        }
    }
}

/**
 * Check one VAR: data type, access type, default value and limits.
 * @param {number} index
 * @param {number|null} subIndex
 * @param {object} entry
 * @param {Function} add - finding callback.
 * @private
 */
function _checkVar(index, subIndex, entry, add) {
    if (!DATA_TYPES.includes(entry.dataType)) {
        add('error', index, subIndex, `Unknown data type ${entry.dataType}`);
        return;
    }

    if (!ACCESS_TYPES.includes(entry.accessType)) {
        add('error', index, subIndex, `Unknown access type '${entry.accessType}'`);
    }

    const range = _range(entry.dataType);
    for (const field of ['defaultValue', 'lowLimit', 'highLimit']) {
        const raw = entry[field];
        if (raw === undefined || raw === null || String(raw).trim() === '') {
            continue;
        }
        const message = _checkValue(entry.dataType, range, raw);
        if (message) {
            add('error', index, subIndex, `${field} ${message}`);
        }
    }

    if (range) {
        const low = _parseInteger(entry.lowLimit);
        const high = _parseInteger(entry.highLimit);
        const value = _parseInteger(entry.defaultValue);
        if (low !== null && high !== null && low > high) {
            add('error', index, subIndex, `lowLimit ${low} is greater than highLimit ${high}`);
        }
        if (value !== null && low !== null && value < low) {
            add('error', index, subIndex, `defaultValue ${value} is less than lowLimit ${low}`);
        }
        if (value !== null && high !== null && value > high) {
            add('error', index, subIndex, `defaultValue ${value} is greater than highLimit ${high}`);
        }
    }
}

/**
 * Check one value against a data type.
 * @param {number} dataType
 * @param {{min: bigint, max: bigint}|null} range - integer range, or null.
 * @param {string|number} raw
 * @returns {string|null} the problem, or null if the value is valid.
 * @private
 */
function _checkValue(dataType, range, raw) {
    if (range) {
        const value = _parseInteger(raw);
        if (value === null) {
            return `'${raw}' is not an integer`;
        }
        if (value < range.min || value > range.max) {
            return `${raw} is outside the range of the data type (${range.min} to ${range.max})`;
        }
    } else if (isFloatType(dataType)) {
        if (!Number.isFinite(Number(String(raw).trim()))) {
            return `'${raw}' is not a number`;
        }
    }
    return null;
}

/**
 * Return the integer range of a data type.
 *
 * A signed value can also be given as its unsigned bit pattern in hex
 * (0xFFFF for INTEGER16 -1), so the range of a signed type goes up to the
 * unsigned maximum.
 * @param {number} dataType
 * @returns {{min: bigint, max: bigint}|null} null for a type that is not an integer.
 * @private
 */
function _range(dataType) {
    if (dataType === DataType.BOOLEAN) {
        return { min: 0n, max: 1n };
    }
    const bits = BigInt((dataTypeSize(dataType) || 0) * 8);
    if (isUnsignedType(dataType)) {
        return { min: 0n, max: (1n << bits) - 1n };
    }
    if (isSignedType(dataType)) {
        return { min: -(1n << (bits - 1n)), max: (1n << bits) - 1n };
    }
    return null;
}

/**
 * Parse an integer as an EDS file writes it: decimal, 0x-prefixed hex, or a
 * sum of these with one $NODEID term. $NODEID counts as 0.
 * @param {string|number|undefined} raw
 * @returns {bigint|null} null if raw is empty or not a valid integer.
 * @private
 */
function _parseInteger(raw) {
    if (raw === undefined || raw === null) {
        return null;
    }
    const text = String(raw).trim();
    if (text === '') {
        return null;
    }

    let sum = 0n;
    let nodeIds = 0;
    for (const term of text.split('+').map(t => t.trim())) {
        if (/^\$NODEID$/i.test(term)) {
            nodeIds++;
        } else if (/^-?0x[0-9a-f]+$/i.test(term)) {
            const negative = term.startsWith('-');
            const value = BigInt(term.replace('-', ''));
            sum += negative ? -value : value;
        } else if (/^-?\d+$/.test(term)) {
            sum += BigInt(term);
        } else {
            return null;
        }
    }
    return nodeIds > 1 ? null : sum;
}

/**
 * Check the TPDOs or RPDOs: mapping targets, bit length, and COB-IDs.
 * @param {object} objects - objects dictionary.
 * @param {boolean} isRx
 * @param {Function} add - finding callback.
 * @private
 */
function _checkPdos(objects, isRx, add) {
    const kind = isRx ? 'RPDO' : 'TPDO';
    const pdos = isRx ? getRxPdos(objects) : getTxPdos(objects);
    const cobIds = new Map();

    for (const pdo of pdos) {
        const label = `${kind} ${pdo.id}`;
        const mapping = objects[pdo.mappingIndex];
        if (!mapping) {
            add('error', pdo.commIndex, null,
                `${label} has no mapping object 0x${_hex(pdo.mappingIndex)}`);
        } else {
            const count = _parseInteger(mapping.subObjects?.[0]?.defaultValue);
            if (count !== null && count > BigInt(PDO_MAX_MAPPINGS)) {
                add('error', pdo.mappingIndex, 0,
                    `${label} maps ${count} objects, the maximum is ${PDO_MAX_MAPPINGS}`);
            }
            if (count !== null && count > 0n && !mapping.subObjects?.[Number(count)]) {
                add('error', pdo.mappingIndex, 0,
                    `${label} maps ${count} objects, but sub-index ${count} is missing`);
            }
        }

        let bits = 0;
        for (const [n, m] of pdo.mappings.entries()) {
            bits += m.bits;
            _checkMapping(objects, isRx, pdo, n + 1, m, add);
        }
        if (bits > 64) {
            add('error', pdo.mappingIndex, null, `${label} maps ${bits} bits, the maximum is 64`);
        }

        if (!pdo.disabled) {
            const raw = String(objects[pdo.commIndex].subObjects?.[1]?.defaultValue ?? '');
            const key = `${/\$NODEID/i.test(raw) ? '$NODEID+' : ''}${pdo.cobId}`;
            if (cobIds.has(key)) {
                add('error', pdo.commIndex, 1,
                    `${label} uses the same COB-ID as ${kind} ${cobIds.get(key)}`);
            } else {
                cobIds.set(key, pdo.id);
            }
        }
    }
}

/**
 * Check one PDO mapping entry.
 * @param {object} objects - objects dictionary.
 * @param {boolean} isRx
 * @param {object} pdo - PDO from getTxPdos or getRxPdos.
 * @param {number} slot - mapping sub-index.
 * @param {{index: number, subIndex: number, bits: number}} m - the mapping.
 * @param {Function} add - finding callback.
 * @private
 */
function _checkMapping(objects, isRx, pdo, slot, m, add) {
    const label = `${isRx ? 'RPDO' : 'TPDO'} ${pdo.id} entry ${slot}`;
    const target = `0x${_hex(m.index)}.${m.subIndex}`;

    if (m.index <= DUMMY_MAX && m.subIndex === 0) {
        if (!isRx) {
            add('error', pdo.mappingIndex, slot, `${label} maps dummy type ${target}, which only an RPDO can map`);
        }
        return;
    }

    const entry = objects[m.index];
    let obj = null;
    if (entry && isContainerType(entry.objectType)) {
        obj = entry.subObjects?.[m.subIndex] ?? null;
    } else if (entry && m.subIndex === 0) {
        obj = entry;
    }

    if (!obj) {
        add('error', pdo.mappingIndex, slot, `${label} maps ${target}, which does not exist`);
        return;
    }

    if (!obj.pdoMapping) {
        add('error', pdo.mappingIndex, slot, `${label} maps ${target}, which has PDOMapping=0`);
    }

    const size = dataTypeSize(obj.dataType);
    if (size !== null && m.bits !== size * 8) {
        add('warning', pdo.mappingIndex, slot,
            `${label} maps ${m.bits} bits of ${target}, which has ${size * 8} bits`);
    }

    const readOnly = [AccessType.READ_ONLY, AccessType.CONSTANT].includes(obj.accessType);
    if (isRx && readOnly) {
        add('warning', pdo.mappingIndex, slot, `${label} writes ${target}, which is read only`);
    }
    if (!isRx && obj.accessType === AccessType.WRITE_ONLY) {
        add('warning', pdo.mappingIndex, slot, `${label} reads ${target}, which is write only`);
    }
}

/**
 * Format an index as 4 hex digits.
 * @param {number} n
 * @returns {string}
 * @private
 */
function _hex(n) {
    return n.toString(16).toUpperCase().padStart(4, '0');
}

module.exports = { validateEds };
