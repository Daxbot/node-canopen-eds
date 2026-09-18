/**
 * @file EDS model utilities - helpers for working with the in-memory EDS model.
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { ObjectType, DataType, AccessType } = require('./types');

/**
 * Create a VAR entry for the DS301 profile template.
 * @param {string} parameterName
 * @param {number} dataType
 * @param {string} accessType
 * @param {string} defaultValue
 * @param {object} [extra] - Extra fields such as pdoMapping or storageLocation.
 * @returns {object}
 */
function _var(parameterName, dataType, accessType, defaultValue, extra = {}) {
    return {
        parameterName,
        objectType: ObjectType.VAR,
        dataType,
        accessType,
        defaultValue,
        pdoMapping: false,
        ...extra,
    };
}

/**
 * Create an ARRAY or RECORD entry for the DS301 profile template.
 * @param {string} parameterName
 * @param {number} objectType
 * @param {Array<[number, object]>} subs - [subIndex, entry] pairs.
 * @param {string} [storageLocation]
 * @returns {object}
 */
function _container(parameterName, objectType, subs, storageLocation) {
    const entry = { parameterName, objectType, subObjects: Object.fromEntries(subs) };
    if (storageLocation) {
        entry.storageLocation = storageLocation;
    }
    return entry;
}

/**
 * Create sub-index 0 ("Highest sub-index supported") for a container.
 * @param {string} defaultValue
 * @returns {object}
 */
function _sub0(defaultValue) {
    return _var('Highest sub-index supported', DataType.UNSIGNED8, AccessType.READ_ONLY, defaultValue);
}

/**
 * Build the communication-profile objects of CANopenNode's
 * example/DS301_profile.eds: every CiA 301 object that CANopenNode uses,
 * with 4 RPDOs and 4 TPDOs.
 * @returns {object} Index-keyed objects dictionary.
 */
