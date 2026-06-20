/**
 * @file Implements a CANopen Electronic Data Sheet (EDS) model.
 *
 * Browser-compatible — no fs, Buffer, or EventEmitter dependencies.
 * Accepts raw EDS INI text rather than file paths.
 * @author Wilkins White
 * @copyright 2024 Daxbot
 */

const { ObjectType, AccessType, DataType } = require('./types');
const { parseEds }     = require('./parse');
const { serializeEds } = require('./serialize');

// ─── Private utilities ────────────────────────────────────────────────────────

/**
 * Parse a decimal or 0x-prefixed hex string/number to integer. @private
 * @param s
 */
function _parseNum(s) {
    if (typeof s === 'number') {
        return s;
    }
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
 * Format a number as a 0x-prefixed uppercase hex string. @private
 * @param n
 * @param padBytes
 */
function _hexStr(n, padBytes = 4) {
    return `0x${(n >>> 0).toString(16).toUpperCase().padStart(padBytes * 2, '0')}`;
}

/**
 * Format a Date to "h:mmAM/PM" (EDS time format). @private
 * @param d
 */
function _formatTime(d) {
    const dt = (d instanceof Date) ? d : new Date();
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

/**
 * Format a Date to "MM-DD-YYYY" (EDS date format). @private
 * @param d
 */
function _formatDate(d) {
    const dt = (d instanceof Date) ? d : new Date();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${mm}-${dd}-${dt.getFullYear()}`;
}

/**
 * Parse EDS time/date strings into a Date object.
 * @param {string} time - "h:mm[AM|PM]"
 * @param {string} date - "MM-DD-YYYY"
 * @returns {Date}
 * @private
 */
function _parseDate(time, date) {
    if (!time || !date) {
        return new Date();
    }
    const pm = time.includes('PM');
    const [hStr, mStr] = time.replace('AM', '').replace('PM', '').split(':');
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (pm && h !== 12) {
        h += 12;
    }
    if (!pm && h === 12) {
        h = 0;
    }
    const [mo, dy, yr] = date.split('-').map(Number);
    return new Date(yr, mo - 1, dy, h, m);
}

/**
 * Build a minimal VAR plain-object entry. @private
 * @param parameterName
 * @param dataType
 * @param accessType
 * @param defaultValue
 */
function _varEntry(parameterName, dataType, accessType, defaultValue) {
    const e = { parameterName, objectType: ObjectType.VAR, dataType, accessType, pdoMapping: false };
    if (defaultValue !== undefined) {
        e.defaultValue = String(defaultValue);
    }
    return e;
}

/**
 * Ensure an ARRAY entry exists at `objects[index]`, creating it with a
 * sub-index 0 "Max sub-index" entry if absent. Returns the subObjects map.
 * @param objects
 * @param index
 * @param parameterName
 * @private
 */
function _ensureArray(objects, index, parameterName) {
    if (!objects[index]) {
        objects[index] = {
            parameterName,
            objectType: ObjectType.ARRAY,
            subObjects: {
                0: _varEntry('Max sub-index', DataType.UNSIGNED8, AccessType.READ_ONLY, '0'),
            },
        };
    }
    return objects[index].subObjects;
}

/**
 * Update the "Max sub-index" (sub-index 0) of a subObjects map to reflect
 * the highest occupied non-zero sub-index.
 * @param subs
 * @private
 */
function _updateMaxSub(subs) {
    const indices = Object.keys(subs).map(Number).filter(n => n > 0);
    subs[0].defaultValue = indices.length > 0 ? String(Math.max(...indices)) : '0';
}

/**
 * Build the three sub-entries shared by SDO server and client parameter records.
 * @param objects
 * @param index
 * @param parameterName
 * @param sub1Label
 * @param sub1Val
 * @param sub2Label
 * @param sub2Val
 * @param sub3Label
 * @param sub3Val
 * @param options
 * @private
 */
function _makeSdoRecord(objects, index, parameterName,
    sub1Label, sub1Val, sub2Label, sub2Val, sub3Label, sub3Val, options) {

    const access = options.accessType || AccessType.READ_WRITE;
    objects[index] = {
        parameterName: options.parameterName || parameterName,
        objectType: ObjectType.RECORD,
        subObjects: {
            0: _varEntry('Max sub-index',  DataType.UNSIGNED8,  AccessType.READ_ONLY, '3'),
            1: _varEntry(sub1Label, DataType.UNSIGNED32, access, _hexStr(sub1Val)),
            2: _varEntry(sub2Label, DataType.UNSIGNED32, access, _hexStr(sub2Val)),
            3: _varEntry(sub3Label, DataType.UNSIGNED8,  access, String(sub3Val)),
        },
    };
}

/**
 * Build the comm + mapping objects for one PDO (RPDO or TPDO).
 * @param objects
 * @param commIndex
 * @param mapIndex
 * @param pdo
 * @param options
 * @param defaultCommName
 * @param defaultMapName
 * @param cobIdLabel
 * @private
 */
function _buildPdo(objects, commIndex, mapIndex, pdo, options,
    defaultCommName, defaultMapName, cobIdLabel) {

    let commName = defaultCommName;
    let mapName  = defaultMapName;
    if (options.parameterName) {
        if (Array.isArray(options.parameterName)) {
            commName = options.parameterName[0] || commName;
            mapName  = options.parameterName[1] || mapName;
        } else {
            commName = options.parameterName;
        }
    }

    const access  = options.accessType || AccessType.READ_WRITE;
    const txType  = pdo.transmissionType !== undefined ? pdo.transmissionType : 254;
    const inhibit = pdo.inhibitTime || 0;
    const event   = pdo.eventTime   || 0;
    const sync    = pdo.syncStart   || 0;

    objects[commIndex] = {
        parameterName: commName,
        objectType: ObjectType.RECORD,
        subObjects: {
            0: _varEntry('Max sub-index',       DataType.UNSIGNED8,  AccessType.READ_ONLY, '6'),
            1: _varEntry(cobIdLabel,            DataType.UNSIGNED32, access, _hexStr(pdo.cobId)),
            2: _varEntry('transmission type',   DataType.UNSIGNED8,  access, String(txType)),
            3: _varEntry('inhibit time',        DataType.UNSIGNED16, access, String(inhibit)),
            4: _varEntry('compatibility entry', DataType.UNSIGNED8,  access, '0'),
            5: _varEntry('event timer',         DataType.UNSIGNED16, access, String(event)),
            6: _varEntry('SYNC start value',    DataType.UNSIGNED8,  access, String(sync)),
        },
    };

    const mapSubs = {
        0: _varEntry('Max sub-index', DataType.UNSIGNED8, AccessType.READ_ONLY,
            String((pdo.dataObjects || []).length)),
    };

    for (let i = 0; i < (pdo.dataObjects || []).length; i++) {
        const obj    = pdo.dataObjects[i];
        const packed = ((obj.index & 0xFFFF) << 16)
            | ((obj.subIndex & 0xFF) << 8)
            | (obj.size & 0xFF);
        mapSubs[i + 1] = _varEntry(
            `Mapped object ${i + 1}`, DataType.UNSIGNED32, access, _hexStr(packed),
        );
    }

    objects[mapIndex] = {
        parameterName: mapName,
        objectType: ObjectType.RECORD,
        subObjects: mapSubs,
    };
}

/**
 * Errors generated due to an improper EDS configuration.
 * @param {string} message - error message.
 */
class EdsError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}

/**
 * A CANopen Electronic Data Sheet (EDS) model.
 *
 * Wraps a plain EdsModel object with a convenient API for reading, mutating,
 * and serializing CANopen EDS v4.0 files. Browser-compatible.
 *
 * Pass a plain object to initialize from metadata, or an EDS INI string to
 * parse an existing file.
 * @param {object|string} [info] - initial metadata object or raw EDS text.
 * @param {string}  [info.fileName]
 * @param {string}  [info.fileVersion]
 * @param {string}  [info.fileRevision]
 * @param {string}  [info.description]
 * @param {Date}    [info.creationDate]
 * @param {string}  [info.createdBy]
 * @param {string}  [info.vendorName]
 * @param {number}  [info.vendorNumber]
 * @param {string}  [info.productName]
 * @param {number}  [info.productNumber]
 * @param {number}  [info.revisionNumber]
 * @param {string}  [info.orderCode]
 * @param {number[]} [info.baudRates] - supported baud rates.
 * @param {boolean} [info.lssSupported]
 * @see CiA306 "Electronic data sheet specification for CANopen"
 */
class Eds {
    constructor(info = {}) {
        this._model = {
            fileInfo: { edsVersion: '4.0' },
            deviceInfo: {
                simpleBootUpMaster:       false,
                simpleBootUpSlave:        false,
                granularity:              8,
                dynamicChannelsSupported: 0,
                groupMessaging:           false,
            },
            dummyUsage: {},
            comments:   [],
            objects:    {},
        };
        this._nameLookup = {};

        if (typeof info === 'string') {
            this.load(info);
        } else if (typeof info === 'object') {
            this.fileName     = info.fileName     || '';
            this.fileVersion  = info.fileVersion  || 1;
            this.fileRevision = info.fileRevision || 1;
            this.description  = info.description  || '';
            this.creationDate = info.creationDate || new Date();
            this.createdBy    = info.createdBy    || '';

            this.vendorName     = info.vendorName     || '';
            this.vendorNumber   = info.vendorNumber   || 0;
            this.productName    = info.productName    || '';
            this.productNumber  = info.productNumber  || 0;
            this.revisionNumber = info.revisionNumber || 0;
            this.orderCode      = info.orderCode      || '';
            this.baudRates      = info.baudRates      || [];
            this.lssSupported   = info.lssSupported   || false;

            // Default data types
            for (const [name, index] of Object.entries(DataType)) {
                this.addEntry(index, {
                    parameterName: name,
                    objectType: ObjectType.DEFTYPE,
                    dataType: DataType[name],
                    accessType: AccessType.READ_WRITE,
                });
            }

            // Mandatory objects: 0x1000, 0x1001, 0x1018
            this.addEntry(0x1000, {
                parameterName: 'Device type',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED32,
                accessType:    AccessType.READ_ONLY,
                defaultValue:  '0x00000000',
            });

            this.setErrorRegister(0);

            this.setIdentity({
                vendorId:       info.vendorNumber   || 0,
                productCode:    info.productNumber  || 0,
                revisionNumber: info.revisionNumber || 0,
                serialNumber:   0,
            });
        }
    }

    // ─── Static ───────────────────────────────────────────────────────────────

    /**
     * Returns true if obj is an instance of Eds.
     * @param {*} obj
     * @returns {boolean}
     */
    static isEds(obj) {
        return obj instanceof Eds;
    }

    /**
     * Create an Eds from raw EDS INI text.
     * @param {string} text - raw EDS file content.
     * @returns {Eds}
     */
    static fromText(text) {
        const eds = new Eds();
        eds.load(text);
        return eds;
    }

    // ─── I/O ──────────────────────────────────────────────────────────────────

    /**
     * Parse raw EDS INI text into this model, replacing any existing data.
     * @param {string} text - raw EDS file content.
     */
    load(text) {
        this._model = parseEds(text);
        this._rebuildNameLookup();
    }

    /**
     * Serialize this model to EDS INI text.
     *
     * Updates ModificationTime/Date before serializing.
     * @param {object} [options]
     * @param {Date}   [options.modificationDate] - override modification date.
     * @param {string} [options.modifiedBy]       - override modifier name.
     * @returns {string} EDS file content (CRLF line endings).
     */
    serialize(options = {}) {
        const now = options.modificationDate || new Date();
        this._model.fileInfo.modificationTime = _formatTime(now);
        this._model.fileInfo.modificationDate = _formatDate(now);
        if (options.modifiedBy !== undefined) {
            this._model.fileInfo.modifiedBy = options.modifiedBy;
        }

        this._model.deviceInfo.nrOfTXPDO = this.nrOfTXPDO;
        this._model.deviceInfo.nrOfRXPDO = this.nrOfRXPDO;

        return serializeEds(this._model);
    }

    // ─── Iteration ────────────────────────────────────────────────────────────

    [Symbol.iterator]() {
        return this.values();
    }

    /**
     * Returns an iterator over the numeric object indices, sorted ascending.
     * @returns {Iterator<number>}
     */
    keys() {
        return Object.keys(this._model.objects)
            .map(Number)
            .sort((a, b) => a - b)
            .values();
    }

    /**
     * Returns an iterator over the entry plain objects, sorted by index.
     * @returns {Iterator<object>}
     */
    values() {
        return Object.keys(this._model.objects)
            .map(Number)
            .sort((a, b) => a - b)
            .map(k => this._model.objects[k])
            .values();
    }

    /**
     * Returns an iterator over [index, entry] pairs, sorted by index.
     * @returns {Iterator<[number, object]>}
     */
    entries() {
        return Object.keys(this._model.objects)
            .map(Number)
            .sort((a, b) => a - b)
            .map(k => [k, this._model.objects[k]])
            .values();
    }

    // ─── FileInfo getters/setters ─────────────────────────────────────────────

    /** @type {string} */
    get fileName() {
        return this._model.fileInfo.fileName || '';
    }
    set fileName(v) {
        this._model.fileInfo.fileName = String(v);
    }

    /** @type {string} */
    get fileVersion() {
        return this._model.fileInfo.fileVersion || '';
    }
    set fileVersion(v) {
        this._model.fileInfo.fileVersion = String(v);
    }

    /** @type {string} */
    get fileRevision() {
        return this._model.fileInfo.fileRevision || '';
    }
    set fileRevision(v) {
        this._model.fileInfo.fileRevision = String(v);
    }

    /** @type {string} */
    get description() {
        return this._model.fileInfo.description || '';
    }
    set description(v) {
        this._model.fileInfo.description = String(v);
    }

    /** @type {string} */
    get createdBy() {
        return this._model.fileInfo.createdBy || '';
    }
    set createdBy(v) {
        this._model.fileInfo.createdBy = String(v);
    }

    /** @type {string} */
    get modifiedBy() {
        return this._model.fileInfo.modifiedBy || '';
    }
    set modifiedBy(v) {
        this._model.fileInfo.modifiedBy = String(v);
    }

    /** @type {Date} */
    get creationDate() {
        return _parseDate(
            this._model.fileInfo.creationTime,
            this._model.fileInfo.creationDate,
        );
    }
    set creationDate(v) {
        this._model.fileInfo.creationTime = _formatTime(v);
        this._model.fileInfo.creationDate = _formatDate(v);
    }

    /** @type {Date} */
    get modificationDate() {
        return _parseDate(
            this._model.fileInfo.modificationTime,
            this._model.fileInfo.modificationDate,
        );
    }
    set modificationDate(v) {
        this._model.fileInfo.modificationTime = _formatTime(v);
        this._model.fileInfo.modificationDate = _formatDate(v);
    }

    // ─── DeviceInfo getters/setters ───────────────────────────────────────────

    /** Vendor name (max 244 characters). @type {string} */
    get vendorName() {
        return this._model.deviceInfo.vendorName || '';
    }
    set vendorName(v) {
        this._model.deviceInfo.vendorName = String(v);
    }

    /** Unique vendor ID (32-bit unsigned integer). @type {number} */
    get vendorNumber() {
        return _parseNum(this._model.deviceInfo.vendorNumber) || 0;
    }
    set vendorNumber(v) {
        this._model.deviceInfo.vendorNumber = _hexStr(v);
    }

    /** Product name (max 243 characters). @type {string} */
    get productName() {
        return this._model.deviceInfo.productName || '';
    }
    set productName(v) {
        this._model.deviceInfo.productName = String(v);
    }

    /** Product code (32-bit unsigned integer). @type {number} */
    get productNumber() {
        return _parseNum(this._model.deviceInfo.productNumber) || 0;
    }
    set productNumber(v) {
        this._model.deviceInfo.productNumber = _hexStr(v);
    }

    /** Revision number (32-bit unsigned integer). @type {number} */
    get revisionNumber() {
        return _parseNum(this._model.deviceInfo.revisionNumber) || 0;
    }
    set revisionNumber(v) {
        this._model.deviceInfo.revisionNumber = _hexStr(v);
    }

    /** Product order code (max 245 characters). @type {string} */
    get orderCode() {
        return this._model.deviceInfo.orderCode || '';
    }
    set orderCode(v) {
        this._model.deviceInfo.orderCode = String(v);
    }

    /** Supported baud rates. @type {number[]} */
    get baudRates() {
        const d = this._model.deviceInfo;
        const rates = [];
        if (d.baudRate10)   {
            rates.push(10000);
        }
        if (d.baudRate20)   {
            rates.push(20000);
        }
        if (d.baudRate50)   {
            rates.push(50000);
        }
        if (d.baudRate125)  {
            rates.push(125000);
        }
        if (d.baudRate250)  {
            rates.push(250000);
        }
        if (d.baudRate500)  {
            rates.push(500000);
        }
        if (d.baudRate800)  {
            rates.push(800000);
        }
        if (d.baudRate1000) {
            rates.push(1000000);
        }
        return rates;
    }
    set baudRates(rates) {
        const d = this._model.deviceInfo;
        d.baudRate10   = rates.includes(10000);
        d.baudRate20   = rates.includes(20000);
        d.baudRate50   = rates.includes(50000);
        d.baudRate125  = rates.includes(125000);
        d.baudRate250  = rates.includes(250000);
        d.baudRate500  = rates.includes(500000);
        d.baudRate800  = rates.includes(800000);
        d.baudRate1000 = rates.includes(1000000);
    }

    /** @type {boolean} */
    get simpleBootUpMaster() {
        return !!this._model.deviceInfo.simpleBootUpMaster;
    }
    set simpleBootUpMaster(v) {
        this._model.deviceInfo.simpleBootUpMaster = !!v;
    }

    /** @type {boolean} */
    get simpleBootUpSlave() {
        return !!this._model.deviceInfo.simpleBootUpSlave;
    }
    set simpleBootUpSlave(v) {
        this._model.deviceInfo.simpleBootUpSlave = !!v;
    }

    /** PDO mapping granularity (8-bit integer, max 64). @type {number} */
    get granularity() {
        return this._model.deviceInfo.granularity ?? 0;
    }
    set granularity(v) {
        this._model.deviceInfo.granularity = Number(v);
    }

    /** @type {number} */
    get dynamicChannelsSupported() {
        return this._model.deviceInfo.dynamicChannelsSupported ?? 0;
    }
    set dynamicChannelsSupported(v) {
        this._model.deviceInfo.dynamicChannelsSupported = Number(v);
    }

    /** @type {boolean} */
    get groupMessaging() {
        return !!this._model.deviceInfo.groupMessaging;
    }
    set groupMessaging(v) {
        this._model.deviceInfo.groupMessaging = !!v;
    }

    /** @type {boolean} */
    get lssSupported() {
        return !!this._model.deviceInfo.lssSupported;
    }
    set lssSupported(v) {
        this._model.deviceInfo.lssSupported = !!v;
    }

    /** Number of supported receive PDOs (0x1400–0x15FF). @type {number} */
    get nrOfRXPDO() {
        let count = 0;
        for (const k of Object.keys(this._model.objects)) {
            const idx = Number(k);
            if (idx >= 0x1400 && idx <= 0x15FF) {
                count++;
            }
        }
        return count;
    }

    /** Number of supported transmit PDOs (0x1800–0x19FF). @type {number} */
    get nrOfTXPDO() {
        let count = 0;
        for (const k of Object.keys(this._model.objects)) {
            const idx = Number(k);
            if (idx >= 0x1800 && idx <= 0x19FF) {
                count++;
            }
        }
        return count;
    }

    // ─── Object access ────────────────────────────────────────────────────────

    /**
     * Get all entries whose parameterName matches the given string.
     * @param {string} name
     * @returns {object[]}
     */
    findEntry(name) {
        return this._nameLookup[name] || [];
    }

    /**
     * Get an entry by numeric index or by parameter name.
     * @param {number|string} index - numeric index or parameter name.
     * @returns {object|undefined}
     */
    getEntry(index) {
        if (typeof index === 'string') {
            const found = this.findEntry(index);
            if (found.length > 1) {
                throw new EdsError(`duplicate entry name '${index}'`);
            }
            return found[0];
        }
        return this._model.objects[index];
    }

    /**
     * Add a new entry to the object dictionary.
     *
     * For ARRAY/RECORD types, `subObjects` is initialized with a sub-index 0
     * ("Max sub-index") entry if not already present in `data`.
     * @param {number} index - object index.
     * @param {object} data  - entry fields (parameterName, objectType, …).
     * @returns {object} the stored entry.
     */
    addEntry(index, data) {
        if (typeof index !== 'number') {
            throw new TypeError('index must be a number');
        }

        if (this._model.objects[index] !== undefined) {
            throw new EdsError(`0x${index.toString(16)} already exists`);
        }

        const entry = { ...data };

        const isContainer =
            entry.objectType === ObjectType.ARRAY   ||
            entry.objectType === ObjectType.RECORD  ||
            entry.objectType === ObjectType.DEFSTRUCT;

        if (isContainer && !entry.subObjects) {
            entry.subObjects = {
                0: _varEntry('Max sub-index', DataType.UNSIGNED8, AccessType.READ_ONLY, '0'),
            };
        }

        this._model.objects[index] = entry;
        this._registerName(entry);
        return entry;
    }

    /**
     * Remove an entry from the object dictionary.
     * @param {number} index
     * @returns {object} the removed entry.
     */
    removeEntry(index) {
        const entry = this.getEntry(index);
        if (entry === undefined) {
            throw new EdsError(`0x${index.toString(16)} does not exist`);
        }

        this._unregisterName(entry);
        delete this._model.objects[index];
        return entry;
    }

    /**
     * Get a sub-entry by index and sub-index.
     * @param {number|string} index
     * @param {number} subIndex
     * @returns {object|null}
     */
    getSubEntry(index, subIndex) {
        const entry = this.getEntry(index);
        if (entry === undefined) {
            throw new EdsError(`0x${index.toString(16)} does not exist`);
        }
        if (!entry.subObjects) {
            throw new EdsError(`0x${index.toString(16)} does not support sub objects`);
        }
        return entry.subObjects[subIndex] || null;
    }

    /**
     * Add a new sub-entry.
     * @param {number} index
     * @param {number} subIndex
     * @param {object} data
     * @returns {object} the stored sub-entry.
     */
    addSubEntry(index, subIndex, data) {
        const entry = this.getEntry(index);
        if (entry === undefined) {
            throw new EdsError(`0x${index.toString(16)} does not exist`);
        }
        if (!entry.subObjects) {
            throw new EdsError(`0x${index.toString(16)} does not support sub objects`);
        }

        const sub = { ...data };
        entry.subObjects[subIndex] = sub;
        this._updateMaxSubIndex(entry.subObjects);
        return sub;
    }

    /**
     * Remove a sub-entry.
     * @param {number} index
     * @param {number} subIndex
     */
    removeSubEntry(index, subIndex) {
        if (subIndex < 1) {
            throw new EdsError('subIndex must be >= 1');
        }

        const entry = this.getEntry(index);
        if (entry === undefined) {
            throw new EdsError(`0x${index.toString(16)} does not exist`);
        }
        if (!entry.subObjects) {
            throw new EdsError(`0x${index.toString(16)} does not support sub objects`);
        }

        delete entry.subObjects[subIndex];
        this._updateMaxSubIndex(entry.subObjects);
    }

    // ─── CANopen object helpers ───────────────────────────────────────────────

    /**
     * Get object 0x1001 - Error register.
     * @returns {number|null}
     */
    getErrorRegister() {
        const obj = this.getEntry(0x1001);
        return obj ? (_parseNum(obj.defaultValue) || 0) : null;
    }

    /**
     * Set object 0x1001 - Error register.
     *
     * Pass a raw number to set the whole register, or an object with boolean
     * flag fields (generic, current, voltage, temperature, communication,
     * device, manufacturer) to set individual bits.
     * @param {number|object} flags
     */
    setErrorRegister(flags) {
        let obj = this.getEntry(0x1001);
        if (!obj) {
            obj = this.addEntry(0x1001, {
                parameterName: 'Error register',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED8,
                accessType:    AccessType.READ_ONLY,
                defaultValue:  '0',
            });
        }

        let value = _parseNum(obj.defaultValue) || 0;
        if (typeof flags !== 'object') {
            value = Number(flags);
        } else {
            const set   = (bit) => {
                value |=  (1 << bit);
            };
            const clear = (bit) => {
                value &= ~(1 << bit);
            };
            if (flags.generic       !== undefined) {
                flags.generic       ? set(0) : clear(0);
            }
            if (flags.current       !== undefined) {
                flags.current       ? set(1) : clear(1);
            }
            if (flags.voltage       !== undefined) {
                flags.voltage       ? set(2) : clear(2);
            }
            if (flags.temperature   !== undefined) {
                flags.temperature   ? set(3) : clear(3);
            }
            if (flags.communication !== undefined) {
                flags.communication ? set(4) : clear(4);
            }
            if (flags.device        !== undefined) {
                flags.device        ? set(5) : clear(5);
            }
            if (flags.manufacturer  !== undefined) {
                flags.manufacturer  ? set(7) : clear(7);
            }
        }
        obj.defaultValue = String(value);
    }

    /**
     * Get object 0x1002 - Manufacturer status register.
     * @returns {number|null}
     */
    getStatusRegister() {
        const obj = this.getEntry(0x1002);
        return obj ? (_parseNum(obj.defaultValue) || 0) : null;
    }

    /**
     * Set object 0x1002 - Manufacturer status register.
     * @param {number} status
     */
    setStatusRegister(status) {
        let obj = this.getEntry(0x1002);
        if (!obj) {
            obj = this.addEntry(0x1002, {
                parameterName: 'Manufacturer status register',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED32,
                accessType:    AccessType.READ_ONLY,
            });
        }
        obj.defaultValue = _hexStr(status);
    }

    /**
     * Get object 0x1003 - Pre-defined error field.
     *
     * Returns entries where the error code (bits 0–15 of the packed UINT32)
     * is non-zero.
     * @returns {Array<{code: number, info: number}>}
     */
    getErrorHistory() {
        const history = [];
        const obj = this.getEntry(0x1003);
        if (obj && obj.subObjects) {
            const maxSub = _parseNum(obj.subObjects[0]?.defaultValue) || 0;
            for (let i = 1; i <= maxSub; i++) {
                const sub = obj.subObjects[i];
                if (!sub) {
                    continue;
                }
                const packed = _parseNum(sub.defaultValue) || 0;
                const code   = packed & 0xFFFF;
                const info   = (packed >>> 16) & 0xFFFF;
                if (code) {
                    history.push({ code, info });
                }
            }
        }
        return history;
    }

    /**
     * Push an entry to object 0x1003 - Pre-defined error field.
     *
     * Existing entries are shifted down before writing the new value to
     * sub-index 1. The packed UINT32 format is: bits 0–15 = error code,
     * bits 16–31 = additional info.
     * @param {number} code - 16-bit error code.
     * @param {number} [info] - 16-bit additional info.
     */
    pushErrorHistory(code, info = 0) {
        const obj = this.getEntry(0x1003);
        if (!obj || !obj.subObjects) {
            throw new EdsError('0x1003 not configured; call setErrorHistoryLength() first');
        }

        const maxSub = _parseNum(obj.subObjects[0]?.defaultValue) || 0;
        for (let i = maxSub; i > 1; i--) {
            if (obj.subObjects[i] && obj.subObjects[i - 1]) {
                obj.subObjects[i].defaultValue = obj.subObjects[i - 1].defaultValue;
            }
        }
        if (obj.subObjects[1]) {
            const packed = ((_parseNum(info) & 0xFFFF) << 16) | (_parseNum(code) & 0xFFFF);
            obj.subObjects[1].defaultValue = _hexStr(packed);
        }
    }

    /**
     * Configure the length of 0x1003 - Pre-defined error field.
     * @param {number} length - number of historical error events to store.
     * @param {object} [options]
     * @param {AccessType} [options.accessType]
     */
    setErrorHistoryLength(length, options = {}) {
        if (length === undefined || length < 0) {
            throw new EdsError('error field size must be >= 0');
        }

        let obj = this.getEntry(0x1003);
        if (!obj) {
            obj = this.addEntry(0x1003, {
                parameterName: 'Pre-defined error field',
                objectType:    ObjectType.ARRAY,
            });
        }

        const subs = obj.subObjects;
        const current = Object.keys(subs).map(Number).filter(n => n > 0).length;

        for (let i = current; i > length; i--) {
            delete subs[i];
        }

        for (let i = current + 1; i <= length; i++) {
            subs[i] = _varEntry(
                `Standard error field ${i}`,
                DataType.UNSIGNED32,
                options.accessType || AccessType.READ_WRITE,
                '0',
            );
        }
        subs[0].defaultValue = String(length);
    }

    /**
     * Get object 0x1005 - COB-ID SYNC.
     * @returns {number|null} 11-bit COB-ID, or null if not configured.
     */
    getSyncCobId() {
        const bits = this._getCobIdBits(0x1005);
        return bits !== null ? (bits & 0x7FF) : null;
    }

    /**
     * Set object 0x1005 - COB-ID SYNC.
     * @param {number} cobId - typically 0x80.
     * @param {object} [options]
     * @param {AccessType} [options.accessType]
     */
    setSyncCobId(cobId, options = {}) {
        if (!cobId) {
            throw new EdsError('COB-ID SYNC may not be 0');
        }
        const obj = this._getOrCreateCobId(0x1005, 'COB-ID SYNC', options.accessType);
        const cur = _parseNum(obj.defaultValue) >>> 0;
        obj.defaultValue = _hexStr((cur & ~0x7FF) | (cobId & 0x7FF));
    }

    /**
     * Get object 0x1005 [bit 30] - Sync generation enable.
     * @returns {boolean}
     */
    getSyncGenerationEnable() {
        const bits = this._getCobIdBits(0x1005);
        return bits !== null ? !!(bits & (1 << 30)) : false;
    }

    /**
     * Set object 0x1005 [bit 30] - Sync generation enable.
     * @param {boolean} enable
     * @param {object} [options]
     */
    setSyncGenerationEnable(enable, options = {}) {
        const obj = this._getOrCreateCobId(0x1005, 'COB-ID SYNC', options.accessType);
        let bits = _parseNum(obj.defaultValue) >>> 0;
        obj.defaultValue = _hexStr(enable ? (bits | (1 << 30)) : (bits & ~(1 << 30)));
    }

    /**
     * Get object 0x1006 - Communication cycle period.
     * @returns {number|null} interval in μs.
     */
    getSyncCyclePeriod() {
        const obj = this.getEntry(0x1006);
        return obj ? (_parseNum(obj.defaultValue) || 0) : null;
    }

    /**
     * Set object 0x1006 - Communication cycle period.
     * @param {number} cyclePeriod - interval in μs.
     * @param {object} [options]
     * @param {AccessType} [options.accessType]
     */
    setSyncCyclePeriod(cyclePeriod, options = {}) {
        if (!cyclePeriod) {
            throw new EdsError('communication cycle period may not be 0');
        }
        let obj = this.getEntry(0x1006);
        if (!obj) {
            obj = this.addEntry(0x1006, {
                parameterName: 'Communication cycle period',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED32,
                accessType:    options.accessType || AccessType.READ_WRITE,
            });
        }
        obj.defaultValue = String(cyclePeriod);
    }

    /**
     * Get object 0x1008 - Manufacturer device name.
     * @returns {string}
     */
    getDeviceName() {
        const obj = this.getEntry(0x1008);
        return obj ? (obj.defaultValue || '') : '';
    }

    /**
     * Set object 0x1008 - Manufacturer device name.
     * @param {string} name
     */
    setDeviceName(name) {
        let obj = this.getEntry(0x1008);
        if (!obj) {
            obj = this.addEntry(0x1008, {
                parameterName: 'Manufacturer device name',
                objectType:    ObjectType.VAR,
                dataType:      DataType.VISIBLE_STRING,
                accessType:    AccessType.CONSTANT,
            });
        }
        obj.defaultValue = String(name);
    }

    /**
     * Get object 0x1009 - Manufacturer hardware version.
     * @returns {string}
     */
    getHardwareVersion() {
        const obj = this.getEntry(0x1009);
        return obj ? (obj.defaultValue || '') : '';
    }

    /**
     * Set object 0x1009 - Manufacturer hardware version.
     * @param {string} version
     */
    setHardwareVersion(version) {
        let obj = this.getEntry(0x1009);
        if (!obj) {
            obj = this.addEntry(0x1009, {
                parameterName: 'Manufacturer hardware version',
                objectType:    ObjectType.VAR,
                dataType:      DataType.VISIBLE_STRING,
                accessType:    AccessType.CONSTANT,
            });
        }
        obj.defaultValue = String(version);
    }

    /**
     * Get object 0x100A - Manufacturer software version.
     * @returns {string}
     */
    getSoftwareVersion() {
        const obj = this.getEntry(0x100A);
        return obj ? (obj.defaultValue || '') : '';
    }

    /**
     * Set object 0x100A - Manufacturer software version.
     * @param {string} version
     */
    setSoftwareVersion(version) {
        let obj = this.getEntry(0x100A);
        if (!obj) {
            obj = this.addEntry(0x100A, {
                parameterName: 'Manufacturer software version',
                objectType:    ObjectType.VAR,
                dataType:      DataType.VISIBLE_STRING,
                accessType:    AccessType.CONSTANT,
            });
        }
        obj.defaultValue = String(version);
    }

    /**
     * Get object 0x1012 - COB-ID TIME.
     * @returns {number|null} 11-bit COB-ID, or null if not configured.
     */
    getTimeCobId() {
        const bits = this._getCobIdBits(0x1012);
        return bits !== null ? (bits & 0x7FF) : null;
    }

    /**
     * Set object 0x1012 - COB-ID TIME.
     * @param {number} cobId - typically 0x100.
     * @param {object} [options]
     * @param {AccessType} [options.accessType]
     */
    setTimeCobId(cobId, options = {}) {
        if (!cobId) {
            throw new EdsError('COB-ID TIME may not be 0');
        }
        const obj = this._getOrCreateCobId(0x1012, 'COB-ID TIME', options.accessType);
        const cur = _parseNum(obj.defaultValue) >>> 0;
        obj.defaultValue = _hexStr((cur & ~0x7FF) | (cobId & 0x7FF));
    }

    /**
     * Get object 0x1012 [bit 30] - Time producer enable.
     * @returns {boolean}
     */
    getTimeProducerEnable() {
        const bits = this._getCobIdBits(0x1012);
        return bits !== null ? !!(bits & (1 << 30)) : false;
    }

    /**
     * Set object 0x1012 [bit 30] - Time producer enable.
     * @param {boolean} enable
     * @param {object} [options]
     */
    setTimeProducerEnable(enable, options = {}) {
        const obj = this._getOrCreateCobId(0x1012, 'COB-ID TIME', options.accessType);
        let bits = _parseNum(obj.defaultValue) >>> 0;
        obj.defaultValue = _hexStr(enable ? (bits | (1 << 30)) : (bits & ~(1 << 30)));
    }

    /**
     * Get object 0x1012 [bit 31] - Time consumer enable.
     * @returns {boolean}
     */
    getTimeConsumerEnable() {
        const bits = this._getCobIdBits(0x1012);
        return bits !== null ? !!(bits & (1 << 31)) : false;
    }

    /**
     * Set object 0x1012 [bit 31] - Time consumer enable.
     * @param {boolean} enable
     * @param {object} [options]
     */
    setTimeConsumerEnable(enable, options = {}) {
        const obj = this._getOrCreateCobId(0x1012, 'COB-ID TIME', options.accessType);
        let bits = _parseNum(obj.defaultValue) >>> 0;
        obj.defaultValue = _hexStr(enable ? (bits | (1 << 31)) : (bits & ~(1 << 31)));
    }

    /**
     * Get object 0x1014 - COB-ID EMCY.
     * @returns {number|null} 11-bit COB-ID, or null if not configured.
     */
    getEmcyCobId() {
        const bits = this._getCobIdBits(0x1014);
        return bits !== null ? (bits & 0x7FF) : null;
    }

    /**
     * Set object 0x1014 - COB-ID EMCY.
     * @param {number} cobId
     * @param {object} [options]
     */
    setEmcyCobId(cobId, options = {}) {
        const obj = this._getOrCreateCobId(0x1014, 'COB-ID EMCY', options.accessType);
        const cur = _parseNum(obj.defaultValue) >>> 0;
        obj.defaultValue = _hexStr((cur & ~0x7FF) | (cobId & 0x7FF));
    }

    /**
     * Get object 0x1014 [bit 31] - EMCY valid (bit 31 = 0 means valid).
     * @returns {boolean}
     */
    getEmcyValid() {
        const bits = this._getCobIdBits(0x1014);
        return bits !== null ? !(bits & (1 << 31)) : false;
    }

    /**
     * Set object 0x1014 [bit 31] - EMCY valid.
     * @param {boolean} valid
     * @param {object} [options]
     */
    setEmcyValid(valid, options = {}) {
        const obj = this._getOrCreateCobId(0x1014, 'COB-ID EMCY', options.accessType);
        let bits = _parseNum(obj.defaultValue) >>> 0;
        obj.defaultValue = _hexStr(valid ? (bits & ~(1 << 31)) : (bits | (1 << 31)));
    }

    /**
     * Get object 0x1015 - Inhibit time EMCY.
     * @returns {number|null} inhibit time in multiples of 100 μs.
     */
    getEmcyInhibitTime() {
        const obj = this.getEntry(0x1015);
        return obj ? (_parseNum(obj.defaultValue) || 0) : null;
    }

    /**
     * Set object 0x1015 - Inhibit time EMCY.
     * @param {number} inhibitTime - in multiples of 100 μs.
     * @param {object} [options]
     * @param {AccessType} [options.accessType]
     */
    setEmcyInhibitTime(inhibitTime, options = {}) {
        let obj = this.getEntry(0x1015);
        if (!obj) {
            obj = this.addEntry(0x1015, {
                parameterName: 'Inhibit time EMCY',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED16,
                accessType:    options.accessType || AccessType.READ_WRITE,
            });
        }
        obj.defaultValue = String(inhibitTime);
    }

    /**
     * Get object 0x1016 - Consumer heartbeat time.
     * @returns {Array<{deviceId: number, heartbeatTime: number}>}
     */
    getHeartbeatConsumers() {
        const consumers = [];
        const obj = this.getEntry(0x1016);
        if (obj && obj.subObjects) {
            const maxSub = _parseNum(obj.subObjects[0]?.defaultValue) || 0;
            for (let i = 1; i <= maxSub; i++) {
                const sub = obj.subObjects[i];
                if (!sub) {
                    continue;
                }
                const packed        = _parseNum(sub.defaultValue) || 0;
                const heartbeatTime = packed & 0xFFFF;
                const deviceId      = (packed >>> 16) & 0xFF;
                if (deviceId > 0 && deviceId <= 127) {
                    consumers.push({ deviceId, heartbeatTime });
                }
            }
        }
        return consumers;
    }

    /**
     * Add an entry to object 0x1016 - Consumer heartbeat time.
     * @param {number} deviceId - node-ID of the heartbeat producer [1-127].
     * @param {number} timeout  - ms before timeout is reported.
     * @param {object} [options]
     * @param {number}     [options.subIndex]
     * @param {AccessType} [options.accessType]
     */
    addHeartbeatConsumer(deviceId, timeout, options = {}) {
        if (deviceId < 1 || deviceId > 0x7F) {
            throw new RangeError('deviceId must be in range [1-127]');
        }
        if (timeout < 0 || timeout > 0xFFFF) {
            throw new RangeError('timeout must be in range [0-65535]');
        }

        const subs = _ensureArray(this._model.objects, 0x1016, 'Consumer heartbeat time');

        for (const [si, sub] of Object.entries(subs)) {
            if (parseInt(si) > 0) {
                const packed = _parseNum(sub.defaultValue) || 0;
                if (((packed >>> 16) & 0xFF) === deviceId) {
                    throw new EdsError(`consumer for 0x${deviceId.toString(16)} already exists`);
                }
            }
        }

        let subIndex = options.subIndex;
        if (!subIndex) {
            for (let i = 1; i <= 255; i++) {
                if (!subs[i]) {
                    subIndex = i; break;
                }
            }

        }
        if (!subIndex) {
            throw new EdsError('NMT consumer entry full');
        }

        const packed = ((deviceId & 0xFF) << 16) | (timeout & 0xFFFF);
        subs[subIndex] = _varEntry(
            `Device 0x${deviceId.toString(16)}`,
            DataType.UNSIGNED32,
            options.accessType || AccessType.READ_WRITE,
            _hexStr(packed),
        );

        _updateMaxSub(subs);
    }

    /**
     * Remove an entry from object 0x1016 - Consumer heartbeat time.
     * @param {number} deviceId
     */
    removeHeartbeatConsumer(deviceId) {
        const entry = this._model.objects[0x1016];
        if (!entry) {
            return;
        }
        const subs = entry.subObjects;
        for (const si of Object.keys(subs).map(Number).filter(n => n > 0)) {
            const packed = _parseNum(subs[si].defaultValue) || 0;
            if (((packed >>> 16) & 0xFF) === deviceId) {
                delete subs[si];
                _updateMaxSub(subs);
                return;
            }
        }
    }

    /**
     * Get object 0x1017 - Producer heartbeat time.
     * @returns {number|null} heartbeat time in ms.
     */
    getHeartbeatProducerTime() {
        const obj = this.getEntry(0x1017);
        return obj ? (_parseNum(obj.defaultValue) || 0) : null;
    }

    /**
     * Set object 0x1017 - Producer heartbeat time.
     *
     * A value of 0 disables the heartbeat.
     * @param {number} producerTime - heartbeat time in ms.
     * @param {object} [options]
     * @param {AccessType} [options.accessType]
     */
    setHeartbeatProducerTime(producerTime, options = {}) {
        let obj = this.getEntry(0x1017);
        if (!obj) {
            obj = this.addEntry(0x1017, {
                parameterName: 'Producer heartbeat time',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED32,
                accessType:    options.accessType || AccessType.READ_WRITE,
            });
        }
        obj.defaultValue = String(producerTime);
    }

    /**
     * Get object 0x1018 - Identity object.
     * @returns {{vendorId: number, productCode: number, revisionNumber: number, serialNumber: number}|null}
     */
    getIdentity() {
        const obj = this.getEntry(0x1018);
        if (obj && obj.subObjects) {
            return {
                vendorId:       _parseNum(obj.subObjects[1]?.defaultValue) || 0,
                productCode:    _parseNum(obj.subObjects[2]?.defaultValue) || 0,
                revisionNumber: _parseNum(obj.subObjects[3]?.defaultValue) || 0,
                serialNumber:   _parseNum(obj.subObjects[4]?.defaultValue) || 0,
            };
        }
        return null;
    }

    /**
     * Set object 0x1018 - Identity object.
     *
     * Sub-index 1 = Vendor-ID, 2 = Product code, 3 = Revision number,
     * 4 = Serial number.
     * @param {object} identity
     * @param {number} [identity.vendorId]
     * @param {number} [identity.productCode]
     * @param {number} [identity.revisionNumber]
     * @param {number} [identity.serialNumber]
     * @param {object} [options]
     * @param {AccessType} [options.accessType]
     */
    setIdentity(identity, options = {}) {
        let obj = this.getEntry(0x1018);
        if (!obj) {
            obj = this.addEntry(0x1018, {
                parameterName: 'Identity object',
                objectType:    ObjectType.RECORD,
            });
            const access = options.accessType || AccessType.READ_ONLY;
            obj.subObjects[1] = _varEntry('Vendor-ID',       DataType.UNSIGNED32, access);
            obj.subObjects[2] = _varEntry('Product code',    DataType.UNSIGNED32, access);
            obj.subObjects[3] = _varEntry('Revision number', DataType.UNSIGNED32, access);
            obj.subObjects[4] = _varEntry('Serial number',   DataType.UNSIGNED32, access);
            obj.subObjects[0].defaultValue = '4';
        }

        const subs = obj.subObjects;
        if (identity.vendorId       !== undefined && subs[1]) {
            subs[1].defaultValue = _hexStr(identity.vendorId);
        }
        if (identity.productCode    !== undefined && subs[2]) {
            subs[2].defaultValue = _hexStr(identity.productCode);
        }
        if (identity.revisionNumber !== undefined && subs[3]) {
            subs[3].defaultValue = _hexStr(identity.revisionNumber);
        }
        if (identity.serialNumber   !== undefined && subs[4]) {
            subs[4].defaultValue = _hexStr(identity.serialNumber);
        }
    }

    /**
     * Get object 0x1019 - Synchronous counter overflow value.
     * @returns {number|null}
     */
    getSyncOverflow() {
        const obj = this.getEntry(0x1019);
        return obj ? (_parseNum(obj.defaultValue) || 0) : null;
    }

    /**
     * Set object 0x1019 - Synchronous counter overflow value.
     * @param {number} overflow - value in range [0-240].
     * @param {object} [options]
     * @param {AccessType} [options.accessType]
     */
    setSyncOverflow(overflow, options = {}) {
        overflow = overflow & 0xFF;
        let obj = this.getEntry(0x1019);
        if (!obj) {
            obj = this.addEntry(0x1019, {
                parameterName: 'Synchronous counter overflow value',
                objectType:    ObjectType.VAR,
                dataType:      DataType.UNSIGNED8,
                accessType:    options.accessType || AccessType.READ_WRITE,
            });
        }
        obj.defaultValue = String(overflow);
    }

    /**
     * Get object 0x1028 - Emergency consumer COB-IDs.
     * @returns {number[]}
     */
    getEmcyConsumers() {
        const consumers = [];
        const obj = this.getEntry(0x1028);
        if (obj && obj.subObjects) {
            const maxSub = _parseNum(obj.subObjects[0]?.defaultValue) || 0;
            for (let i = 1; i <= maxSub; i++) {
                const sub = obj.subObjects[i];
                if (!sub) {
                    continue;
                }
                const v = _parseNum(sub.defaultValue) || 0;
                if (!(v >>> 31)) {
                    consumers.push(v & 0x7FF);
                }
            }
        }
        return consumers;
    }

    /**
     * Add an entry to object 0x1028 - Emergency consumer object.
     * @param {number} cobId - [0-0x7FF].
     * @param {object} [options]
     * @param {number}     [options.subIndex]
     * @param {string}     [options.parameterName]
     * @param {AccessType} [options.accessType]
     */
    addEmcyConsumer(cobId, options = {}) {
        if (cobId > 0x7FF) {
            throw new RangeError('CAN extended frames not supported');
        }

        const subs = _ensureArray(
            this._model.objects, 0x1028,
            options.parameterName || 'Emergency consumer object',
        );

        for (const si of Object.keys(subs).map(Number).filter(n => n > 0)) {
            const stored = _parseNum(subs[si].defaultValue) || 0;
            if (!(stored >>> 31) && (stored & 0x7FF) === cobId) {
                throw new EdsError(`EMCY consumer 0x${cobId.toString(16)} already exists`);
            }
        }

        let subIndex = options.subIndex;
        if (!subIndex) {
            for (let i = 1; i <= 255; i++) {
                if (!subs[i]) {
                    subIndex = i; break;
                }
            }

        }
        if (!subIndex) {
            throw new EdsError('emergency consumer entry full');
        }

        subs[subIndex] = _varEntry(
            `Emergency consumer ${subIndex}`,
            DataType.UNSIGNED32,
            options.accessType || AccessType.READ_WRITE,
            _hexStr(cobId),
        );

        _updateMaxSub(subs);
    }

    /**
     * Remove an entry from object 0x1028 - Emergency consumer object.
     * @param {number} cobId
     */
    removeEmcyConsumer(cobId) {
        const entry = this._model.objects[0x1028];
        if (!entry) {
            return;
        }
        const subs = entry.subObjects;
        for (const si of Object.keys(subs).map(Number).filter(n => n > 0)) {
            const stored = _parseNum(subs[si].defaultValue) || 0;
            if (!(stored >>> 31) && (stored & 0x7FF) === cobId) {
                delete subs[si];
                _updateMaxSub(subs);
                return;
            }
        }
    }

    /**
     * Get SDO server parameters (0x1200–0x127F).
     * @returns {Array<{cobIdRx: number, cobIdTx: number, deviceId: number}>}
     */
    getSdoServerParameters() {
        const result = [];
        for (let i = 0x1200; i <= 0x127F; i++) {
            const e = this._model.objects[i];
            if (!e || !e.subObjects) {
                continue;
            }
            const parsed = this._parseSdoParameter(e);
            if (parsed) {
                result.push({ cobIdRx: parsed[0], cobIdTx: parsed[1], deviceId: parsed[2] });
            }
        }
        return result;
    }

    /**
     * Add an SDO server parameter object (0x1200–0x127F).
     * @param {number} deviceId  - node-ID of the SDO client [0-127].
     * @param {number} [cobIdTx]
     * @param {number} [cobIdRx]
     * @param {object} [options]
     */
    addSdoServerParameter(deviceId, cobIdTx = 0x580, cobIdRx = 0x600, options = {}) {
        if (deviceId < 0 || deviceId > 0x7F) {
            throw new RangeError('deviceId must be in range [0-127]');
        }

        let index = options.index;
        if (index) {
            if (this._model.objects[index]) {
                throw new EdsError(`index 0x${index.toString(16)} already in use`);
            }
        } else {
            index = 0x1200;
            while (index <= 0x127F && this._model.objects[index]) {
                index++;
            }
            if (index > 0x127F) {
                throw new EdsError('no free SDO server parameter slot (0x1200-0x127F)');
            }
        }

        _makeSdoRecord(this._model.objects, index, 'SDO server parameter',
            'COB-ID client to server', cobIdRx,
            'COB-ID server to client', cobIdTx,
            'Node-ID of the SDO client', deviceId,
            options);
    }

    /**
     * Remove an SDO server parameter object by client device ID.
     * @param {number} deviceId
     */
    removeSdoServerParameter(deviceId) {
        for (let index = 0x1200; index <= 0x127F; index++) {
            const entry = this._model.objects[index];
            if (!entry || !entry.subObjects) {
                continue;
            }
            const sub3 = entry.subObjects[3];
            if (sub3 && _parseNum(sub3.defaultValue) === deviceId) {
                delete this._model.objects[index];
                return;
            }
        }
    }

    /**
     * Get SDO client parameters (0x1280–0x12FF).
     * @returns {Array<{cobIdTx: number, cobIdRx: number, deviceId: number}>}
     */
    getSdoClientParameters() {
        const result = [];
        for (let i = 0x1280; i <= 0x12FF; i++) {
            const e = this._model.objects[i];
            if (!e || !e.subObjects) {
                continue;
            }
            const parsed = this._parseSdoParameter(e);
            if (parsed) {
                result.push({ cobIdTx: parsed[0], cobIdRx: parsed[1], deviceId: parsed[2] });
            }
        }
        return result;
    }

    /**
     * Add an SDO client parameter object (0x1280–0x12FF).
     * @param {number} deviceId  - node-ID of the SDO server [1-127].
     * @param {number} [cobIdTx]
     * @param {number} [cobIdRx]
     * @param {object} [options]
     */
    addSdoClientParameter(deviceId, cobIdTx = 0x600, cobIdRx = 0x580, options = {}) {
        if (!deviceId || deviceId < 1 || deviceId > 0x7F) {
            throw new RangeError('deviceId must be in range [1-127]');
        }

        let index = options.index;
        if (index) {
            if (this._model.objects[index]) {
                throw new EdsError(`index 0x${index.toString(16)} already in use`);
            }
        } else {
            index = 0x1280;
            while (index <= 0x12FF && this._model.objects[index]) {
                index++;
            }
            if (index > 0x12FF) {
                throw new EdsError('no free SDO client parameter slot (0x1280-0x12FF)');
            }
        }

        _makeSdoRecord(this._model.objects, index, 'SDO client parameter',
            'COB-ID client to server', cobIdTx,
            'COB-ID server to client', cobIdRx,
            'Node-ID of the SDO server', deviceId,
            options);
    }

    /**
     * Remove an SDO client parameter object by server device ID.
     * @param {number} deviceId
     */
    removeSdoClientParameter(deviceId) {
        for (let index = 0x1280; index <= 0x12FF; index++) {
            const entry = this._model.objects[index];
            if (!entry || !entry.subObjects) {
                continue;
            }
            const sub3 = entry.subObjects[3];
            if (sub3 && _parseNum(sub3.defaultValue) === deviceId) {
                delete this._model.objects[index];
                return;
            }
        }
    }

    /**
     * Get RPDO communication/mapping parameters (0x1400–0x15FF).
     * @returns {Array<object>}
     */
    getReceivePdos() {
        const result = [];
        for (const k of Object.keys(this._model.objects).map(Number).sort((a, b) => a - b)) {
            if (k < 0x1400 || k > 0x15FF) {
                continue;
            }
            const pdo = this._parsePdo(k);
            if (pdo) {
                delete pdo.syncStart;
                result.push(pdo);
            }
        }
        return result;
    }

    /**
     * Add an RPDO communication/mapping parameter.
     * @param {object} pdo
     * @param {object} [options]
     */
    addReceivePdo(pdo, options = {}) {
        const objects = this._model.objects;
        for (let i = 0x1400; i <= 0x15FF; i++) {
            const e = objects[i];
            if (e && e.subObjects && e.subObjects[1]) {
                if (_parseNum(e.subObjects[1].defaultValue) === pdo.cobId) {
                    throw new EdsError(`RPDO 0x${pdo.cobId.toString(16)} already exists`);
                }
            }
        }

        let index = options.index;
        if (index) {
            if (index < 0x1400 || index > 0x15FF) {
                throw new RangeError('index must be in range [0x1400-0x15FF]');
            }
            if (objects[index]) {
                throw new EdsError(`index 0x${index.toString(16)} already in use`);
            }
        } else {
            index = 0x1400;
            while (index <= 0x15FF && objects[index]) {
                index++;
            }
            if (index > 0x15FF) {
                throw new RangeError('no free RPDO slot (0x1400-0x15FF)');
            }
        }

        _buildPdo(objects, index, index + 0x200, pdo, options,
            'RPDO communication parameter', 'RPDO mapping parameter',
            'COB-ID used by RPDO');

        this._model.deviceInfo.nrOfRXPDO = this.nrOfRXPDO;
    }

    /**
     * Remove an RPDO by COB-ID.
     * @param {number} cobId
     */
    removeReceivePdo(cobId) {
        const objects = this._model.objects;
        for (let index = 0x1400; index <= 0x15FF; index++) {
            const e = objects[index];
            if (!e || !e.subObjects || !e.subObjects[1]) {
                continue;
            }
            if (_parseNum(e.subObjects[1].defaultValue) === cobId) {
                delete objects[index];
                delete objects[index + 0x200];
                this._model.deviceInfo.nrOfRXPDO = this.nrOfRXPDO;
                return;
            }
        }
    }

    /**
     * Get TPDO communication/mapping parameters (0x1800–0x19FF).
     * @returns {Array<object>}
     */
    getTransmitPdos() {
        const result = [];
        for (const k of Object.keys(this._model.objects).map(Number).sort((a, b) => a - b)) {
            if (k < 0x1800 || k > 0x19FF) {
                continue;
            }
            const pdo = this._parsePdo(k);
            if (pdo) {
                result.push(pdo);
            }
        }
        return result;
    }

    /**
     * Add a TPDO communication/mapping parameter.
     * @param {object} pdo
     * @param {object} [options]
     */
    addTransmitPdo(pdo, options = {}) {
        const objects = this._model.objects;
        for (let i = 0x1800; i <= 0x19FF; i++) {
            const e = objects[i];
            if (e && e.subObjects && e.subObjects[1]) {
                if (_parseNum(e.subObjects[1].defaultValue) === pdo.cobId) {
                    throw new EdsError(`TPDO 0x${pdo.cobId.toString(16)} already exists`);
                }
            }
        }

        let index = options.index;
        if (index) {
            if (index < 0x1800 || index > 0x19FF) {
                throw new RangeError('index must be in range [0x1800-0x19FF]');
            }
            if (objects[index]) {
                throw new EdsError(`index 0x${index.toString(16)} already in use`);
            }
        } else {
            index = 0x1800;
            while (index <= 0x19FF && objects[index]) {
                index++;
            }
            if (index > 0x19FF) {
                throw new RangeError('no free TPDO slot (0x1800-0x19FF)');
            }
        }

        _buildPdo(objects, index, index + 0x200, pdo, options,
            'TPDO communication parameter', 'TPDO mapping parameter',
            'COB-ID used by TPDO');

        this._model.deviceInfo.nrOfTXPDO = this.nrOfTXPDO;
    }

    /**
     * Remove a TPDO by COB-ID.
     * @param {number} cobId
     */
    removeTransmitPdo(cobId) {
        const objects = this._model.objects;
        for (let index = 0x1800; index <= 0x19FF; index++) {
            const e = objects[index];
            if (!e || !e.subObjects || !e.subObjects[1]) {
                continue;
            }
            if (_parseNum(e.subObjects[1].defaultValue) === cobId) {
                delete objects[index];
                delete objects[index + 0x200];
                this._model.deviceInfo.nrOfTXPDO = this.nrOfTXPDO;
                return;
            }
        }
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    /** @private */
    _rebuildNameLookup() {
        this._nameLookup = {};
        for (const entry of Object.values(this._model.objects)) {
            this._registerName(entry);
        }
    }

    /**
     * @param entry
     * @private
     */
    _registerName(entry) {
        if (!entry.parameterName) {
            return;
        }
        if (!this._nameLookup[entry.parameterName]) {
            this._nameLookup[entry.parameterName] = [];
        }
        if (!this._nameLookup[entry.parameterName].includes(entry)) {
            this._nameLookup[entry.parameterName].push(entry);
        }
    }

    /**
     * @param entry
     * @private
     */
    _unregisterName(entry) {
        if (!entry.parameterName || !this._nameLookup[entry.parameterName]) {
            return;
        }
        const arr = this._nameLookup[entry.parameterName];
        const idx = arr.indexOf(entry);
        if (idx >= 0) {
            arr.splice(idx, 1);
        }
        if (arr.length === 0) {
            delete this._nameLookup[entry.parameterName];
        }
    }

    /**
     * Update the "Max sub-index" (sub-index 0) of a subObjects map to reflect
     * the highest occupied non-zero sub-index.
     * @param subObjects
     * @private
     */
    _updateMaxSubIndex(subObjects) {
        const indices = Object.keys(subObjects).map(Number).filter(n => n > 0);
        if (subObjects[0]) {
            subObjects[0].defaultValue = String(indices.length > 0 ? Math.max(...indices) : 0);
        }
    }

    /**
     * Get or create a VAR UINT32 entry used for COB-ID fields.
     * @param index
     * @param parameterName
     * @param accessType
     * @private
     */
    _getOrCreateCobId(index, parameterName, accessType) {
        let obj = this.getEntry(index);
        if (!obj) {
            obj = this.addEntry(index, {
                parameterName,
                objectType:   ObjectType.VAR,
                dataType:     DataType.UNSIGNED32,
                accessType:   accessType || AccessType.READ_WRITE,
                defaultValue: '0x00000000',
            });
        }
        return obj;
    }

    /**
     * Return the defaultValue of a COB-ID entry as an unsigned 32-bit integer,
     * or null if the entry does not exist.
     * @param index
     * @private
     */
    _getCobIdBits(index) {
        const obj = this.getEntry(index);
        return obj ? (_parseNum(obj.defaultValue) >>> 0) : null;
    }

    /**
     * Parse an SDO parameter record entry.
     * Returns [cobIdRx, cobIdTx, deviceId] or null.
     * @param entry
     * @private
     */
    _parseSdoParameter(entry) {
        const subs = entry.subObjects;
        if (!subs) {
            return null;
        }

        const cobIdRx = _parseNum(subs[1]?.defaultValue);
        if (cobIdRx === undefined) {
            return null;
        }
        if ((cobIdRx >>> 29) & 0x1) {
            throw new EdsError('CAN extended frames are not supported');
        }

        const cobIdTx = _parseNum(subs[2]?.defaultValue);
        if (cobIdTx === undefined) {
            return null;
        }
        if ((cobIdTx >>> 29) & 0x1) {
            throw new EdsError('CAN extended frames are not supported');
        }

        const deviceId = _parseNum(subs[3]?.defaultValue) || 0;
        return [cobIdRx & 0x7FF, cobIdTx & 0x7FF, deviceId];
    }

    /**
     * Parse a PDO communication + mapping parameter pair into a structured
     * object.  Returns undefined if the PDO is marked invalid (COB-ID bit 31).
     * @param {number} commIndex - index of the communication parameter object.
     * @returns {object|undefined}
     * @private
     */
    _parsePdo(commIndex) {
        const commEntry = this.getEntry(commIndex);
        if (!commEntry) {
            throw new EdsError(`missing communication parameter (0x${commIndex.toString(16)})`);
        }

        const mapEntry = this.getEntry(commIndex + 0x200);
        if (!mapEntry) {
            throw new EdsError(`missing mapping parameter (0x${(commIndex + 0x200).toString(16)})`);
        }

        const commSubs = commEntry.subObjects || {};
        const mapSubs  = mapEntry.subObjects  || {};

        if (!commSubs[1]) {
            throw new EdsError('missing PDO COB-ID');
        }

        let cobId = _parseNum(commSubs[1].defaultValue) >>> 0;
        if (!cobId || (cobId >>> 31) & 0x1) {
            return undefined;
        }

        if ((cobId >>> 29) & 0x1) {
            throw new EdsError('CAN extended frames are not supported');
        }

        cobId &= 0x7FF;

        if (!commSubs[2]) {
            throw new EdsError('missing PDO transmission type');
        }

        const transmissionType = _parseNum(commSubs[2].defaultValue) || 0;
        const inhibitTime      = _parseNum(commSubs[3]?.defaultValue) || 0;
        const eventTime        = _parseNum(commSubs[5]?.defaultValue) || 0;
        const syncStart        = _parseNum(commSubs[6]?.defaultValue) || 0;

        const maxMap = _parseNum(mapSubs[0]?.defaultValue) || 0;
        if (maxMap === 0xFE) {
            throw new EdsError('SAM-MPDO not supported');
        }
        if (maxMap === 0xFF) {
            throw new EdsError('DAM-MPDO not supported');
        }
        if (maxMap > 0x40) {
            throw new EdsError(`invalid PDO mapping value (${maxMap})`);
        }

        const dataObjects = [];
        let dataSize = 0;

        for (let i = 1; i <= maxMap; i++) {
            const sub = mapSubs[i];
            if (!sub || !sub.defaultValue) {
                continue;
            }

            const packed    = _parseNum(sub.defaultValue) >>> 0;
            const bitLength = packed & 0xFF;
            const subIndex  = (packed >>> 8)  & 0xFF;
            const dataIndex = (packed >>> 16) & 0xFFFF;

            if (!packed) {
                continue;
            }

            let obj = this.getEntry(dataIndex);
            if (obj) {
                if (subIndex && obj.subObjects) {
                    obj = obj.subObjects[subIndex];
                }
                dataObjects.push(obj);
                dataSize += bitLength / 8;
            }
        }

        return { cobId, transmissionType, inhibitTime, eventTime, syncStart, dataObjects, dataSize };
    }
}

module.exports = { EdsError, Eds };
