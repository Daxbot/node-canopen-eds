/**
 * @file canopen-eds — browser-compatible CANopen EDS parse/serialize.
 * @author Wilkins White
 * @copyright 2026 Daxbot
 */

const { parseEds }    = require('./source/parse');
const { serializeEds } = require('./source/serialize');
const { ObjectType, AccessType, DataType } = require('./source/types');
const { EdsError, Eds } = require('./source/eds');
const {
    createEmptyEds,
    getCategoryForIndex,
    CATEGORIES,
    createVarEntry,
    createArrayEntry,
    createRecordEntry,
    createSubEntry,
    countRxTxPdo,
} = require('./source/model');
const {
    parseMappingValue,
    buildMappingValue,
    getPdoMappableObjects,
    getTxPdos,
    getRxPdos,
    writePdoToObjects,
    addNewPdo,
    deletePdo,
    getMappingBitUsage,
} = require('./source/pdo');

module.exports = {
    parseEds,
    serializeEds,
    ObjectType,
    AccessType,
    DataType,
    EdsError,
    Eds,
    createEmptyEds,
    getCategoryForIndex,
    CATEGORIES,
    createVarEntry,
    createArrayEntry,
    createRecordEntry,
    createSubEntry,
    countRxTxPdo,
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