function _createDs301Objects() {
    const U8 = DataType.UNSIGNED8;
    const U16 = DataType.UNSIGNED16;
    const U32 = DataType.UNSIGNED32;
    const RO = AccessType.READ_ONLY;
    const RW = AccessType.READ_WRITE;
    const COMM = { storageLocation: 'PERSIST_COMM' };

    const objects = {
        0x1000: _var('Device type', U32, RO, '0x00000000', COMM),
        0x1001: _var('Error register', U8, RO, '0x00', { pdoMapping: true }),
        0x1003: _container('Pre-defined error field', ObjectType.ARRAY, [
            [0, _var('Number of errors', U8, RW, '')],
            ...Array.from({ length: 16 }, (_, i) => [i + 1, _var('Standard error field', U32, RO, '')]),
        ]),
        0x1005: _var('COB-ID SYNC message', U32, RW, '0x00000080', COMM),
        0x1006: _var('Communication cycle period', U32, RW, '0', COMM),
        0x1007: _var('Synchronous window length', U32, RW, '0', COMM),
        0x1010: _container('Store parameters', ObjectType.ARRAY, [
            [0, _sub0('0x04')],
            [1, _var('Save all parameters', U32, RW, '0x00000001')],
            [2, _var('Save communication parameters', U32, RW, '0x00000001')],
            [3, _var('Save application parameters', U32, RW, '0x00000001')],
            [4, _var('Save manufacturer defined parameters', U32, RW, '0x00000001')],
        ]),
        0x1011: _container('Restore default parameters', ObjectType.ARRAY, [
            [0, _sub0('0x04')],
            [1, _var('Restore all default parameters', U32, RW, '0x00000001')],
            [2, _var('Restore communication default parameters', U32, RW, '0x00000001')],
            [3, _var('Restore application default parameters', U32, RW, '0x00000001')],
            [4, _var('Restore manufacturer defined default parameters', U32, RW, '0x00000001')],
        ]),
        0x1012: _var('COB-ID time stamp object', U32, RW, '0x00000100', COMM),
        0x1014: _var('COB-ID EMCY', U32, RW, '$NODEID+0x80', COMM),
        0x1015: _var('Inhibit time EMCY', U16, RW, '0', COMM),
        0x1016: _container('Consumer heartbeat time', ObjectType.ARRAY, [
            [0, _sub0('0x08')],
            ...Array.from({ length: 8 }, (_, i) => [i + 1, _var('Consumer heartbeat time', U32, RW, '0x00000000')]),
        ], 'PERSIST_COMM'),
        0x1017: _var('Producer heartbeat time', U16, RW, '0', COMM),
        0x1018: _container('Identity', ObjectType.RECORD, [
            [0, _sub0('0x04')],
            [1, _var('Vendor-ID', U32, RO, '0x00000000')],
            [2, _var('Product code', U32, RO, '0x00000000')],
            [3, _var('Revision number', U32, RO, '0x00000000')],
            [4, _var('Serial number', U32, RO, '0x00000000')],
        ], 'PERSIST_COMM'),
        0x1019: _var('Synchronous counter overflow value', U8, RW, '0', COMM),
        0x1200: _container('SDO server parameter', ObjectType.RECORD, [
            [0, _sub0('2')],
            [1, _var('COB-ID client to server (rx)', U32, RO, '$NODEID+0x600', { pdoMapping: true })],
            [2, _var('COB-ID server to client (tx)', U32, RO, '$NODEID+0x580', { pdoMapping: true })],
        ]),
        0x1280: _container('SDO client parameter', ObjectType.RECORD, [
            [0, _sub0('0x03')],
            [1, _var('COB-ID client to server (tx)', U32, RW, '0x80000000', { pdoMapping: true })],
            [2, _var('COB-ID server to client (rx)', U32, RW, '0x80000000', { pdoMapping: true })],
            [3, _var('Node-ID of the SDO server', U8, RW, '0x01')],
        ], 'PERSIST_COMM'),
    };

    // PDO mapping: 8 empty application-object slots.
    const mapping = (name) => _container(name, ObjectType.RECORD, [
        [0, _var('Number of mapped application objects in PDO', U8, RW, '0')],
        ...Array.from({ length: 8 }, (_, i) => [i + 1, _var(`Application object ${i + 1}`, U32, RW, '0x00000000')]),
    ], 'PERSIST_COMM');

    // 4 RPDOs and 4 TPDOs. COB-IDs follow the predefined connection set
    // (RPDO n = 0x100 + n * 0x100, TPDO n = 0x80 + n * 0x100) and start
    // disabled (bit 31). TPDOs also set bit 30 (no RTR allowed).
    for (let n = 0; n < 4; n++) {
        const rpdoCobId = (0x80000200 + n * 0x100).toString(16).toUpperCase();
        const tpdoCobId = (0xC0000180 + n * 0x100).toString(16).toUpperCase();

        objects[0x1400 + n] = _container('RPDO communication parameter', ObjectType.RECORD, [
            [0, _sub0('0x05')],
            [1, _var('COB-ID used by RPDO', U32, RW, `$NODEID+0x${rpdoCobId}`)],
            [2, _var('Transmission type', U8, RW, '254')],
            [5, _var('Event timer', U16, RW, '0')],
        ], 'PERSIST_COMM');
        objects[0x1600 + n] = mapping('RPDO mapping parameter');

        objects[0x1800 + n] = _container('TPDO communication parameter', ObjectType.RECORD, [
            [0, _sub0('0x06')],
            [1, _var('COB-ID used by TPDO', U32, RW, `$NODEID+0x${tpdoCobId}`)],
            [2, _var('Transmission type', U8, RW, '254')],
            [3, _var('Inhibit time', U16, RW, '0')],
            [5, _var('Event timer', U16, RW, '0')],
            [6, _var('SYNC start value', U8, RW, '0')],
        ], 'PERSIST_COMM');
        objects[0x1A00 + n] = mapping('TPDO mapping parameter');
    }

    return objects;
}

/**
 * Create an EdsModel plain object pre-populated with the communication
 * profile of CANopenNode's example/DS301_profile.eds (see
 * _createDs301Objects). The result exports to an OD.h/OD.c that builds
 * against CANopenNode's default configuration.
 * @param {string} [productName]
 * @returns {object} EdsModel plain object.
 */
function createEmptyEds(productName = 'New Device') {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const yyyy = now.getFullYear();
    const date = `${mm}-${dd}-${yyyy}`;
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) {
        h -= 12;
    }
    if (h === 0) {
        h = 12;
    }
    const time = `${h}:${m}${ampm}`;

    return {
        fileInfo: {
            fileName: `${productName}.eds`,
            fileVersion: '1',
            fileRevision: '1',
            edsVersion: '4.0',
            description: '',
            creationTime: time,
            creationDate: date,
            createdBy: '',
            modificationTime: time,
            modificationDate: date,
            modifiedBy: '',
        },
        deviceInfo: {
            vendorName: '',
            vendorNumber: '0x00000000',
            productName,
            productNumber: '0x00000000',
            revisionNumber: '0x00000000',
            orderCode: '',
            baudRate10: false,
            baudRate20: false,
            baudRate50: false,
            baudRate125: true,
            baudRate250: true,
            baudRate500: true,
            baudRate800: false,
            baudRate1000: true,
            simpleBootUpMaster: false,
            simpleBootUpSlave: true,
            granularity: 8,
            dynamicChannelsSupported: 0,
            groupMessaging: false,
            nrOfRXPDO: 4,
            nrOfTXPDO: 4,
            lssSupported: false,
        },
        dummyUsage: {},
        comments: [],
        objects: _createDs301Objects(),
    };
}

