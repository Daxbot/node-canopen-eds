/**
 * @file CANopen type definitions.
 * @author Wilkins White
 * @copyright 2024 Daxbot
 */

/**
 * CANopen object types.
 * @enum {number}
 * @see CiA301 "Object code usage" (§7.4.3)
 */
const ObjectType = {
    /** An object with no data fields. */
    NULL: 0,

    /** Large variable amount of data, e.g. executable program code. */
    DOMAIN: 2,

    /** Denotes a type definition such as BOOLEAN, UNSIGNED16, etc. */
    DEFTYPE: 5,

    /** Defines a new record type, e.g. PDO mapping structure. */
    DEFSTRUCT: 6,

    /** A single value such as an UNSIGNED8, INTEGER16, etc. */
    VAR: 7,

    /**
     * A multiple data field object where each data field is a simple variable
     * of the same basic data type, e.g. array of UNSIGNED16. Sub-index 0 of an
     * ARRAY is always UNSIGNED8 and therefore not part of the ARRAY data.
     */
    ARRAY: 8,

    /**
     * A multiple data field object where the data fields may be any
     * combination of simple variables. Sub-index 0 of a RECORD is always
     * UNSIGNED8 and sub-index 255 is always UNSIGNED32 and therefore not part
     * of the RECORD data.
     */
    RECORD: 9,
};

/**
 * CANopen access types.
 *
 * The access rights for a particular object. The viewpoint is from the network
 * into the CANopen device.
 * @enum {string}
 * @see CiA301 "Access usage" (§7.4.5)
 */
const AccessType = {
    /** Read and write access. */
    READ_WRITE: 'rw',

    /** Write only access. */
    WRITE_ONLY: 'wo',

    /** Read only access. */
    READ_ONLY: 'ro',

    /**
     * Read only access. Contents should not change after initialization.
     */
    CONSTANT: 'const',

    /** Read and write access for output objects (process data written to device). */
    READ_WRITE_OUTPUT: 'rww',

    /** Read and write access for input objects (process data read from device). */
    READ_WRITE_INPUT: 'rwr',
};

/**
 * CANopen data types.
 *
 * The static data types are placed in the object dictionary at their specified
 * index for definition purposes only. Simple types may be mapped to an RPDO
 * as a way to define space for data that is not being used by this CANopen
 * device.
 * @enum {number}
 * @see CiA301 "Data type entry usage" (§7.4.7)
 */
const DataType = {
    /** Boolean value (bool). */
    BOOLEAN: 1,

    /** 8-bit signed integer (int8_t). */
    INTEGER8: 2,

    /** 16-bit signed integer (int16_t). */
    INTEGER16: 3,

    /** 32-bit signed integer (int32_t). */
    INTEGER32: 4,

    /** 8-bit unsigned integer (uint8_t). */
    UNSIGNED8: 5,

    /** 16-bit unsigned integer (uint16_t). */
    UNSIGNED16: 6,

    /** 32-bit unsigned integer (uint32_t). */
    UNSIGNED32: 7,

    /** 32-bit floating point (float). */
    REAL32: 8,

    /** Null terminated c-string. */
    VISIBLE_STRING: 9,

    /** Raw character buffer. */
    OCTET_STRING: 10,

    /** Unicode string. */
    UNICODE_STRING: 11,

    /** Time since January 1, 1984.  */
    TIME_OF_DAY: 12,

    /** Time difference.  */
    TIME_DIFFERENCE: 13,

    /** Data of variable length. */
    DOMAIN: 15,

    /** 64-bit floating point (double) */
    REAL64: 17,

    /** 24-bit signed integer. */
    INTEGER24: 16,

    /** 40-bit signed integer. */
    INTEGER40: 18,

    /** 48-bit signed integer. */
    INTEGER48: 19,

    /** 56-bit signed integer. */
    INTEGER56: 20,

    /** 64-bit signed integer (int64_t). */
    INTEGER64: 21,

    /** 24-bit unsigned integer. */
    UNSIGNED24: 22,

    /** 40-bit unsigned integer. */
    UNSIGNED40: 24,

    /** 48-bit unsigned integer. */
    UNSIGNED48: 25,

    /** 56-bit unsigned integer. */
    UNSIGNED56: 26,

    /** 64-bit unsigned integer (uint64_t) */
    UNSIGNED64: 27,

    /** PDO parameter record. */
    PDO_PARAMETER: 32,

    /** PDO mapping parameter record. */
    PDO_MAPPING: 33,

    /** SDO parameter record. */
    SDO_PARAMETER: 34,

    /** Identity record. */
    IDENTITY: 35,
};

