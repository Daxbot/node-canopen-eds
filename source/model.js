/**
 * @file EDS model utilities - helpers for working with the in-memory EDS model.
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { ObjectType, DataType, AccessType } = require('./types');

/**
 * Create a minimal valid EdsModel plain object with mandatory objects
 * (0x1000, 0x1001, 0x1018) pre-populated.
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
            granularity: 0,
            dynamicChannelsSupported: 0,
            groupMessaging: false,
            nrOfRXPDO: 0,
            nrOfTXPDO: 0,
            lssSupported: false,
        },
        dummyUsage: {},
        comments: [],
        objects: {
            0x1000: {
                parameterName: 'Device type',
                objectType: ObjectType.VAR,
                dataType: DataType.UNSIGNED32,
                accessType: AccessType.READ_ONLY,
                defaultValue: '0x00000000',
                pdoMapping: false,
            },
            0x1001: {
                parameterName: 'Error register',
                objectType: ObjectType.VAR,
                dataType: DataType.UNSIGNED8,
                accessType: AccessType.READ_ONLY,
                defaultValue: '0',
                pdoMapping: false,
            },
            0x1018: {
                parameterName: 'Identity object',
                objectType: ObjectType.RECORD,
                subObjects: {
                    0: {
                        parameterName: 'Highest sub-index supported',
                        objectType: ObjectType.VAR,
                        dataType: DataType.UNSIGNED8,
                        accessType: AccessType.READ_ONLY,
                        defaultValue: '4',
                        pdoMapping: false,
                    },
                    1: {
                        parameterName: 'Vendor-ID',
                        objectType: ObjectType.VAR,
                        dataType: DataType.UNSIGNED32,
                        accessType: AccessType.READ_ONLY,
                        defaultValue: '0x00000000',
                        pdoMapping: false,
                    },
                    2: {
                        parameterName: 'Product code',
                        objectType: ObjectType.VAR,
                        dataType: DataType.UNSIGNED32,
                        accessType: AccessType.READ_ONLY,
                        defaultValue: '0x00000000',
                        pdoMapping: false,
                    },
                    3: {
                        parameterName: 'Revision number',
                        objectType: ObjectType.VAR,
                        dataType: DataType.UNSIGNED32,
                        accessType: AccessType.READ_ONLY,
                        defaultValue: '0x00000000',
                        pdoMapping: false,
                    },
                    4: {
                        parameterName: 'Serial number',
                        objectType: ObjectType.VAR,
                        dataType: DataType.UNSIGNED32,
                        accessType: AccessType.READ_ONLY,
                        defaultValue: '0x00000000',
                        pdoMapping: false,
                    },
                },
            },
        },
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