/**
 * Return the category key for a given object index.
 * @param {number} index
 * @returns {'communication'|'manufacturer'|'device-profile'|'other'}
 */
function getCategoryForIndex(index) {
    if (index >= 0x1000 && index <= 0x1FFF) {
        return 'communication';
    }
    if (index >= 0x2000 && index <= 0x5FFF) {
        return 'manufacturer';
    }
    if (index >= 0x6000 && index <= 0x9FFF) {
        return 'device-profile';
    }
    return 'other';
}

/**
 * Standard CANopen object dictionary categories.
 * @type {Array<{key: string, label: string, range: string}>}
 */
const CATEGORIES = [
    { key: 'communication', label: 'Communication Specific Parameters', range: '0x1000-0x1FFF' },
    { key: 'manufacturer', label: 'Manufacturer Specific Parameters', range: '0x2000-0x5FFF' },
    { key: 'device-profile', label: 'Device Profile Specific Parameters', range: '0x6000-0x9FFF' },
    { key: 'other', label: 'Other Objects', range: '' },
];

/**
 * Create a minimal VAR entry.
 * @param {string} [parameterName]
 * @returns {object}
 */
function createVarEntry(parameterName = 'New Object') {
    return {
        parameterName,
        objectType: ObjectType.VAR,
        dataType: DataType.UNSIGNED32,
        accessType: AccessType.READ_WRITE,
        defaultValue: '0',
        pdoMapping: false,
    };
}

/**
 * Create a minimal ARRAY entry with a sub-index 0 "Max sub-index" slot.
 * @param {string} [parameterName]
 * @returns {object}
 */
function createArrayEntry(parameterName = 'New Array') {
    return {
        parameterName,
        objectType: ObjectType.ARRAY,
        subObjects: {
            0: {
                parameterName: 'Max sub-index',
                objectType: ObjectType.VAR,
                dataType: DataType.UNSIGNED8,
                accessType: AccessType.READ_ONLY,
                defaultValue: '0',
                pdoMapping: false,
            },
        },
    };
}

/**
 * Create a minimal RECORD entry with a sub-index 0 slot.
 * @param {string} [parameterName]
 * @returns {object}
 */
function createRecordEntry(parameterName = 'New Record') {
    return {
        parameterName,
        objectType: ObjectType.RECORD,
        subObjects: {
            0: {
                parameterName: 'Highest sub-index supported',
                objectType: ObjectType.VAR,
                dataType: DataType.UNSIGNED8,
                accessType: AccessType.READ_ONLY,
                defaultValue: '0',
                pdoMapping: false,
            },
        },
    };
}

/**
 * Create a minimal sub-entry (VAR) suitable for use inside an ARRAY or RECORD.
 * @param {string} [parameterName]
 * @returns {object}
 */
function createSubEntry(parameterName = 'Sub-object') {
    return {
        parameterName,
        objectType: ObjectType.VAR,
        dataType: DataType.UNSIGNED32,
        accessType: AccessType.READ_WRITE,
        defaultValue: '0',
        pdoMapping: false,
    };
}

/**
 * Count the number of RX and TX PDOs in an object dictionary.
 * @param {object} objects
 * @returns {{ rx: number, tx: number }}
 */
function countRxTxPdo(objects) {
    let rx = 0;
    let tx = 0;
    for (const idxStr of Object.keys(objects)) {
        const idx = Number(idxStr);
        if (idx >= 0x1400 && idx <= 0x15FF) {
            rx++;
        }
        if (idx >= 0x1800 && idx <= 0x19FF) {
            tx++;
        }
    }
    return { rx, tx };
}

module.exports = {
    createEmptyEds,
    getCategoryForIndex,
    CATEGORIES,
    createVarEntry,
    createArrayEntry,
    createRecordEntry,
    createSubEntry,
    countRxTxPdo,
};