/**
 * Object type names by value, e.g. ObjectTypeName[7] is 'VAR'.
 * @type {Object<number, string>}
 */
const ObjectTypeName = Object.fromEntries(
    Object.entries(ObjectType).map(([k, v]) => [v, k])
);

/**
 * Data type names by value, e.g. DataTypeName[6] is 'UNSIGNED16'.
 * @type {Object<number, string>}
 */
const DataTypeName = Object.fromEntries(
    Object.entries(DataType).map(([k, v]) => [v, k])
);

const DATA_TYPE_SIZE = {
    [DataType.BOOLEAN]: 1,
    [DataType.INTEGER8]: 1,
    [DataType.UNSIGNED8]: 1,
    [DataType.INTEGER16]: 2,
    [DataType.UNSIGNED16]: 2,
    [DataType.INTEGER24]: 3,
    [DataType.UNSIGNED24]: 3,
    [DataType.INTEGER32]: 4,
    [DataType.UNSIGNED32]: 4,
    [DataType.REAL32]: 4,
    [DataType.INTEGER40]: 5,
    [DataType.UNSIGNED40]: 5,
    [DataType.INTEGER48]: 6,
    [DataType.UNSIGNED48]: 6,
    [DataType.INTEGER56]: 7,
    [DataType.UNSIGNED56]: 7,
    [DataType.INTEGER64]: 8,
    [DataType.UNSIGNED64]: 8,
    [DataType.REAL64]: 8,
    [DataType.TIME_OF_DAY]: 6,
    [DataType.TIME_DIFFERENCE]: 6,
};

const SIGNED_TYPES = [
    DataType.INTEGER8, DataType.INTEGER16, DataType.INTEGER24,
    DataType.INTEGER32, DataType.INTEGER40, DataType.INTEGER48,
    DataType.INTEGER56, DataType.INTEGER64,
];

const UNSIGNED_TYPES = [
    DataType.UNSIGNED8, DataType.UNSIGNED16, DataType.UNSIGNED24,
    DataType.UNSIGNED32, DataType.UNSIGNED40, DataType.UNSIGNED48,
    DataType.UNSIGNED56, DataType.UNSIGNED64,
];

/**
 * Return the size of a data type in bytes.
 * @param {number} type - DataType value.
 * @returns {number|null} null for a type of variable length.
 */
function dataTypeSize(type) {
    return DATA_TYPE_SIZE[type] ?? null;
}

/**
 * Return true for BOOLEAN and the integer types.
 * @param {number} type - DataType value.
 * @returns {boolean}
 */
function isIntegerType(type) {
    return type === DataType.BOOLEAN || isSignedType(type) || isUnsignedType(type);
}

/**
 * Return true for the signed integer types.
 * @param {number} type - DataType value.
 * @returns {boolean}
 */
function isSignedType(type) {
    return SIGNED_TYPES.includes(type);
}

/**
 * Return true for the unsigned integer types.
 * @param {number} type - DataType value.
 * @returns {boolean}
 */
function isUnsignedType(type) {
    return UNSIGNED_TYPES.includes(type);
}

/**
 * Return true for the floating point types.
 * @param {number} type - DataType value.
 * @returns {boolean}
 */
function isFloatType(type) {
    return type === DataType.REAL32 || type === DataType.REAL64;
}

/**
 * Return true for the string types.
 * @param {number} type - DataType value.
 * @returns {boolean}
 */
function isStringType(type) {
    return [
        DataType.VISIBLE_STRING,
        DataType.OCTET_STRING,
        DataType.UNICODE_STRING,
    ].includes(type);
}

/**
 * Return true for the object types that hold sub-objects.
 * @param {number} objectType - ObjectType value.
 * @returns {boolean}
 */
function isContainerType(objectType) {
    return [
        ObjectType.ARRAY,
        ObjectType.RECORD,
        ObjectType.DEFSTRUCT,
    ].includes(objectType);
}

module.exports = exports = {
    ObjectType,
    AccessType,
    DataType,
    ObjectTypeName,
    DataTypeName,
    dataTypeSize,
    isIntegerType,
    isSignedType,
    isUnsignedType,
    isFloatType,
    isStringType,
    isContainerType,
};
